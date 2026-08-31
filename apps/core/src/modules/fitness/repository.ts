import type {
  CreateFitnessCheckInInput,
  FitnessCheckIn,
  Workout,
  WorkoutRevision,
} from '@ev/contracts';
import {
  fitnessCheckInSchema,
  workoutRevisionSchema,
  workoutSchema,
} from '@ev/contracts';
import type Database from 'better-sqlite3';

interface CheckInRow {
  id: string;
  signal_id: string;
  local_date: string;
  sleep_minutes: number;
  energy_level: number;
  discomfort_level: number;
  has_pain: number;
  acute_risk: number;
  recovery_json: string;
  safety_json: string;
  policy_version: 'WORKOUT_SAFETY_V1';
  version: 1;
  created_at: string;
}

interface WorkoutRow {
  id: string;
  check_in_id: string;
  signal_id: string;
  generation_mode: 'MANUAL' | 'ASSISTED';
  state: Workout['state'];
  current_revision_id: string;
  proposal_id: string | null;
  action_id: string | null;
  time_request_id: string | null;
  feedback_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  id: string;
  workout_id: string;
  parent_revision_id: string | null;
  revision_no: number;
  title: string;
  rationale: string;
  plan_json: string;
  content_hash: string;
  created_at: string;
}

function toCheckIn(row: CheckInRow): FitnessCheckIn {
  return fitnessCheckInSchema.parse({
    id: row.id,
    signalId: row.signal_id,
    localDate: row.local_date,
    sleepMinutes: row.sleep_minutes,
    energyLevel: row.energy_level,
    discomfortLevel: row.discomfort_level,
    hasPain: row.has_pain === 1,
    acuteRisk: row.acute_risk === 1,
    recovery: JSON.parse(row.recovery_json),
    safety: JSON.parse(row.safety_json),
    policyVersion: row.policy_version,
    version: row.version,
    createdAt: row.created_at,
  });
}

function toWorkout(row: WorkoutRow): Workout {
  return workoutSchema.parse({
    id: row.id,
    checkInId: row.check_in_id,
    signalId: row.signal_id,
    generationMode: row.generation_mode,
    state: row.state,
    currentRevisionId: row.current_revision_id,
    proposalId: row.proposal_id,
    actionId: row.action_id,
    timeRequestId: row.time_request_id,
    feedbackId: row.feedback_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toRevision(row: RevisionRow): WorkoutRevision {
  const plan = JSON.parse(row.plan_json) as {
    items: WorkoutRevision['items'];
    scheduling: WorkoutRevision['scheduling'];
    provenance: WorkoutRevision['provenance'];
  };
  return workoutRevisionSchema.parse({
    id: row.id,
    workoutId: row.workout_id,
    parentRevisionId: row.parent_revision_id,
    revisionNo: row.revision_no,
    title: row.title,
    rationale: row.rationale,
    ...plan,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  });
}

export interface FitnessRepository {
  transaction<T>(operation: () => T): T;
  createCheckIn(input: { ownerId: string; checkIn: FitnessCheckIn; raw: CreateFitnessCheckInInput }): FitnessCheckIn;
  listCheckIns(ownerId: string, query: { localDate?: string; eligibility?: 'BLOCKED' | 'ELIGIBLE'; page: number; pageSize: number }): { items: FitnessCheckIn[]; total: number };
  findCheckIn(ownerId: string, id: string): FitnessCheckIn | undefined;
  createWorkoutWithRevision(input: { ownerId: string; workout: Workout; revision: WorkoutRevision; catalog: { id: string; version: string; hash: string } }): { workout: Workout; revision: WorkoutRevision };
  appendWorkoutRevision(input: { ownerId: string; workoutId: string; expectedVersion: number; revision: WorkoutRevision; catalog: { id: string; version: string; hash: string }; updatedAt: string }): { workout: Workout; revision: WorkoutRevision } | undefined;
  listWorkouts(ownerId: string, query: { state?: Workout['state']; localDate?: string; page: number; pageSize: number }): { items: Workout[]; total: number };
  findWorkout(ownerId: string, id: string): Workout | undefined;
  findWorkoutRevision(ownerId: string, id: string): WorkoutRevision | undefined;
}

export function createFitnessRepository(database: Database.Database): FitnessRepository {
  const checkInColumns = 'id, signal_id, local_date, sleep_minutes, energy_level, discomfort_level, has_pain, acute_risk, recovery_json, safety_json, policy_version, version, created_at';
  const workoutColumns = 'id, check_in_id, signal_id, generation_mode, state, current_revision_id, proposal_id, action_id, time_request_id, feedback_id, version, created_at, updated_at';
  const revisionColumns = 'id, workout_id, parent_revision_id, revision_no, title, rationale, plan_json, content_hash, created_at';
  const findCheckIn = database.prepare(`select ${checkInColumns} from fitness_check_ins_v2 where owner_id = ? and id = ?`);
  const findWorkout = database.prepare(`select ${workoutColumns} from workouts_v2 where owner_id = ? and id = ?`);
  const findRevision = database.prepare(`select ${revisionColumns} from workout_revisions_v2 where owner_id = ? and id = ?`);
  const insertCheckIn = database.prepare(`insert into fitness_check_ins_v2 (
    id, owner_id, local_date, sleep_minutes, energy_level, discomfort_level, has_pain, acute_risk,
    signal_id, recovery_json, safety_json, policy_version, version, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertWorkout = database.prepare(`insert into workouts_v2 (
    id, owner_id, check_in_id, signal_id, generation_mode, state, current_revision_id, proposal_id,
    action_id, time_request_id, feedback_id, version, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertRevision = database.prepare(`insert into workout_revisions_v2 (
    id, owner_id, workout_id, parent_revision_id, revision_no, title, rationale, plan_json,
    catalog_id, catalog_version, catalog_hash, content_hash, created_by, capability_run_id, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertCitation = database.prepare(`insert into workout_revision_citations_v2 (
    id, owner_id, revision_id, citation_id, position, catalog_id, catalog_version, catalog_hash,
    exercise_id, item_hash, source_kind, redistribution, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateWorkoutRevision = database.prepare(`update workouts_v2
    set current_revision_id = ?, version = version + 1, updated_at = ?
    where id = ? and owner_id = ? and state = 'DRAFT' and version = ?`);

  const storeRevision = (ownerId: string, revision: WorkoutRevision, catalog: { id: string; version: string; hash: string }): void => {
    insertRevision.run(
      revision.id,
      ownerId,
      revision.workoutId,
      revision.parentRevisionId,
      revision.revisionNo,
      revision.title,
      revision.rationale,
      JSON.stringify({ items: revision.items, scheduling: revision.scheduling, provenance: revision.provenance }),
      catalog.id,
      catalog.version,
      catalog.hash,
      revision.contentHash,
      revision.provenance.at(-1)?.kind === 'MODEL_SELECTION' ? 'MODEL' : revision.provenance.at(-1)?.kind === 'OWNER_EDIT' ? 'OWNER' : 'RULES',
      revision.provenance.at(-1)?.capabilityRunId ?? null,
      revision.createdAt,
    );
    revision.items.forEach((item, position) => {
      insertCitation.run(
        `${revision.id}:citation:${position}`,
        ownerId,
        revision.id,
        item.citation.citationId,
        position,
        item.citation.catalogId,
        item.citation.catalogVersion,
        item.citation.catalogHash,
        item.citation.exerciseId,
        item.citation.itemHash,
        item.citation.sourceKind,
        item.citation.redistribution ? 1 : 0,
        revision.createdAt,
      );
    });
  };

  return {
    transaction(operation) {
      return database.transaction(operation)();
    },
    createCheckIn(input) {
      insertCheckIn.run(
        input.checkIn.id,
        input.ownerId,
        input.checkIn.localDate,
        input.raw.sleepMinutes,
        input.raw.energyLevel,
        input.raw.discomfortLevel,
        input.raw.hasPain ? 1 : 0,
        input.raw.acuteRisk ? 1 : 0,
        input.checkIn.signalId,
        JSON.stringify(input.checkIn.recovery),
        JSON.stringify(input.checkIn.safety),
        input.checkIn.policyVersion,
        input.checkIn.version,
        input.checkIn.createdAt,
      );
      return input.checkIn;
    },
    listCheckIns(ownerId, query) {
      const filters: string[] = ['owner_id = ?'];
      const params: Array<string | number> = [ownerId];
      if (query.localDate) { filters.push('local_date = ?'); params.push(query.localDate); }
      if (query.eligibility) { filters.push(`json_extract(safety_json, '$.eligibility') = ?`); params.push(query.eligibility); }
      const where = filters.join(' and ');
      const total = (database.prepare(`select count(*) as count from fitness_check_ins_v2 where ${where}`).get(...params) as { count: number }).count;
      const rows = database.prepare(`select ${checkInColumns} from fitness_check_ins_v2 where ${where} order by local_date desc, created_at desc, id asc limit ? offset ?`)
        .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as CheckInRow[];
      return { items: rows.map(toCheckIn), total };
    },
    findCheckIn(ownerId, id) {
      const row = findCheckIn.get(ownerId, id) as CheckInRow | undefined;
      return row ? toCheckIn(row) : undefined;
    },
    createWorkoutWithRevision(input) {
      return database.transaction(() => {
        insertWorkout.run(
          input.workout.id, input.ownerId, input.workout.checkInId, input.workout.signalId,
          input.workout.generationMode, input.workout.state, input.workout.currentRevisionId,
          input.workout.proposalId, input.workout.actionId, input.workout.timeRequestId,
          input.workout.feedbackId, input.workout.version, input.workout.createdAt, input.workout.updatedAt,
        );
        storeRevision(input.ownerId, input.revision, input.catalog);
        return { workout: input.workout, revision: input.revision };
      })();
    },
    appendWorkoutRevision(input) {
      return database.transaction(() => {
        const changed = updateWorkoutRevision.run(
          input.revision.id, input.updatedAt, input.workoutId, input.ownerId, input.expectedVersion,
        ).changes;
        if (changed !== 1) return undefined;
        storeRevision(input.ownerId, input.revision, input.catalog);
        const workout = findWorkout.get(input.ownerId, input.workoutId) as WorkoutRow;
        return { workout: toWorkout(workout), revision: input.revision };
      })();
    },
    listWorkouts(ownerId, query) {
      const filters: string[] = ['w.owner_id = ?'];
      const params: Array<string | number> = [ownerId];
      if (query.state) { filters.push('w.state = ?'); params.push(query.state); }
      if (query.localDate) { filters.push('c.local_date = ?'); params.push(query.localDate); }
      const where = filters.join(' and ');
      const total = (database.prepare(`select count(*) as count from workouts_v2 w join fitness_check_ins_v2 c on c.id = w.check_in_id and c.owner_id = w.owner_id where ${where}`).get(...params) as { count: number }).count;
      const rows = database.prepare(`select ${workoutColumns.split(', ').map((column) => `w.${column}`).join(', ')} from workouts_v2 w join fitness_check_ins_v2 c on c.id = w.check_in_id and c.owner_id = w.owner_id where ${where} order by w.updated_at desc, w.id asc limit ? offset ?`)
        .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as WorkoutRow[];
      return { items: rows.map(toWorkout), total };
    },
    findWorkout(ownerId, id) {
      const row = findWorkout.get(ownerId, id) as WorkoutRow | undefined;
      return row ? toWorkout(row) : undefined;
    },
    findWorkoutRevision(ownerId, id) {
      const row = findRevision.get(ownerId, id) as RevisionRow | undefined;
      return row ? toRevision(row) : undefined;
    },
  };
}
