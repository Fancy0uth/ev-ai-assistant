import type {
  Action,
  ActivitySession,
  CreateFitnessCheckInInput,
  FitnessCheckIn,
  Proposal,
  Workout,
  WorkoutRevision,
} from '@ev/contracts';
import {
  actionSchema,
  activitySessionSchema,
  fitnessCheckInSchema,
  proposalSchema,
  workoutRevisionSchema,
  workoutSchema,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import * as z from 'zod';
import { workoutPlanningCandidateV2Schema, workoutPlanningProfileV2Schema, workoutRevisionV2Schema,
  type WorkoutPlanningProfileV2, type WorkoutPlanningFeedbackContextV2, type WorkoutRevisionV2 } from '@ev/contracts';
import { ApiError } from '../../http/api-error';

// Strict technical snapshots deliberately exclude health context and memory/feedback text.
export const workoutCandidateSnapshotSchema = z.object({
  candidate: workoutPlanningCandidateV2Schema,
  name: z.string().trim().min(1).max(240),
  instructions: z.array(z.string().trim().min(1).max(600)).min(1).max(10),
}).strict();
export type WorkoutCandidateSnapshot = z.infer<typeof workoutCandidateSnapshotSchema>;
export interface WorkoutRevisionDetailV2 { revision: WorkoutRevisionV2; citations: WorkoutCandidateSnapshot[] }
export interface FitnessMemoryMetadata {
  id: string; version: number; scopeType: 'FITNESS' | 'DOMAIN'; scopeId: string; characters: number;
}
export interface WorkoutRevisionWriteV2 {
  ownerId: string; revision: WorkoutRevisionV2; citations: WorkoutCandidateSnapshot[];
}
export interface FitnessPlanningRepository {
  readProfile(ownerId: string): WorkoutPlanningProfileV2 | undefined;
  saveProfile(ownerId: string, input: { expectedVersion: number | null; profile: Omit<WorkoutPlanningProfileV2, 'version'> }, now: string): WorkoutPlanningProfileV2;
  listRecentFeedback(ownerId: string, now: string): WorkoutPlanningFeedbackContextV2[];
  hasRecentPain(ownerId: string, now: string): boolean;
  listSelectableCurrentFitnessMemory(ownerId: string): FitnessMemoryMetadata[];
  readCurrentFitnessMemory(ownerId: string, id: string): (FitnessMemoryMetadata & { content: string }) | undefined;
  savePreview(ownerId: string, hash: string, selection: unknown, now: string, expiresAt: string): void;
  readPreview(ownerId: string, hash: string, now: string): unknown | undefined;
  createWorkoutWithRevisionV2(input: WorkoutRevisionWriteV2 & { workout: Workout }): { workout: Workout; revision: WorkoutRevisionV2 };
  appendWorkoutRevisionV2(input: WorkoutRevisionWriteV2 & { workoutId: string; expectedVersion: number; updatedAt: string }): { workout: Workout; revision: WorkoutRevisionV2 } | undefined;
  findWorkoutRevisionV2(ownerId: string, id: string): WorkoutRevisionDetailV2 | undefined;
  currentRevisionSchema(ownerId: string, workoutId: string): 'WORKOUT_PLAN_V1' | 'WORKOUT_PLAN_V2' | undefined;
}

export class WorkoutProposalStateConflictError extends Error {
  constructor() {
    super('WORKOUT_PROPOSAL_STATE_CHANGED');
    this.name = 'WorkoutProposalStateConflictError';
  }
}

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

export interface FitnessRepository extends FitnessPlanningRepository {
  transaction<T>(operation: () => T): T;
  createCheckIn(input: { ownerId: string; checkIn: FitnessCheckIn; raw: CreateFitnessCheckInInput }): FitnessCheckIn;
  listCheckIns(ownerId: string, query: { localDate?: string; eligibility?: 'BLOCKED' | 'ELIGIBLE'; page: number; pageSize: number }): { items: FitnessCheckIn[]; total: number };
  findCheckIn(ownerId: string, id: string): FitnessCheckIn | undefined;
  findLatestEffectiveCheckIn(ownerId: string, at: string): FitnessCheckIn | undefined;
  createWorkoutWithRevision(input: { ownerId: string; workout: Workout; revision: WorkoutRevision; catalog: { id: string; version: string; hash: string } }): { workout: Workout; revision: WorkoutRevision };
  appendWorkoutRevision(input: { ownerId: string; workoutId: string; expectedVersion: number; revision: WorkoutRevision; catalog: { id: string; version: string; hash: string }; updatedAt: string }): { workout: Workout; revision: WorkoutRevision } | undefined;
  listWorkouts(ownerId: string, query: { state?: Workout['state']; localDate?: string; page: number; pageSize: number; revisionSchema?: 'WORKOUT_PLAN_V1' | 'WORKOUT_PLAN_V2' }): { items: Workout[]; total: number };
  findWorkout(ownerId: string, id: string): Workout | undefined;
  findWorkoutRevision(ownerId: string, id: string): WorkoutRevision | undefined;
  createWorkoutProposal(input: { ownerId: string; workoutId: string; expectedVersion: number; revisionId: string; proposal: Proposal; updatedAt: string }): Workout;
  findWorkoutProposal(ownerId: string, workoutId: string): Proposal | undefined;
  findWorkoutAction(ownerId: string, workoutId: string): Action | undefined;
  findWorkoutFeedback(ownerId: string, workoutId: string): Record<string, unknown> | undefined;
  recordWorkoutFeedback(input: {
    ownerId: string;
    workoutId: string;
    expectedVersion: number;
    outcome: 'COMPLETED' | 'SKIPPED';
    perceivedEffort: number | null;
    hadPain: boolean;
    note: string | null;
    startedAt: string | null;
    endedAt: string | null;
    feedbackId: string;
    activitySessionId: string;
    now: string;
  }): { workout: Workout; feedback: Record<string, unknown>; action: Action; activitySession: ActivitySession | null } | undefined;
}

function planningConflict(): never {
  throw new ApiError(409, 'WORKOUT_CONTEXT_CHANGED', '训练依据已变化，请重新预览');
}

function createPlanningRepository(db: Database.Database): FitnessPlanningRepository {
  const readProfile = (ownerId: string): WorkoutPlanningProfileV2 | undefined => {
    const row = db.prepare('select profile_json from fitness_planning_profiles where owner_id = ?').get(ownerId) as { profile_json: string } | undefined;
    return row ? workoutPlanningProfileV2Schema.parse(JSON.parse(row.profile_json)) : undefined;
  };
  // Join only the current document to its exact revision. Deletion never falls back to history.
  const memorySql = `
    select r.id, d.version, 'FITNESS' as scopeType, d.scope_id as scopeId, length(d.content) as characters
    from entity_memory_documents d join entity_memory_revisions r
      on r.document_id = d.id and r.owner_id = d.owner_id and r.version = d.version
      and r.scope_type = d.scope_type and r.scope_id = d.scope_id and r.content = d.content
    where d.owner_id = ? and d.scope_type = 'FITNESS' and d.scope_id = ?
    union all
    select r.id, d.version, 'DOMAIN' as scopeType, 'FITNESS' as scopeId, length(d.content) as characters
    from memory_documents d join memory_revisions r
      on r.owner_id = d.owner_id and r.scope = d.scope and r.version = d.version and r.content = d.content
    where d.owner_id = ? and d.scope = 'FITNESS'
    limit 2`;
  const listMemory = (ownerId: string) => db.prepare(memorySql).all(ownerId, ownerId, ownerId) as FitnessMemoryMetadata[];
  const writeRevision = (input: WorkoutRevisionWriteV2) => {
    const revision = workoutRevisionV2Schema.parse(input.revision);
    const citations = z.array(workoutCandidateSnapshotSchema).min(1).max(5).parse(input.citations);
    if (Buffer.byteLength(JSON.stringify(citations)) > 24000) throw new ApiError(413, 'WORKOUT_CITATIONS_TOO_LARGE', '候选快照超限');
    const ids = citations.map((snapshot) => snapshot.candidate.citationId);
    const used = [...revision.items, ...revision.alternatives.map((entry) => entry.item)].map((item) => item.citationId);
    const references = revision.contextReceipt.candidateReferences;
    if (new Set(ids).size !== ids.length || used.some((id) => !ids.includes(id))
      || references.length !== citations.length
      || references.some((ref) => !citations.some(({ candidate }) =>
        ref.citationId === candidate.citationId && ref.sourceKind === candidate.sourceKind &&
        ref.source === candidate.source && ref.version === candidate.version &&
        ref.hash === candidate.hash && ref.itemHash === candidate.itemHash))) {
      throw new ApiError(422, 'WORKOUT_CITATION_MISMATCH', '计划引用不完整');
    }
    const origin = revision.provenance.at(-1)!;
    db.prepare(`insert into workout_revisions_v2 (
      id, owner_id, workout_id, parent_revision_id, revision_no, title, rationale, plan_json,
      catalog_id, catalog_version, catalog_hash, content_hash, created_by, capability_run_id, created_at, revision_schema
    ) values (?, ?, ?, ?, ?, ?, ?, ?, 'WORKOUT_PLANNING_V2', ?, ?, ?, ?, ?, ?, 'WORKOUT_PLAN_V2')`).run(
      revision.id, input.ownerId, revision.workoutId, revision.parentRevisionId, revision.revisionNo,
      revision.title, revision.rationale, JSON.stringify(revision), revision.policyVersion,
      revision.contextReceipt.contextHash, revision.contentHash,
      origin.kind === 'MODEL_SELECTION' ? 'MODEL' : origin.kind === 'OWNER_EDIT' ? 'OWNER' : 'RULES',
      origin.capabilityRunId, revision.createdAt,
    );
    const insert = db.prepare('insert into workout_planning_citations (owner_id, revision_id, citation_id, position, snapshot_json) values (?, ?, ?, ?, ?)');
    citations.forEach((snapshot, position) => insert.run(input.ownerId, revision.id, snapshot.candidate.citationId, position, JSON.stringify(snapshot)));
    return revision;
  };
  return {
    readProfile,
    saveProfile(ownerId, input, now) {
      return db.transaction(() => {
        const current = readProfile(ownerId);
        if (input.expectedVersion !== (current?.version ?? null)) planningConflict();
        const profile = workoutPlanningProfileV2Schema.parse({ ...input.profile, version: (current?.version ?? 0) + 1 });
        if (current) {
          if (db.prepare('update fitness_planning_profiles set version = ?, profile_json = ?, updated_at = ? where owner_id = ? and version = ?')
            .run(profile.version, JSON.stringify(profile), now, ownerId, input.expectedVersion).changes !== 1) planningConflict();
        } else db.prepare('insert into fitness_planning_profiles (owner_id, version, profile_json, updated_at) values (?, ?, ?, ?)')
          .run(ownerId, profile.version, JSON.stringify(profile), now);
        return profile;
      })();
    },
    listRecentFeedback(ownerId, now) {
      const rows = db.prepare(`select f.id, f.workout_id, w.current_revision_id, f.outcome, f.perceived_effort,
        f.had_pain, f.note, f.started_at, f.ended_at from workout_feedback_v2 f
        join workouts_v2 w on w.id = f.workout_id and w.owner_id = f.owner_id
        where f.owner_id = ? and f.created_at >= ? and f.created_at <= ?
        order by f.created_at desc, f.id desc limit 5`).all(ownerId, new Date(Date.parse(now) - 14 * 86400000).toISOString(), now) as Array<{
          id: string; workout_id: string; current_revision_id: string; outcome: 'COMPLETED' | 'SKIPPED';
          perceived_effort: number | null; had_pain: number; note: string | null; started_at: string | null; ended_at: string | null;
        }>;
      return rows.map((row) => ({
        workoutId: row.workout_id, revisionId: row.current_revision_id, feedbackId: row.id, outcome: row.outcome,
        perceivedEffort: row.perceived_effort, hadPain: row.had_pain === 1, note: row.note,
        actualDurationSeconds: row.started_at && row.ended_at ? (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 1000 : null,
      }));
    },
    hasRecentPain(ownerId, now) {
      return !!db.prepare(`select 1 from workout_feedback_v2 where owner_id = ? and had_pain = 1
        and created_at >= ? and created_at <= ? limit 1`)
        .get(ownerId, new Date(Date.parse(now) - 14 * 86400000).toISOString(), now);
    },
    listSelectableCurrentFitnessMemory: listMemory,
    readCurrentFitnessMemory(ownerId, id) {
      const metadata = listMemory(ownerId).find((entry) => entry.id === id);
      if (!metadata) return undefined;
      if (metadata.characters > 2000) throw new ApiError(413, 'WORKOUT_MEMORY_TOO_LARGE', '记忆超过上下文上限');
      const row = metadata.scopeType === 'FITNESS'
        ? db.prepare(`select d.content from entity_memory_documents d join entity_memory_revisions r
          on r.document_id = d.id and r.version = d.version and r.owner_id = d.owner_id
          where d.owner_id = ? and d.scope_type = 'FITNESS' and d.scope_id = ? and r.id = ?`).get(ownerId, ownerId, id)
        : db.prepare(`select d.content from memory_documents d join memory_revisions r
          on r.owner_id = d.owner_id and r.scope = d.scope and r.version = d.version
          where d.owner_id = ? and d.scope = 'FITNESS' and r.id = ?`).get(ownerId, id);
      return row ? { ...metadata, content: (row as { content: string }).content } : undefined;
    },
    savePreview(ownerId, hash, selection, now, expiresAt) {
      db.transaction(() => {
        db.prepare('delete from fitness_planning_previews where owner_id = ? and expires_at <= ?').run(ownerId, now);
        db.prepare(`delete from fitness_planning_previews where owner_id = ? and context_hash in (
          select context_hash from fitness_planning_previews where owner_id = ? order by created_at desc, context_hash desc limit -1 offset 19)`).run(ownerId, ownerId);
        db.prepare(`insert into fitness_planning_previews (owner_id, context_hash, selection_json, created_at, expires_at)
          values (?, ?, ?, ?, ?) on conflict(owner_id, context_hash) do update
          set selection_json = excluded.selection_json, created_at = excluded.created_at, expires_at = excluded.expires_at`)
          .run(ownerId, hash, JSON.stringify(selection), now, expiresAt);
      })();
    },
    readPreview(ownerId, hash, now) {
      const row = db.prepare('select selection_json from fitness_planning_previews where owner_id = ? and context_hash = ? and expires_at > ?')
        .get(ownerId, hash, now) as { selection_json: string } | undefined;
      return row ? JSON.parse(row.selection_json) as unknown : undefined;
    },
    createWorkoutWithRevisionV2(input) {
      return db.transaction(() => {
        const workout = workoutSchema.parse(input.workout);
        if (input.revision.workoutId !== workout.id || workout.currentRevisionId !== input.revision.id ||
          input.revision.parentRevisionId !== null || input.revision.revisionNo !== 1 || workout.state !== 'DRAFT') planningConflict();
        db.prepare(`insert into workouts_v2 (id, owner_id, check_in_id, signal_id, generation_mode, state,
          current_revision_id, proposal_id, action_id, time_request_id, feedback_id, version, created_at, updated_at)
          values (?, ?, ?, ?, ?, 'DRAFT', null, null, null, null, null, ?, ?, ?)`).run(
            workout.id, input.ownerId, workout.checkInId, workout.signalId, workout.generationMode, workout.version, workout.createdAt, workout.updatedAt);
        const revision = writeRevision(input);
        db.prepare('update workouts_v2 set current_revision_id = ? where id = ? and owner_id = ?').run(revision.id, workout.id, input.ownerId);
        return { workout, revision };
      })();
    },
    appendWorkoutRevisionV2(input) {
      return db.transaction(() => {
        const row = db.prepare('select * from workouts_v2 where owner_id = ? and id = ?').get(input.ownerId, input.workoutId) as WorkoutRow | undefined;
        if (!row || row.version !== input.expectedVersion || row.state !== 'DRAFT') return undefined;
        const parent = db.prepare('select revision_no from workout_revisions_v2 where owner_id = ? and id = ? and workout_id = ?')
          .get(input.ownerId, row.current_revision_id, row.id) as { revision_no: number } | undefined;
        if (!parent || input.revision.workoutId !== row.id || input.revision.parentRevisionId !== row.current_revision_id ||
          input.revision.revisionNo !== parent.revision_no + 1) planningConflict();
        const revision = writeRevision(input);
        if (db.prepare(`update workouts_v2 set current_revision_id = ?, updated_at = ?, version = version + 1
          where owner_id = ? and id = ? and version = ? and state = 'DRAFT'`).run(revision.id, input.updatedAt, input.ownerId, row.id, input.expectedVersion).changes !== 1) planningConflict();
        return { workout: toWorkout({ ...row, current_revision_id: revision.id, updated_at: input.updatedAt, version: row.version + 1 }), revision };
      })();
    },
    findWorkoutRevisionV2(ownerId, id) {
      const row = db.prepare("select plan_json from workout_revisions_v2 where owner_id = ? and id = ? and revision_schema = 'WORKOUT_PLAN_V2'")
        .get(ownerId, id) as { plan_json: string } | undefined;
      if (!row) return undefined;
      const citations = db.prepare('select snapshot_json from workout_planning_citations where owner_id = ? and revision_id = ? order by position limit 5')
        .all(ownerId, id) as Array<{ snapshot_json: string }>;
      return { revision: workoutRevisionV2Schema.parse(JSON.parse(row.plan_json)), citations: citations.map((entry) => workoutCandidateSnapshotSchema.parse(JSON.parse(entry.snapshot_json))) };
    },
    currentRevisionSchema(ownerId, workoutId) {
      const row = db.prepare(`select r.revision_schema from workouts_v2 w join workout_revisions_v2 r
        on r.id = w.current_revision_id and r.owner_id = w.owner_id and r.workout_id = w.id
        where w.owner_id = ? and w.id = ?`).get(ownerId, workoutId) as { revision_schema: 'WORKOUT_PLAN_V1' | 'WORKOUT_PLAN_V2' } | undefined;
      return row?.revision_schema;
    },
  };
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
  const setInitialWorkoutRevision = database.prepare(`update workouts_v2
    set current_revision_id = ?
    where id = ? and owner_id = ? and state = 'DRAFT' and current_revision_id is null and version = ?`);
  const updateWorkoutRevision = database.prepare(`update workouts_v2
    set current_revision_id = ?, version = version + 1, updated_at = ?
    where id = ? and owner_id = ? and state = 'DRAFT' and version = ?`);
  const markProposalPending = database.prepare(`update workouts_v2
    set state = 'PROPOSAL_PENDING', proposal_id = ?, updated_at = ?, version = version + 1
    where id = ? and owner_id = ? and state = 'DRAFT' and current_revision_id = ? and version = ?`);
  const insertProposal = database.prepare(`insert into proposals (
    id, owner_id, kind, status, source, title, changes_json, version, created_at, expires_at, decided_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`);
  const findProposal = database.prepare(`select p.id, p.kind, p.status, p.source, p.title, p.changes_json,
    p.version, p.created_at, p.expires_at from proposals p join workouts_v2 w on w.proposal_id = p.id
    where p.owner_id = ? and w.owner_id = ? and w.id = ?`);
  const findAction = database.prepare(`select a.id, a.event_id, a.title, a.kind, a.status, a.target_date,
    a.version, a.created_at, a.updated_at from actions a join workout_actions_v2 w on w.action_id = a.id
    where w.owner_id = ? and w.workout_id = ? and a.owner_id = ?`);
  const acceptedWorkout = database.prepare(`select ${workoutColumns} from workouts_v2
    where owner_id = ? and id = ? and state = 'ACCEPTED' and version = ?`);
  const insertActivitySession = database.prepare(`insert into activity_sessions (
    id, owner_id, action_id, kind, started_at, ended_at, summary, version, created_at, updated_at
  ) values (?, ?, ?, 'WORKOUT', ?, ?, null, 1, ?, ?)`);
  const finishAction = database.prepare(`update actions set status = ?, updated_at = ?, version = version + 1
    where id = ? and owner_id = ? and status in ('OPEN', 'IN_PROGRESS')`);
  const activeTimeRequest = database.prepare(`select id, version from time_requests
    where owner_id = ? and id = ? and lifecycle_status = 'ACTIVE'`);
  const closeTimeRequest = database.prepare(`update time_requests
    set lifecycle_status = 'CLOSED', closed_at = ?, closed_reason = ?, updated_at = ?, version = version + 1
    where id = ? and owner_id = ? and lifecycle_status = 'ACTIVE' and version = ?`);
  const insertFeedback = database.prepare(`insert into workout_feedback_v2 (
    id, owner_id, workout_id, action_id, outcome, perceived_effort, had_pain, note, started_at,
    ended_at, activity_session_id, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const completeWorkout = database.prepare(`update workouts_v2
    set state = ?, feedback_id = ?, updated_at = ?, version = version + 1
    where id = ? and owner_id = ? and state = 'ACCEPTED' and version = ?`);
  const findFeedback = database.prepare(`select id, workout_id, action_id, outcome, perceived_effort, had_pain,
    note, started_at, ended_at, activity_session_id, created_at from workout_feedback_v2
    where owner_id = ? and workout_id = ?`);
  const findLinkedAction = (ownerId: string, workoutId: string): Action | undefined => {
    const row = findAction.get(ownerId, workoutId, ownerId) as {
      id: string; event_id: string | null; title: string; kind: Action['kind']; status: Action['status'];
      target_date: string | null; version: number; created_at: string; updated_at: string;
    } | undefined;
    return row ? actionSchema.parse({
      id: row.id, eventId: row.event_id, title: row.title, kind: row.kind, status: row.status,
      targetDate: row.target_date, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    }) : undefined;
  };

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
    ...createPlanningRepository(database),
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
    findLatestEffectiveCheckIn(ownerId, at) {
      // Check-ins are append-only. Equal server timestamps use insertion order, never random UUID order.
      const row = database.prepare(`select ${checkInColumns} from fitness_check_ins_v2
        where owner_id = ? and created_at <= ?
        order by created_at desc, rowid desc limit 1`).get(ownerId, at) as CheckInRow | undefined;
      return row ? toCheckIn(row) : undefined;
    },
    createWorkoutWithRevision(input) {
      return database.transaction(() => {
        insertWorkout.run(
          input.workout.id, input.ownerId, input.workout.checkInId, input.workout.signalId,
          input.workout.generationMode, input.workout.state, null,
          input.workout.proposalId, input.workout.actionId, input.workout.timeRequestId,
          input.workout.feedbackId, input.workout.version, input.workout.createdAt, input.workout.updatedAt,
        );
        storeRevision(input.ownerId, input.revision, input.catalog);
        if (setInitialWorkoutRevision.run(
          input.revision.id, input.workout.id, input.ownerId, input.workout.version,
        ).changes !== 1) throw new Error('WORKOUT_INITIAL_REVISION_LINK_FAILED');
        return { workout: input.workout, revision: input.revision };
      })();
    },
    appendWorkoutRevision(input) {
      return database.transaction(() => {
        const current = findWorkout.get(input.ownerId, input.workoutId) as WorkoutRow | undefined;
        if (!current || current.state !== 'DRAFT' || current.version !== input.expectedVersion) return undefined;
        storeRevision(input.ownerId, input.revision, input.catalog);
        const changed = updateWorkoutRevision.run(
          input.revision.id, input.updatedAt, input.workoutId, input.ownerId, input.expectedVersion,
        ).changes;
        if (changed !== 1) throw new Error('WORKOUT_REVISION_LINK_FAILED');
        const workout = findWorkout.get(input.ownerId, input.workoutId) as WorkoutRow;
        return { workout: toWorkout(workout), revision: input.revision };
      })();
    },
    listWorkouts(ownerId, query) {
      const filters: string[] = ['w.owner_id = ?'];
      const params: Array<string | number> = [ownerId];
      if (query.state) { filters.push('w.state = ?'); params.push(query.state); }
      if (query.localDate) { filters.push('c.local_date = ?'); params.push(query.localDate); }
      if (query.revisionSchema) {
        filters.push('exists (select 1 from workout_revisions_v2 r where r.owner_id = w.owner_id and r.workout_id = w.id and r.id = w.current_revision_id and r.revision_schema = ?)');
        params.push(query.revisionSchema);
      }
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
    createWorkoutProposal(input) {
      return database.transaction(() => {
        const proposal = proposalSchema.parse(input.proposal);
        insertProposal.run(
          proposal.id, input.ownerId, proposal.kind, proposal.status, proposal.source, proposal.title,
          JSON.stringify(proposal.changes), proposal.version, proposal.createdAt, proposal.expiresAt,
        );
        const changed = markProposalPending.run(
          proposal.id, input.updatedAt, input.workoutId, input.ownerId, input.revisionId, input.expectedVersion,
        ).changes;
        if (changed !== 1) throw new WorkoutProposalStateConflictError();
        return toWorkout(findWorkout.get(input.ownerId, input.workoutId) as WorkoutRow);
      })();
    },
    findWorkoutProposal(ownerId, workoutId) {
      const row = findProposal.get(ownerId, ownerId, workoutId) as {
        id: string; kind: Proposal['kind']; status: Proposal['status']; source: Proposal['source']; title: string;
        changes_json: string; version: number; created_at: string; expires_at: string | null;
      } | undefined;
      return row ? proposalSchema.parse({
        id: row.id, kind: row.kind, status: row.status, source: row.source, title: row.title,
        changes: JSON.parse(row.changes_json), version: row.version, createdAt: row.created_at, expiresAt: row.expires_at,
      }) : undefined;
    },
    findWorkoutAction(ownerId, workoutId) {
      return findLinkedAction(ownerId, workoutId);
    },
    findWorkoutFeedback(ownerId, workoutId) {
      const row = findFeedback.get(ownerId, workoutId) as {
        id: string; workout_id: string; action_id: string; outcome: 'COMPLETED' | 'SKIPPED';
        perceived_effort: number | null; had_pain: number; note: string | null; started_at: string | null;
        ended_at: string | null; activity_session_id: string | null; created_at: string;
      } | undefined;
      return row ? {
        id: row.id, workoutId: row.workout_id, actionId: row.action_id, outcome: row.outcome,
        perceivedEffort: row.perceived_effort, hadPain: row.had_pain === 1, note: row.note,
        startedAt: row.started_at, endedAt: row.ended_at, activitySessionId: row.activity_session_id,
        createdAt: row.created_at,
      } : undefined;
    },
    recordWorkoutFeedback(input) {
      return database.transaction(() => {
        const current = acceptedWorkout.get(input.ownerId, input.workoutId, input.expectedVersion) as WorkoutRow | undefined;
        if (!current || current.action_id === null || current.time_request_id === null) return undefined;
        const activitySession = input.outcome === 'COMPLETED'
          ? activitySessionSchema.parse({
            id: input.activitySessionId, actionId: current.action_id, kind: 'WORKOUT', startedAt: input.startedAt,
            endedAt: input.endedAt, summary: null, version: 1, createdAt: input.now, updatedAt: input.now,
          })
          : null;
        if (activitySession) {
          insertActivitySession.run(activitySession.id, input.ownerId, current.action_id, activitySession.startedAt, activitySession.endedAt, input.now, input.now);
        }
        const actionStatus = input.outcome === 'COMPLETED' ? 'DONE' : 'CANCELLED';
        if (finishAction.run(actionStatus, input.now, current.action_id, input.ownerId).changes !== 1) {
          throw new Error('WORKOUT_ACTION_STATE_CHANGED');
        }
        const request = activeTimeRequest.get(input.ownerId, current.time_request_id) as { id: string; version: number } | undefined;
        if (request) {
          if (closeTimeRequest.run(input.now, input.outcome === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED', input.now, request.id, input.ownerId, request.version).changes !== 1) {
            throw new Error('WORKOUT_TIME_REQUEST_STATE_CHANGED');
          }
        }
        insertFeedback.run(
          input.feedbackId, input.ownerId, input.workoutId, current.action_id, input.outcome,
          input.perceivedEffort, input.hadPain ? 1 : 0, input.note, input.startedAt, input.endedAt,
          activitySession?.id ?? null, input.now,
        );
        const state = input.outcome === 'COMPLETED' ? 'COMPLETED' : 'SKIPPED';
        if (completeWorkout.run(state, input.feedbackId, input.now, input.workoutId, input.ownerId, input.expectedVersion).changes !== 1) {
          throw new Error('WORKOUT_FEEDBACK_STATE_CHANGED');
        }
        const action = findLinkedAction(input.ownerId, input.workoutId);
        if (!action) throw new Error('WORKOUT_ACTION_MISSING');
        const feedback = {
          id: input.feedbackId, workoutId: input.workoutId, actionId: current.action_id, outcome: input.outcome,
          perceivedEffort: input.perceivedEffort, hadPain: input.hadPain, note: input.note,
          startedAt: input.startedAt, endedAt: input.endedAt, activitySessionId: activitySession?.id ?? null,
          createdAt: input.now,
        };
        return { workout: toWorkout(findWorkout.get(input.ownerId, input.workoutId) as WorkoutRow), feedback, action, activitySession };
      })();
    },
  };
}
