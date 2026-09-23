import { expect, it } from 'vitest';
import { loadInternalExerciseCatalog } from '../src/modules/fitness/catalog';
import { publicGuidanceFor } from '../src/modules/fitness/public-guidance';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/storage/migrations';
import { createFitnessRepository } from '../src/modules/fitness/repository';
import { createFitnessPlanningContextService } from '../src/modules/fitness/planning-context';
import { fitnessCheckInSchema, type PreviewWorkoutContextV2, type WorkoutPlanningOutputV2 } from '@ev/contracts';
import { validateWorkoutPlanV2 } from '@ev/domain';

it('maps only supported existing exercises to attributable phase and dose guidance', () => {
  const catalog = loadInternalExerciseCatalog();
  const items = catalog.items.map(item => publicGuidanceFor(item)).filter(Boolean);
  expect(items).toHaveLength(3);
  const walk = publicGuidanceFor(catalog.items.find(item => item.exerciseId === 'easy-walk')!)!;
  expect(walk.guidance.phases).toEqual(['WARMUP', 'COOLDOWN']);
  expect(walk.guidance.durationSeconds).toEqual({ min: 300, max: 600 });
  const chair = publicGuidanceFor(catalog.items.find(item => item.exerciseId === 'chair-sit-to-stand')!)!;
  expect(chair.guidance.reps).toEqual({ min: 5, max: 5 });
  expect(chair.guidance.sources[0]!.url).toBe('https://www.nhs.uk/live-well/exercise/strength-exercises/');
  expect(chair.guidance.basisKind).toBe('PUBLIC_GUIDANCE_NOT_INDIVIDUAL_REVIEW');
  expect(chair.guidance.sources[0]!.summaryHash).toMatch(/^[a-f0-9]{64}$/);
});

it('requires explicit scope, binds source snapshots and rejects wrong phase, dose, budget and revoked consent', () => {
  const db = new Database(':memory:');
  try {
    runMigrations(db);
    const owner = randomUUID(), signal = randomUUID(), at = '2026-09-20T06:00:00.000Z';
    db.prepare('insert into owners (id,username,password_hash,created_at) values (?,?,?,?)').run(owner, 'guidance-test', 'unused', at);
    db.prepare("insert into signals (id,owner_id,local_date,kind,value,source,version,created_at,updated_at) values (?,?,'2026-09-20','RECOVERY',80,'CHECK_IN',1,?,?)").run(signal, owner, at, at);
    const raw = { localDate: '2026-09-20', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false };
    const checkIn = fitnessCheckInSchema.parse({ ...raw, id: randomUUID(), signalId: signal, recovery: { score: 80, level: 'READY', reasonCodes: ['READY'] }, safety: { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_READY'], maxDurationMinutes: 60, intensityCap: 'MODERATE' }, policyVersion: 'WORKOUT_SAFETY_V1', version: 1, createdAt: at });
    createFitnessRepository(db).createCheckIn({ ownerId: owner, checkIn, raw });
    const context = createFitnessPlanningContextService(db, { now: () => new Date(at) });
    const initial = context.saveProfile(owner, { expectedVersion: null, profile: { goals: ['STRENGTH'], experience: 'BEGINNER', weeklyTrainingDays: 2, availableEquipment: ['CHAIR', 'WALL'], bodyMeasurements: { weight: null, height: null }, fitnessDescription: null, limitations: [], limitationsComplete: true } });
    const query = { checkInId: checkIn.id, goal: 'STRENGTH' as const };
    expect(() => context.listCandidates(owner, query)).toThrowError(expect.objectContaining({ code: 'WORKOUT_APPLICABILITY_CONFIRMATION_REQUIRED' }));
    const profile = context.saveProfile(owner, { expectedVersion: 1, profile: { ...initial, generalExerciseScope: 'GENERAL_ADULT_19_64_V1' } });
    const candidates = context.listCandidates(owner, query);
    expect(candidates).toHaveLength(3);
    const walk = candidates.find(c => c.publicGuidance?.phases.includes('WARMUP'))!;
    const chair = candidates.find(c => c.publicGuidance?.reps?.max === 5)!;
    const selection: PreviewWorkoutContextV2 = { schemaVersion: 'WORKOUT_PLANNING_V2', ...query, expectedCheckInVersion: 1, expectedProfileVersion: profile.version, scheduling: { targetDate: '2026-09-20', durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null }, authorization: { disclosureVersion: 'HEALTH_DISCLOSURE_V2', allowedFields: ['PROFILE_GOALS', 'PROFILE_EQUIPMENT', 'PROFILE_LIMITATIONS', 'CHECK_IN', 'CANDIDATES', 'SCHEDULING'], selectedFitnessMemoryIds: [] }, candidateCitationIds: [walk.citationId, chair.citationId] };
    expect(() => context.preview(owner, { ...selection, candidateCitationIds: [chair.citationId] })).toThrowError(expect.objectContaining({ code: 'WORKOUT_GUIDANCE_PHASES_MISSING' }));
    const preview = context.preview(owner, selection);
    const timed = { citationId: walk.citationId, rounds: 1, reps: null, secondsPerRep: null, durationSeconds: 300, restSeconds: 0, transitionSeconds: 30, intensity: 'LOW' as const, reason: 'Synthetic' };
    const plan: WorkoutPlanningOutputV2 = { schemaVersion: 'WORKOUT_PLAN_V2', title: 'Synthetic sourced plan', rationale: 'Public guidance', goal: 'STRENGTH', items: [{ ...timed, phase: 'WARMUP' }, { ...timed, citationId: chair.citationId, phase: 'MAIN', reps: 5, secondsPerRep: 3, durationSeconds: null }, { ...timed, phase: 'COOLDOWN' }], alternatives: [], totalDurationSeconds: 705 };
    expect(validateWorkoutPlanV2(preview.payload, plan).totalDurationSeconds).toBe(705);
    const wrongPhase = structuredClone(plan); wrongPhase.items[0]!.citationId = chair.citationId;
    expect(() => validateWorkoutPlanV2(preview.payload, wrongPhase)).toThrow('WORKOUT_PLAN_GUIDANCE_PHASE_INVALID');
    const wrongDose = structuredClone(plan); wrongDose.items[1]!.reps = 8;
    expect(() => validateWorkoutPlanV2(preview.payload, wrongDose)).toThrow('WORKOUT_PLAN_GUIDANCE_DOSE_INVALID');
    expect(() => validateWorkoutPlanV2({ ...preview.payload, scheduling: { ...preview.payload.scheduling, durationMinutes: 10 } }, plan)).toThrow('WORKOUT_PLAN_TIME_WINDOW_EXCEEDED');
    const confirmation = { schemaVersion: 'WORKOUT_PLANNING_V2' as const, ...query, expectedCheckInVersion: 1, expectedProfileVersion: profile.version, scheduling: selection.scheduling, disclosureVersion: 'HEALTH_DISCLOSURE_V2' as const, allowedFields: selection.authorization.allowedFields, consentedAt: at, contextHash: preview.contextHash };
    expect(context.resolveConfirmed(owner, confirmation).payload.candidates[0]!.publicGuidance).toBeDefined();
    context.saveProfile(owner, { expectedVersion: profile.version, profile: { ...profile, generalExerciseScope: null } });
    expect(() => context.resolveConfirmed(owner, confirmation)).toThrowError(expect.objectContaining({ code: 'WORKOUT_CONTEXT_CHANGED' }));
    expect(db.prepare('select count(*) n from actions').get()).toEqual({ n: 0 });
  } finally { db.close(); }
});
