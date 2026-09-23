import { publicGuidanceFixture } from './public-guidance-fixture';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import type { PreviewWorkoutContextV2, WorkoutPlanningInputV2, WorkoutPlanningOutputV2 } from '@ev/contracts';
import { runMigrations } from '../src/storage/migrations';
import { createFitnessRepository } from '../src/modules/fitness/repository';
import { loadInternalExerciseCatalog } from '../src/modules/fitness/catalog';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createV07HealthLoopRepository } from '../src/modules/health-loop/repository';
import { createV07IdempotencyService } from '../src/modules/health-loop/idempotency-service';
import { createFitnessService } from '../src/modules/fitness/service';
import { createProposalRepository } from '../src/modules/proposals/repository';
import { createProposalService } from '../src/modules/proposals/service';
import { createMemoryService } from '../src/modules/memory/service';
import { createEntityMemoryService } from '../src/modules/memory/entity-service';
import { createWorkoutPlanningService } from '../src/modules/fitness/planning-service';

// Removing finalization, source replay protection, or current-basis checks must fail this loop.
it('FIT03d planning loop preserves confirmation, feedback and one-shot memory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fit03d-'));
  const databasePath = join(root, 'synthetic.sqlite');
  const db = new Database(databasePath);
  const owner = randomUUID();
  let clock = new Date('2026-09-19T08:00:00.000Z');
  const now = () => clock;
  let calls = 0;
  try {
    db.pragma('foreign_keys = ON');
    runMigrations(db, 30);
    db.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(owner, 'fit03d-synthetic', 'unused', now().toISOString());
    const repo = createFitnessRepository(db);
    const calendar = createCalendarRepository(db);
    const health = createV07HealthLoopRepository(db);
    const idem = createV07IdempotencyService({ database: db, repository: health, now });
    const fitness = createFitnessService(repo, calendar, health, idem, { now });
    const memory = createEntityMemoryService(db, root, createMemoryService(db, root, { now }), { now });
    const options = { now, memory, workoutPlanningProvider: {
      descriptor: { providerId: 'v07-test-fixture' as const, providerLabel: 'Synthetic', adapterKind: 'TEST_FIXTURE' as const, evidenceKind: 'AUTOMATED_TEST_FIXTURE' as const },
      async generateWorkout(_owner: string, input: WorkoutPlanningInputV2): Promise<WorkoutPlanningOutputV2> {
        calls++;
        return publicGuidanceFixture(input);
      },
    } };
    const service = createWorkoutPlanningService(db, calendar, fitness, health, idem, options);
    expect(service.getProfile(owner)).toEqual({ profile: null });
    const checkIn = fitness.checkInV2(owner, { localDate: '2026-09-19', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false }, randomUUID()).checkIn;
    service.putProfile(owner, { expectedVersion: null, profile: { goals: ['STRENGTH'], experience: 'BEGINNER', weeklyTrainingDays: 3,
      availableEquipment: ['MAT', 'CHAIR', 'WALL'], bodyMeasurements: { weight: null, height: null }, fitnessDescription: null, limitations: [], limitationsComplete: true, generalExerciseScope: 'GENERAL_ADULT_19_64_V1' } });
    const candidates = service.listCandidates(owner, { checkInId: checkIn.id, goal: 'STRENGTH' }).items;
    const previewInput: PreviewWorkoutContextV2 = { schemaVersion: 'WORKOUT_PLANNING_V2', goal: 'STRENGTH', checkInId: checkIn.id,
      expectedCheckInVersion: 1, expectedProfileVersion: 1,
      scheduling: { targetDate: '2026-09-19', durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
      candidateCitationIds: candidates.slice(0, 3).map(c => c.citationId), authorization: { disclosureVersion: 'HEALTH_DISCLOSURE_V2',
        allowedFields: ['PROFILE_GOALS', 'PROFILE_EQUIPMENT', 'PROFILE_LIMITATIONS', 'CHECK_IN', 'CANDIDATES', 'SCHEDULING', 'RECENT_FEEDBACK', 'FITNESS_MEMORY'], selectedFitnessMemoryIds: [] } };
    const preview = service.previewContext(owner, previewInput);
    const command = { schemaVersion: previewInput.schemaVersion, goal: previewInput.goal, checkInId: checkIn.id,
      expectedCheckInVersion: 1, expectedProfileVersion: 1, scheduling: previewInput.scheduling, disclosureVersion: 'HEALTH_DISCLOSURE_V2' as const,
      contextHash: preview.contextHash, allowedFields: previewInput.authorization.allowedFields, consentedAt: now().toISOString() };
    const unavailable = createWorkoutPlanningService(db, calendar, fitness, health, idem, { now, memory });
    expect(unavailable.getCapability(owner).availability).toBe('NOT_CONFIGURED');
    await expect(unavailable.createDetailedWorkout(owner, command, randomUUID())).rejects.toMatchObject({ statusCode: 503 });
    expect(calls).toBe(0);
    const key = randomUUID();
    const draft = await service.createDetailedWorkout(owner, command, key);
    expect(draft.totalDurationSeconds).toBe(705);
    expect(draft.workout.state).toBe('DRAFT');
    expect((await service.createDetailedWorkout(owner, command, key)).replayed).toBe(true);
    expect(calls).toBe(1);
    expect(() => fitness.getWorkout(owner, draft.workout.id)).toThrowError(expect.objectContaining({ statusCode: 409 }));
    expect(fitness.listWorkouts(owner, { page: 1, pageSize: 1 }).pagination.total).toBe(0);
    const legacy = await fitness.createWorkout(owner, { mode: 'MANUAL', checkInId: checkIn.id, goal: 'STRENGTH',
      expectedCheckInVersion: 1, availableEquipment: ['MAT', 'CHAIR', 'WALL'],
      scheduling: previewInput.scheduling, citationIds: [loadInternalExerciseCatalog().items[0]!.citation.citationId] }, randomUUID());
    expect(fitness.listWorkouts(owner, { page: 1, pageSize: 1 })).toMatchObject({ items: [{ id: legacy.workout.id }], pagination: { total: 1, totalPages: 1 } });
    expect(service.listDetailedWorkouts(owner, { page: 1, pageSize: 50 }).pagination.total).toBe(2);
    const { revision: r } = draft;
    const edit = { expectedVersion: 1, parentRevisionId: r.id, title: 'Owner edited', rationale: r.rationale, goal: r.goal,
      items: r.items, alternatives: r.alternatives, scheduling: r.scheduling, contextReceipt: r.contextReceipt, policyVersion: r.policyVersion };
    const revised = service.reviseDetailedWorkout(owner, draft.workout.id, edit, randomUUID());
    expect(revised.revision.title).toBe('Owner edited');
    expect(() => service.reviseDetailedWorkout(owner, draft.workout.id, edit, randomUUID())).toThrowError(expect.objectContaining({ statusCode: 409 }));
    const proposed = service.createDetailedWorkoutProposal(owner, draft.workout.id, { expectedVersion: revised.workout.version, revisionId: revised.revision.id }, randomUUID());
    const decisions = createProposalService(createProposalRepository(db), calendar, { database: db, now });
    db.exec('savepoint fit03d_tamper');
    try {
      const changes = structuredClone(proposed.proposal.changes);
      const change = changes[0]!;
      if (change.operation !== 'CREATE_WORKOUT_ACTION') throw new Error('Unexpected proposal');
      change.action.title = 'Unreviewed title';
      db.prepare('update proposals set changes_json = ? where id = ?').run(JSON.stringify(changes), proposed.proposal.id);
      expect(() => decisions.decide(owner, proposed.proposal.id, { version: 1, decision: 'ACCEPT' })).toThrow();
      expect(db.prepare('select count(*) as n from actions').get()).toEqual({ n: 0 });
      expect(db.prepare('select count(*) as n from time_requests').get()).toEqual({ n: 0 });
    } finally { db.exec('rollback to fit03d_tamper'); db.exec('release fit03d_tamper'); }
    db.exec('savepoint fit03d_risk');
    try {
      fitness.checkInV2(owner, { localDate: '2026-09-19', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 1, hasPain: true, acuteRisk: false }, randomUUID());
      expect(() => decisions.decide(owner, proposed.proposal.id, { version: 1, decision: 'ACCEPT' })).toThrowError(expect.objectContaining({ statusCode: 422, code: 'WORKOUT_SAFETY_BLOCKED' }));
      expect(db.prepare('select count(*) as n from actions').get()).toEqual({ n: 0 });
    } finally { db.exec('rollback to fit03d_risk'); db.exec('release fit03d_risk'); }
    decisions.decide(owner, proposed.proposal.id, { version: 1, decision: 'ACCEPT' });
    const detail = service.getDetailedWorkout(owner, draft.workout.id);
    expect(detail.action?.title).toBe('Owner edited');
    expect(detail.timeRequest?.durationMinutes).toBe(30);
    expect(detail.citations[0]?.name).toBeTruthy();
    expect(db.prepare('select count(*) as n from events').get()).toEqual({ n: 0 });
    expect(service.listDetailedWorkouts(owner, { page: 1, pageSize: 50 }).items.find(i => i.workout.id === draft.workout.id)?.revisionSchema).toBe('WORKOUT_PLAN_V2');
    expect(() => service.getDetailedWorkout(randomUUID(), draft.workout.id)).toThrowError(expect.objectContaining({ statusCode: 404 }));
    const feedbackInput = { expectedVersion: detail.workout.version, outcome: 'COMPLETED' as const, perceivedEffort: 4, hadPain: false,
      note: 'Synthetic actual feedback', startedAt: '2026-09-19T07:40:00.000Z', endedAt: '2026-09-19T07:52:00.000Z' };
    const feedbackKey = randomUUID();
    const feedback = service.recordDetailedWorkoutFeedback(owner, draft.workout.id, feedbackInput, feedbackKey);
    expect(feedback.memoryStatus.state).toBe('RECORDED');
    expect(feedback.feedback).toMatchObject({ perceivedEffort: 4, startedAt: feedbackInput.startedAt, endedAt: feedbackInput.endedAt });
    const identity = { scopeType: 'FITNESS' as const, scopeId: owner };
    const document = memory.read(owner, identity)!;
    expect(document.content).toContain(String(feedback.feedback.id));
    expect(document.content).toContain('720');
    expect(service.recordDetailedWorkoutFeedback(owner, draft.workout.id, feedbackInput, feedbackKey).replayed).toBe(true);
    expect(memory.read(owner, identity)?.version).toBe(document.version);
    const metadata = service.listMemory(owner).items;
    expect(metadata[0]).not.toHaveProperty('content');
    const next = service.previewContext(owner, { ...previewInput, authorization: { ...previewInput.authorization, selectedFitnessMemoryIds: metadata.map(m => m.id) } });
    expect(next.payload.recentFeedback[0]?.actualDurationSeconds).toBe(720);
    expect(next.payload.selectedFitnessMemory[0]?.content).toContain(String(feedback.feedback.id));
    memory.remove(owner, identity, document.version);
    service.recordDetailedWorkoutFeedback(owner, draft.workout.id, feedbackInput, feedbackKey);
    expect(memory.read(owner, identity)).toBeUndefined();
    expect(calls).toBe(1);
    const freshAccepted = async () => {
      const p = service.previewContext(owner, previewInput);
      const created = await service.createDetailedWorkout(owner, { ...command, contextHash: p.contextHash }, randomUUID());
      const proposal = service.createDetailedWorkoutProposal(owner, created.workout.id, { expectedVersion: 1, revisionId: created.revision.id }, randomUUID());
      decisions.decide(owner, proposal.proposal.id, { version: 1, decision: 'ACCEPT' });
      return service.getDetailedWorkout(owner, created.workout.id).workout;
    };
    const second = await freshAccepted();
    const secondFeedback = service.recordDetailedWorkoutFeedback(owner, second.id, { ...feedbackInput, expectedVersion: second.version }, randomUUID());
    expect(secondFeedback.memoryStatus.state).toBe('RECORDED');
    const secondDocument = memory.read(owner, identity)!;
    expect(secondDocument.content).not.toContain(String(feedback.feedback.id));
    const automatic = await freshAccepted();
    const automaticFeedback = service.recordDetailedWorkoutFeedback(owner, automatic.id, { ...feedbackInput, expectedVersion: automatic.version }, randomUUID());
    expect(automaticFeedback.memoryStatus.state).toBe('RECORDED');
    const automaticDocument = memory.read(owner, identity)!;
    expect(automaticDocument.version).toBe(secondDocument.version + 1);
    expect(automaticDocument.content).not.toContain(String(secondFeedback.feedback.id));
    expect(automaticDocument.content.length).toBeLessThan(2000);
    memory.write(owner, identity, 'Owner edited memory', automaticDocument.version);
    const third = await freshAccepted();
    expect(service.recordDetailedWorkoutFeedback(owner, third.id, { ...feedbackInput, expectedVersion: third.version }, randomUUID()).memoryStatus.state).toBe('SKIPPED_HUMAN_EDIT');
    expect(memory.read(owner, identity)?.content).toBe('Owner edited memory');
    const fourth = await freshAccepted();
    memory.remove(owner, identity, memory.read(owner, identity)!.version);
    const blockedRoot = join(root, 'synthetic-not-a-directory');
    writeFileSync(blockedRoot, 'synthetic');
    const failingMemory = createEntityMemoryService(db, blockedRoot, createMemoryService(db, blockedRoot, { now }), { now });
    const failing = createWorkoutPlanningService(db, calendar, fitness, health, idem, { ...options,
      memory: failingMemory });
    const failureKey = randomUUID();
    const fourthInput = { ...feedbackInput, expectedVersion: fourth.version };
    const degraded = failing.recordDetailedWorkoutFeedback(owner, fourth.id, fourthInput, failureKey);
    expect(degraded.memoryStatus.state).toBe('DEGRADED');
    expect(repo.findWorkoutFeedback(owner, fourth.id)).toBeDefined();
    expect(memory.read(owner, identity)).toBeUndefined();
    expect(service.recordDetailedWorkoutFeedback(owner, fourth.id, fourthInput, failureKey).memoryStatus.state).toBe('REPLAYED');
    const lastPreview = service.previewContext(owner, previewInput);
    await expect(service.createDetailedWorkout(owner, { ...command, contextHash: lastPreview.contextHash }, randomUUID())).rejects.toMatchObject({ statusCode: 429 });
    expect(calls).toBe(5);
    expect(db.prepare('select count(*) as n from events').get()).toEqual({ n: 0 });
    // Next synthetic day: auto A v1, then B recreated by another connection at the same version.
    clock = new Date('2026-09-20T08:00:00.000Z');
    const latest = fitness.checkInV2(owner, { localDate: '2026-09-20', sleepMinutes: 480, energyLevel: 5,
      discomfortLevel: 0, hasPain: false, acuteRisk: false }, randomUUID()).checkIn;
    previewInput.checkInId = latest.id;
    command.checkInId = latest.id;
    const seed = await freshAccepted();
    const seedFeedback = service.recordDetailedWorkoutFeedback(owner, seed.id, { ...feedbackInput, expectedVersion: seed.version }, randomUUID());
    expect(seedFeedback.memoryStatus.state).toBe('RECORDED');
    expect(memory.read(owner, identity)?.version).toBe(1);
    const autoParent = memory.listRevisions(owner, identity)[0]!.id;
    const raceWorkout = await freshAccepted();
    const db2 = new Database(databasePath);
    db2.pragma('foreign_keys = ON');
    const memory2 = createEntityMemoryService(db2, root, createMemoryService(db2, root, { now }), { now });
    let interleaves = 0;
    let humanRevision = '';
    const segment = createHash('sha256').update(owner).digest('hex');
    const projection = join(root, 'entities', segment, 'FITNESS', segment, 'MEMORY.md');
    let humanProjection = '';
    const interleave = () => {
      expect(db.inTransaction).toBe(false);
      expect(repo.findWorkoutFeedback(owner, raceWorkout.id)).toBeDefined();
      expect(memory2.read(owner, identity)?.version).toBe(1);
      memory2.remove(owner, identity, 1);
      memory2.write(owner, identity, 'Human B recreated', null);
      humanRevision = memory2.listRevisions(owner, identity)[0]!.id;
      expect(humanRevision).not.toBe(autoParent);
      humanProjection = readFileSync(projection, 'utf8');
      interleaves++;
    };
    // Wrap both old and repaired write entrances: the scheduling of the race is unchanged in RED/GREEN.
    const racingMemory: typeof memory = { ...memory,
      write(...args) { interleave(); return memory.write(...args); },
      writeForCompaction(...args) { interleave(); return memory.writeForCompaction(...args); },
    };
    try {
      const racing = createWorkoutPlanningService(db, calendar, fitness, health, idem, { ...options, memory: racingMemory });
      const raceKey = randomUUID();
      const raceInput = { ...feedbackInput, expectedVersion: raceWorkout.version };
      const result = racing.recordDetailedWorkoutFeedback(owner, raceWorkout.id, raceInput, raceKey);
      expect(interleaves).toBe(1);
      expect(memory2.read(owner, identity)).toMatchObject({ content: 'Human B recreated', version: 1 });
      expect(memory2.listRevisions(owner, identity).map(r => r.id)).toEqual([humanRevision]);
      expect(readFileSync(projection, 'utf8')).toBe(humanProjection);
      expect(result.memoryStatus.state).toBe('DEGRADED');
      expect(repo.findWorkoutFeedback(owner, raceWorkout.id)?.id).toBe(result.feedback.id);
      expect(db.prepare("select count(*) as n from v07_audit_events where owner_id = ? and event_type = 'FITNESS_MEMORY_ATTEMPT' and entity_id = ?").get(owner, result.feedback.id)).toEqual({ n: 1 });
      expect(db.prepare("select count(*) as n from v07_audit_events where owner_id = ? and event_type = 'FITNESS_MEMORY_WRITTEN' and json_extract(metadata_json, '$.sourceId') = ?").get(owner, `feedback:${String(result.feedback.id)}`)).toEqual({ n: 0 });
      expect(racing.recordDetailedWorkoutFeedback(owner, raceWorkout.id, raceInput, raceKey).memoryStatus.state).toBe('REPLAYED');
      expect(interleaves).toBe(1);
      expect(calls).toBe(7);
      expect(db.prepare('select count(*) as n from events').get()).toEqual({ n: 0 });
    } finally { db2.close(); }
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
