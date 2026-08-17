import {
  dailyPlanRunSchema,
  type DailyPlanContextManifest,
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
  status: 'CONTEXT_READY';
  context_manifest_json: string;
  proposal_id: null;
  failure_code: null;
  created_at: string;
  completed_at: null;
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
  const findContextReadyRun = database.prepare(
    `select id, contract_version, local_date, trigger, status, context_manifest_json,
            proposal_id, failure_code, created_at, completed_at
     from daily_plan_runs
     where id = ? and owner_id = ?`,
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
        findContextReadyRun.get(input.id, input.ownerId) as DailyPlanRunRow,
      );
    },
  };
}
