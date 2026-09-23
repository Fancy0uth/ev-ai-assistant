import { publicGuidanceFixture } from './public-guidance-fixture';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { fitnessCheckInSchema, workoutRevisionSchema, workoutRevisionV2Schema, workoutSchema, type PreviewWorkoutContextV2 } from '@ev/contracts';
import { runMigrations } from '../src/storage/migrations';
import { createFitnessRepository } from '../src/modules/fitness/repository';
import { loadInternalExerciseCatalog } from '../src/modules/fitness/catalog';

it('FIT03b isolates current context, confirms exact previews, stores V2 snapshots and preserves V1', async () => {
  const db = new Database(':memory:');
  const owner = randomUUID();
  const other = randomUUID();
  const timestamp = '2026-09-18T08:00:00.000Z';
  let clock = new Date(timestamp);
  try {
    db.pragma('foreign_keys = ON');
    runMigrations(db, 29);
    expect(db.prepare('select version from schema_migrations where version = 30').get()).toBeUndefined();
    runMigrations(db, 30);
    expect(db.prepare('select version from schema_migrations where version = 30').get()).toEqual({ version: 30 });
    const { createFitnessPlanningContextService } = await import('../src/modules/fitness/planning-context');
    db.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run(owner, 'fit03b-synthetic-owner', 'synthetic-unused', timestamp);
    const repository = createFitnessRepository(db);
    const context = createFitnessPlanningContextService(db, { now: () => clock });
    const raw = { localDate: '2026-09-18', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false };
    const signalId = randomUUID();
    db.prepare("insert into signals (id, owner_id, local_date, kind, value, source, version, created_at, updated_at) values (?, ?, ?, 'RECOVERY', 80, 'CHECK_IN', 1, ?, ?)").run(signalId, owner, raw.localDate, timestamp, timestamp);
    const checkIn = fitnessCheckInSchema.parse({ ...raw, id: randomUUID(), signalId,
      recovery: { score: 80, level: 'READY', reasonCodes: ['READY'] },
      safety: { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_READY'], maxDurationMinutes: 60, intensityCap: 'MODERATE' },
      policyVersion: 'WORKOUT_SAFETY_V1', version: 1, createdAt: timestamp });
    repository.createCheckIn({ ownerId: owner, checkIn, raw });
    const profile = context.saveProfile(owner, { expectedVersion: null, profile: {
      goals: ['STRENGTH'], experience: 'BEGINNER', weeklyTrainingDays: 3, availableEquipment: ['MAT', 'CHAIR', 'WALL'],
      bodyMeasurements: { weight: { value: 70, unit: 'KG' }, height: null }, fitnessDescription: 'Private synthetic description', limitations: [], limitationsComplete: true, generalExerciseScope: 'GENERAL_ADULT_19_64_V1',
    } });
    expect(profile.version).toBe(1);
    expect(context.readProfile(other)).toBeUndefined();
    expect(() => context.saveProfile(owner, { expectedVersion: null, profile })).toThrow();
    const query = { checkInId: checkIn.id, goal: 'STRENGTH' as const };
    const candidates = context.listCandidates(owner, query);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.sourceKind === 'INTERNAL_STARTER')).toBe(true);
    const createMemory = () => {
      const documentId = randomUUID();
      const revisionId = randomUUID();
      db.prepare("insert into entity_memory_documents (id, owner_id, scope_type, scope_id, content, version, created_at, updated_at) values (?, ?, 'FITNESS', ?, 'Synthetic current memory', 1, ?, ?)").run(documentId, owner, owner, timestamp, timestamp);
      db.prepare("insert into entity_memory_revisions (id, document_id, owner_id, scope_type, scope_id, content, version, parent_revision_id, source_revision_id, source, expected_version, content_bytes, created_at) values (?, ?, ?, 'FITNESS', ?, 'Synthetic current memory', 1, null, null, 'WRITE', null, 24, ?)").run(revisionId, documentId, owner, owner, timestamp);
      return { documentId, revisionId };
    };
    const memory = createMemory();
    expect(context.listSelectableCurrentFitnessMemory(owner)[0]).toMatchObject({ id: memory.revisionId, version: 1 });
    const input: PreviewWorkoutContextV2 = { schemaVersion: 'WORKOUT_PLANNING_V2', goal: 'STRENGTH', checkInId: checkIn.id,
      expectedCheckInVersion: 1, expectedProfileVersion: 1,
      scheduling: { targetDate: raw.localDate, durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
      authorization: { disclosureVersion: 'HEALTH_DISCLOSURE_V2', allowedFields: ['PROFILE_GOALS', 'PROFILE_EQUIPMENT', 'PROFILE_LIMITATIONS', 'CHECK_IN', 'CANDIDATES', 'SCHEDULING', 'FITNESS_MEMORY'], selectedFitnessMemoryIds: [memory.revisionId] },
      candidateCitationIds: candidates.slice(0, 3).map((candidate) => candidate.citationId) };
    const preview = context.preview(owner, input);
    expect(preview.previewReceipt).not.toHaveProperty('consentedAt');
    expect(preview.payload.profile).toMatchObject({ experience: 'UNKNOWN', weeklyTrainingDays: 0, bodyMeasurements: { weight: null, height: null }, fitnessDescription: null });
    expect(preview.payload.recentFeedback).toEqual([]);
    expect(() => context.preview(owner, { ...input, authorization: { ...input.authorization,
      allowedFields: input.authorization.allowedFields.filter((field) => field !== 'FITNESS_MEMORY') } })).toThrow();
    expect(() => context.listCandidates(owner, { ...query, sourceKind: 'EXTERNAL_DATASET' })).toThrow();
    const storedPreview = JSON.stringify(db.prepare('select selection_json from fitness_planning_previews').all());
    expect(storedPreview).not.toContain('Synthetic current memory');
    expect(storedPreview).not.toContain('Private synthetic description');
    const confirmation = { schemaVersion: input.schemaVersion, goal: input.goal, scheduling: input.scheduling, checkInId: input.checkInId,
      expectedCheckInVersion: 1, expectedProfileVersion: 1, disclosureVersion: 'HEALTH_DISCLOSURE_V2' as const,
      contextHash: preview.contextHash, allowedFields: input.authorization.allowedFields, consentedAt: '2020-01-01T00:00:00.000Z' };
    clock = new Date('2026-09-18T08:01:00.000Z');
    const resolved = context.resolveConfirmed(owner, confirmation);
    expect(resolved.receipt.consentedAt).toBe(clock.toISOString());
    expect(resolved.payload).toEqual(preview.payload);
    expect(() => context.resolveConfirmed(other, confirmation)).toThrow();
    const workoutId = randomUUID();
    const revisionId = randomUUID();
    const workout = workoutSchema.parse({ id: workoutId, checkInId: checkIn.id, signalId, generationMode: 'ASSISTED', state: 'DRAFT', currentRevisionId: revisionId,
      proposalId: null, actionId: null, timeRequestId: null, feedbackId: null, version: 1, createdAt: timestamp, updatedAt: timestamp });
    const revision = workoutRevisionV2Schema.parse({ id: revisionId, workoutId, parentRevisionId: null, revisionNo: 1, schemaVersion: 'WORKOUT_PLAN_V2', title: 'Synthetic V2', rationale: 'Technical fixture', goal: 'STRENGTH',
      items: publicGuidanceFixture(resolved.payload).items, alternatives: [], scheduling: input.scheduling,
      provenance: [{ kind: 'RULES', capabilityRunId: null, editedFields: [], capturedAt: timestamp }], contextReceipt: resolved.receipt,
      policyVersion: resolved.payload.policyVersion, contentHash: 'a'.repeat(64), createdAt: timestamp });
    // Isolate new check-in invalidation before any pain feedback exists; finally never swallows assertions.
    db.exec('savepoint fit03b_extra1');
    try {
      expect(db.prepare('select count(*) as count from workout_feedback_v2').get()).toEqual({ count: 0 });
      const writesBefore = db.prepare('select (select count(*) from workouts_v2) as workouts, (select count(*) from proposals) as proposals').get();
      const appendStatus = (id: string, hasPain: boolean, acuteRisk: boolean, createdAt = timestamp) => {
        const nextSignalId = randomUUID();
        db.prepare("insert into signals (id, owner_id, local_date, kind, value, source, version, created_at, updated_at) values (?, ?, ?, 'RECOVERY', 80, 'CHECK_IN', 1, ?, ?)").run(nextSignalId, owner, raw.localDate, createdAt, createdAt);
        const nextRaw = { ...raw, hasPain, acuteRisk };
        const next = fitnessCheckInSchema.parse({ ...checkIn, ...nextRaw, id, signalId: nextSignalId, createdAt,
          safety: hasPain || acuteRisk ? { eligibility: 'BLOCKED', notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP',
            reasonCodes: [hasPain ? 'SELF_REPORTED_PAIN' : 'SELF_REPORTED_ACUTE_RISK'], maxDurationMinutes: 0, intensityCap: 'NONE' } : checkIn.safety });
        repository.createCheckIn({ ownerId: owner, checkIn: next, raw: nextRaw });
        return next;
      };
      appendStatus('99999999-9999-4999-8999-999999999999', true, true, '2026-09-19T08:00:00.000Z');
      expect(context.preview(owner, input).contextHash).toBe(preview.contextHash);
      const safeB = appendStatus('00000000-0000-4000-8000-000000000001', false, false);
      const assertOldBasisRejected = (statusCode: number, code: string) => {
        expect(() => context.preview(owner, input)).toThrowError(expect.objectContaining({ statusCode, code }));
        expect(() => context.resolveConfirmed(owner, confirmation)).toThrowError(expect.objectContaining({ statusCode, code }));
        expect(() => context.revalidateCurrent(owner, revision, resolved.citations)).toThrowError(expect.objectContaining({ statusCode, code }));
        expect(db.prepare('select (select count(*) from workouts_v2) as workouts, (select count(*) from proposals) as proposals').get()).toEqual(writesBefore);
      };
      assertOldBasisRejected(409, 'WORKOUT_CONTEXT_CHANGED');
      expect(repository.findLatestEffectiveCheckIn(owner, clock.toISOString())?.id).toBe(safeB.id);
      expect(repository.findLatestEffectiveCheckIn(other, clock.toISOString())).toBeUndefined();
      expect(repository.findLatestEffectiveCheckIn(owner, '2026-09-18T07:59:59.999Z')).toBeUndefined();
      const painfulC = appendStatus('ffffffff-ffff-4fff-8fff-ffffffffffff', true, false);
      expect(repository.findLatestEffectiveCheckIn(owner, clock.toISOString())?.id).toBe(painfulC.id);
      assertOldBasisRejected(422, 'WORKOUT_SAFETY_BLOCKED');
      const acuteD = appendStatus('00000000-0000-4000-8000-000000000002', false, true);
      expect(repository.findLatestEffectiveCheckIn(owner, clock.toISOString())?.id).toBe(acuteD.id);
      assertOldBasisRejected(422, 'WORKOUT_SAFETY_BLOCKED');
    } finally {
      db.exec('rollback to fit03b_extra1');
      db.exec('release fit03b_extra1');
    }
    repository.createWorkoutWithRevisionV2({ ownerId: owner, workout, revision, citations: resolved.citations });
    expect(repository.currentRevisionSchema(owner, workoutId)).toBe('WORKOUT_PLAN_V2');
    const detail = repository.findWorkoutRevisionV2(owner, revisionId)!;
    expect(detail.revision).toEqual(revision);
    expect(detail.citations[0]?.name).toBeTruthy();
    expect(detail.citations[0]?.instructions).toBeTruthy();
    expect(JSON.stringify(detail.citations)).not.toContain('Synthetic current memory');
    expect(repository.findWorkoutRevisionV2(other, revisionId)).toBeUndefined();
    expect(() => repository.appendWorkoutRevisionV2({ ownerId: owner, workoutId, expectedVersion: 1,
      revision: { ...revision, id: randomUUID(), parentRevisionId: randomUUID(), revisionNo: 2 }, citations: resolved.citations, updatedAt: timestamp })).toThrow();
    expect(repository.findWorkout(owner, workoutId)?.version).toBe(1);
    expect(repository.appendWorkoutRevisionV2({ ownerId: owner, workoutId, expectedVersion: 1,
      revision: { ...revision, id: randomUUID(), parentRevisionId: revisionId, revisionNo: 2 },
      citations: resolved.citations, updatedAt: timestamp })?.workout.version).toBe(2);
    clock = new Date('2026-09-18T08:12:00.000Z');
    expect(() => context.resolveConfirmed(owner, confirmation)).toThrow();
    expect(context.revalidateCurrent(owner, revision, resolved.citations).candidates).toEqual(resolved.payload.candidates);
    clock = new Date('2026-09-18T08:02:00.000Z');
    db.prepare('delete from entity_memory_documents where id = ?').run(memory.documentId);
    const replacement = createMemory();
    expect(replacement.revisionId).not.toBe(memory.revisionId);
    expect(() => context.resolveConfirmed(owner, confirmation)).toThrow();
    expect(repository.findWorkoutRevisionV2(owner, revisionId)).toEqual(detail);
    const nextInput = { ...input, authorization: { ...input.authorization, selectedFitnessMemoryIds: [replacement.revisionId] } };
    expect(context.preview(owner, nextInput).contextHash).not.toBe(preview.contextHash);
    const currentPreview = context.preview(owner, nextInput);
    const insertFeedback = (createdAt: string, pain: boolean) => {
      const feedbackWorkoutId = randomUUID();
      const feedbackRevisionId = randomUUID();
      repository.createWorkoutWithRevisionV2({ ownerId: owner,
        workout: { ...workout, id: feedbackWorkoutId, currentRevisionId: feedbackRevisionId },
        revision: { ...revision, id: feedbackRevisionId, workoutId: feedbackWorkoutId }, citations: resolved.citations });
      const actionId = randomUUID();
      db.prepare("insert into actions (id, owner_id, title, kind, status, version, created_at, updated_at) values (?, ?, 'Synthetic feedback', 'FITNESS', 'CANCELLED', 1, ?, ?)").run(actionId, owner, timestamp, timestamp);
      db.prepare("insert into workout_feedback_v2 (id, owner_id, workout_id, action_id, outcome, perceived_effort, had_pain, note, started_at, ended_at, activity_session_id, created_at) values (?, ?, ?, ?, 'SKIPPED', null, ?, 'Synthetic feedback note', null, null, null, ?)").run(randomUUID(), owner, feedbackWorkoutId, actionId, pain ? 1 : 0, createdAt);
    };
    for (let day = 12; day <= 17; day++) insertFeedback(`2026-09-${day}T08:00:00.000Z`, false);
    insertFeedback('2026-09-01T08:00:00.000Z', true);
    expect(repository.listRecentFeedback(owner, clock.toISOString())).toHaveLength(5);
    expect(repository.listRecentFeedback(other, clock.toISOString())).toEqual([]);
    const feedbackPreview = context.preview(owner, { ...nextInput, authorization: {
      ...nextInput.authorization, selectedFitnessMemoryIds: [],
      allowedFields: [...nextInput.authorization.allowedFields.filter((field) => field !== 'FITNESS_MEMORY'), 'RECENT_FEEDBACK'],
    } });
    expect(feedbackPreview.payload.selectedFitnessMemory).toEqual([]);
    expect(feedbackPreview.payload.recentFeedback).toHaveLength(5);
    expect(context.preview(owner, nextInput).payload.recentFeedback).toEqual([]);
    // This pain is older than the newest five records but still within the local 14-day safety window.
    insertFeedback('2026-09-10T08:00:00.000Z', true);
    expect(repository.listRecentFeedback(owner, clock.toISOString()).every((feedback) => !feedback.hadPain)).toBe(true);
    expect(() => context.resolveConfirmed(owner, { ...confirmation, contextHash: currentPreview.contextHash })).toThrow();
    expect(() => context.preview(owner, nextInput)).toThrow();
    context.saveProfile(owner, { expectedVersion: 1, profile: { ...profile, limitations: ['Declared limitation'] } });
    expect(() => context.listCandidates(owner, query)).toThrow();
    expect(() => context.resolveConfirmed(owner, confirmation)).toThrow();
    const catalog = loadInternalExerciseCatalog();
    const starter = catalog.items[0]!;
    const legacyId = randomUUID();
    const legacyRevisionId = randomUUID();
    const legacyRevision = workoutRevisionSchema.parse({ id: legacyRevisionId, workoutId: legacyId, parentRevisionId: null, revisionNo: 1,
      title: 'Legacy fixture', rationale: 'V1 remains readable', items: [{ citation: starter.citation, ...starter.defaults.LOW }], scheduling: input.scheduling,
      provenance: revision.provenance, contentHash: 'b'.repeat(64), createdAt: timestamp });
    repository.createWorkoutWithRevision({ ownerId: owner, workout: { ...workout, id: legacyId, currentRevisionId: legacyRevisionId }, revision: legacyRevision,
      catalog: { id: catalog.manifest.catalogId, version: catalog.manifest.catalogVersion, hash: catalog.manifest.contentSha256 } });
    expect(repository.findWorkoutRevision(owner, legacyRevisionId)).toEqual(legacyRevision);
    expect(repository.currentRevisionSchema(owner, legacyId)).toBe('WORKOUT_PLAN_V1');
    expect(db.prepare('pragma foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
