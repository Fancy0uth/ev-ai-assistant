import {
  dailyPlanProposalSchema,
  dailyPlanRunSchema,
  type DailyPlanContextManifest,
  type DailyPlanFailureCode,
  type DailyPlanProposal,
  type DailyPlanRun,
  type DailyPlanTrigger,
  type LocalTime,
  type TimeRequestSource,
} from '@ev/contracts';
import type Database from 'better-sqlite3';

export interface DailyPlanningEventContext {
  startLocalTime: LocalTime;
  endLocalTime: LocalTime;
  isHard: boolean;
}

export interface DailyPlanningTimeRequestContext {
  id: string;
  version: number;
  source: TimeRequestSource;
  targetDate: string;
  durationMinutes: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  earliestStartLocalTime: LocalTime | null;
  latestEndLocalTime: LocalTime | null;
  isFixed: boolean;
}

export interface DailyPlanningRecoveryContext {
  value: number;
}

export interface DailyPlanningReadContext {
  events: DailyPlanningEventContext[];
  timeRequests: DailyPlanningTimeRequestContext[];
  latestRecovery: DailyPlanningRecoveryContext | undefined;
}

export interface NewContextReadyDailyPlanRun {
  id: string;
  ownerId: string;
  localDate: string;
  trigger: DailyPlanTrigger;
  contextManifest: DailyPlanContextManifest;
  createdAt: string;
}

export interface DailyPlanRunRepository {
  readContext(ownerId: string, localDate: string): DailyPlanningReadContext;
  readScheduleVersion(ownerId: string): { version: number };
  createContextReady(input: NewContextReadyDailyPlanRun): DailyPlanRun;
  getRun(ownerId: string, runId: string): DailyPlanRun | undefined;
  findProposalByRun(ownerId: string, runId: string): DailyPlanProposal | undefined;
  completeWithProposal(
    ownerId: string,
    runId: string,
    baseScheduleVersion: number,
    proposal: DailyPlanProposal,
  ): DailyPlanProposal;
  failRun(ownerId: string, runId: string, code: DailyPlanFailureCode): DailyPlanRun;
}

export class DailyPlanBaseVersionStaleError extends Error {
  constructor() {
    super('DAILY_PLAN_BASE_VERSION_STALE');
    this.name = 'DailyPlanBaseVersionStaleError';
  }
}

class DailyPlanRunStateConflictError extends Error {
  constructor() {
    super('DAILY_PLAN_RUN_STATE_CONFLICT');
    this.name = 'DailyPlanRunStateConflictError';
  }
}

class DailyPlanProposalNotReviewableError extends Error {
  constructor() {
    super('DAILY_PLAN_PROPOSAL_NOT_REVIEWABLE');
    this.name = 'DailyPlanProposalNotReviewableError';
  }
}

interface EventContextRow {
  start_local_time: LocalTime;
  end_local_time: LocalTime;
  is_hard: number;
}

interface TimeRequestContextRow {
  id: string;
  version: number;
  source: TimeRequestSource;
  target_date: string;
  duration_minutes: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  earliest_start_local_time: LocalTime | null;
  latest_end_local_time: LocalTime | null;
  is_fixed: number;
}

interface RecoveryContextRow {
  value: number;
}

interface ScheduleVersionRow {
  version: number;
}

interface DailyPlanRunRow {
  id: string;
  contract_version: 'DAILY_PLAN_V1';
  local_date: string;
  trigger: DailyPlanTrigger;
  status: DailyPlanRun['status'];
  context_manifest_json: string;
  proposal_id: string | null;
  failure_code: DailyPlanFailureCode | null;
  created_at: string;
  completed_at: string | null;
}

interface DailyPlanProposalRow {
  id: string;
  contract_version: 'DAILY_PLAN_V1';
  run_id: string;
  local_date: string;
  status: DailyPlanProposal['status'];
  base_schedule_version: number;
  summary: string;
  items_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function toDailyPlanRun(row: DailyPlanRunRow): DailyPlanRun {
  return dailyPlanRunSchema.parse({
    id: row.id,
    contractVersion: row.contract_version,
    localDate: row.local_date,
    trigger: row.trigger,
    status: row.status,
    contextManifest: JSON.parse(row.context_manifest_json) as unknown,
    proposalId: row.proposal_id,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
}

function toDailyPlanProposal(row: DailyPlanProposalRow): DailyPlanProposal {
  return dailyPlanProposalSchema.parse({
    id: row.id,
    contractVersion: row.contract_version,
    runId: row.run_id,
    localDate: row.local_date,
    status: row.status,
    baseScheduleVersion: row.base_schedule_version,
    summary: row.summary,
    items: JSON.parse(row.items_json) as unknown,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function completionTimestamp(createdAt: string): string {
  const now = new Date().toISOString();
  return now >= createdAt ? now : createdAt;
}

export function createDailyPlanRunRepository(database: Database.Database): DailyPlanRunRepository {
  const readEvents = database.prepare(
    `select start_local_time, end_local_time, is_hard
     from events
     where owner_id = ? and local_date = ? and status = 'CONFIRMED'
     order by start_local_time asc, end_local_time asc, id asc`,
  );
  const readTimeRequests = database.prepare(
    `select id, version, source, target_date, duration_minutes, priority,
            earliest_start_local_time, latest_end_local_time, is_fixed
     from time_requests
     where owner_id = ? and target_date = ?
     order by
       case priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,
       created_at asc,
       id asc`,
  );
  const readLatestRecovery = database.prepare(
    `select value
     from signals
     where owner_id = ? and local_date = ? and kind = 'RECOVERY'
     order by created_at desc, id desc
     limit 1`,
  );
  const readScheduleVersion = database.prepare(
    `select version
     from schedule_versions
     where owner_id = ?`,
  );
  const findRun = database.prepare(
    `select id, contract_version, local_date, trigger, status, context_manifest_json,
            proposal_id, failure_code, created_at, completed_at
     from daily_plan_runs
     where id = ? and owner_id = ?`,
  );
  const findProposalByRun = database.prepare(
    `select id, contract_version, run_id, local_date, status, base_schedule_version, summary,
            items_json, version, created_at, updated_at
     from daily_plan_proposals
     where run_id = ? and owner_id = ?`,
  );
  const insertProposal = database.prepare(
    `insert into daily_plan_proposals (
       id, owner_id, run_id, contract_version, local_date, status, base_schedule_version,
       summary, items_json, version, created_at, updated_at
     ) values (?, ?, ?, 'DAILY_PLAN_V1', ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?)`,
  );
  const completeRun = database.prepare(
    `update daily_plan_runs
     set status = 'SUCCEEDED', proposal_id = ?, failure_code = null, completed_at = ?
     where id = ? and owner_id = ? and status = 'CONTEXT_READY'`,
  );
  const failContextReadyRun = database.prepare(
    `update daily_plan_runs
     set status = 'FAILED', proposal_id = null, failure_code = ?, completed_at = ?
     where id = ? and owner_id = ? and status = 'CONTEXT_READY'`,
  );
  const failActiveRun = database.prepare(
    `update daily_plan_runs
     set status = 'FAILED', proposal_id = null, failure_code = ?, completed_at = ?
     where id = ? and owner_id = ? and status in ('CREATED', 'CONTEXT_READY', 'GENERATING')`,
  );

  const completeWithProposalTransaction = database.transaction(
    (
      ownerId: string,
      runId: string,
      baseScheduleVersion: number,
      proposal: DailyPlanProposal,
    ): { proposal: DailyPlanProposal } | { stale: true } => {
      const run = findRun.get(runId, ownerId) as DailyPlanRunRow | undefined;
      if (!run || run.status !== 'CONTEXT_READY') {
        throw new DailyPlanRunStateConflictError();
      }
      if (proposal.status !== 'PENDING_REVIEW') {
        throw new DailyPlanProposalNotReviewableError();
      }

      const scheduleVersion = readScheduleVersion.get(ownerId) as ScheduleVersionRow | undefined;
      if (!scheduleVersion || scheduleVersion.version !== baseScheduleVersion) {
        failContextReadyRun.run(
          'DAILY_PLAN_BASE_VERSION_STALE',
          completionTimestamp(run.created_at),
          runId,
          ownerId,
        );
        return { stale: true };
      }

      insertProposal.run(
        proposal.id,
        ownerId,
        runId,
        proposal.localDate,
        baseScheduleVersion,
        proposal.summary,
        JSON.stringify(proposal.items),
        proposal.version,
        proposal.createdAt,
        proposal.updatedAt,
      );
      completeRun.run(proposal.id, completionTimestamp(run.created_at), runId, ownerId);

      return {
        proposal: toDailyPlanProposal(
          findProposalByRun.get(runId, ownerId) as DailyPlanProposalRow,
        ),
      };
    },
  );

  function completeWithProposal(
    ownerId: string,
    runId: string,
    baseScheduleVersion: number,
    proposal: DailyPlanProposal,
  ): DailyPlanProposal {
    const result = completeWithProposalTransaction(
      ownerId,
      runId,
      baseScheduleVersion,
      proposal,
    );
    if ('stale' in result) {
      throw new DailyPlanBaseVersionStaleError();
    }
    return result.proposal;
  }

  const failRun = database.transaction(
    (ownerId: string, runId: string, code: DailyPlanFailureCode): DailyPlanRun => {
      const run = findRun.get(runId, ownerId) as DailyPlanRunRow | undefined;
      if (!run || !['CREATED', 'CONTEXT_READY', 'GENERATING'].includes(run.status)) {
        throw new DailyPlanRunStateConflictError();
      }

      failActiveRun.run(code, completionTimestamp(run.created_at), runId, ownerId);
      return toDailyPlanRun(findRun.get(runId, ownerId) as DailyPlanRunRow);
    },
  );

  return {
    readContext(ownerId, localDate) {
      const events = (readEvents.all(ownerId, localDate) as EventContextRow[]).map((row) => ({
        startLocalTime: row.start_local_time,
        endLocalTime: row.end_local_time,
        isHard: row.is_hard === 1,
      }));
      const timeRequests = (readTimeRequests.all(ownerId, localDate) as TimeRequestContextRow[]).map(
        (row) => ({
          id: row.id,
          version: row.version,
          source: row.source,
          targetDate: row.target_date,
          durationMinutes: row.duration_minutes,
          priority: row.priority,
          earliestStartLocalTime: row.earliest_start_local_time,
          latestEndLocalTime: row.latest_end_local_time,
          isFixed: row.is_fixed === 1,
        }),
      );
      const latestRecovery = readLatestRecovery.get(ownerId, localDate) as
        | RecoveryContextRow
        | undefined;

      return {
        events,
        timeRequests,
        latestRecovery: latestRecovery ? { value: latestRecovery.value } : undefined,
      };
    },

    readScheduleVersion(ownerId) {
      const row = readScheduleVersion.get(ownerId) as ScheduleVersionRow | undefined;
      if (!row) {
        throw new Error('daily planning schedule version is missing');
      }
      return { version: row.version };
    },

    createContextReady(input) {
      database
        .prepare(
          `insert into daily_plan_runs (
             id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
             proposal_id, failure_code, created_at, completed_at
           ) values (?, ?, 'DAILY_PLAN_V1', ?, ?, 'CONTEXT_READY', ?, null, null, ?, null)`,
        )
        .run(
          input.id,
          input.ownerId,
          input.localDate,
          input.trigger,
          JSON.stringify(input.contextManifest),
          input.createdAt,
        );

      return toDailyPlanRun(
        findRun.get(input.id, input.ownerId) as DailyPlanRunRow,
      );
    },

    getRun(ownerId, runId) {
      const row = findRun.get(runId, ownerId) as DailyPlanRunRow | undefined;
      return row ? toDailyPlanRun(row) : undefined;
    },

    findProposalByRun(ownerId, runId) {
      const row = findProposalByRun.get(runId, ownerId) as DailyPlanProposalRow | undefined;
      return row ? toDailyPlanProposal(row) : undefined;
    },

    completeWithProposal,

    failRun,
  };
}
