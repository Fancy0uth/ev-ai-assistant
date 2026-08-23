import type { DailyPlanFailureCode, DailyPlanProposal } from '@ev/contracts';
import type Database from 'better-sqlite3';
import type {
  IdempotencyRecord,
  ProviderCallFinishInput,
  ProviderReliabilityRepository,
} from '../providers/reliability-repository';
import type {
  DailyPlanPreflightCompletionResult,
  DailyPlanRunRepository,
} from './repository';

export interface SafeHttpSnapshot {
  status: number;
  body: unknown;
  failureCode: string;
}

export const INTERRUPTED_DAILY_PLAN_SNAPSHOT: SafeHttpSnapshot = {
  status: 503,
  body: {
    error: {
      code: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
      message: '每日计划生成已中断，请使用新的操作重新发起。',
    },
  },
  failureCode: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
};

export interface DailyPlanTerminalFaultCheckpoint {
  phase: 'BUSINESS_TERMINAL' | 'PROVIDER_TERMINAL' | 'IDEMPOTENCY_TERMINAL';
  outcome: 'SUCCEEDED' | 'FAILED';
}

export interface DailyPlanGenerationExecutionIdentity {
  ownerId: string;
  idempotencyRecordId: string;
  leaseToken: string;
  preflightId: string;
  expectedPreflightVersion: number;
}

export interface DailyPlanExecutionUnitOfWork {
  complete(input: DailyPlanGenerationExecutionIdentity & {
    proposal: DailyPlanProposal;
    completedAt: string;
    providerCall: ProviderCallFinishInput | null;
    successSnapshot: SafeHttpSnapshot;
    staleSnapshot: SafeHttpSnapshot;
  }): DailyPlanPreflightCompletionResult;
  fail(input: DailyPlanGenerationExecutionIdentity & {
    runFailureCode: DailyPlanFailureCode;
    terminalReason: string;
    completedAt: string;
    providerCall: ProviderCallFinishInput | null;
    failureSnapshot: SafeHttpSnapshot;
  }): void;
  terminalizeExpired(record: IdempotencyRecord, nowIso: string): boolean;
  sweepExpired(nowIso: string): number;
}

export function createDailyPlanExecutionUnitOfWork(options: {
  database: Database.Database;
  dailyPlanRepository: DailyPlanRunRepository;
  reliabilityRepository: ProviderReliabilityRepository;
  fault?: (checkpoint: DailyPlanTerminalFaultCheckpoint) => void;
}): DailyPlanExecutionUnitOfWork {
  const completeTransaction = options.database.transaction(
    (input: Parameters<DailyPlanExecutionUnitOfWork['complete']>[0]) => {
      const business = options.dailyPlanRepository.commitClaimedPreflight({
        ownerId: input.ownerId,
        preflightId: input.preflightId,
        expectedVersion: input.expectedPreflightVersion,
        proposal: input.proposal,
        completedAt: input.completedAt,
        leaseToken: input.leaseToken,
      });
      options.fault?.({ phase: 'BUSINESS_TERMINAL', outcome: 'SUCCEEDED' });

      if (input.providerCall && !options.reliabilityRepository.finishProviderCall(input.providerCall)) {
        throw new Error('Provider call terminal could not be committed');
      }
      options.fault?.({ phase: 'PROVIDER_TERMINAL', outcome: 'SUCCEEDED' });

      const snapshot = business.kind === 'stale' ? input.staleSnapshot : input.successSnapshot;
      const finalized = business.kind === 'stale'
        ? options.reliabilityRepository.fail({
            ownerId: input.ownerId,
            recordId: input.idempotencyRecordId,
            leaseToken: input.leaseToken,
            status: snapshot.status,
            response: snapshot.body,
            failureCode: snapshot.failureCode,
            updatedAt: input.completedAt,
          })
        : options.reliabilityRepository.complete({
            ownerId: input.ownerId,
            recordId: input.idempotencyRecordId,
            leaseToken: input.leaseToken,
            status: snapshot.status,
            response: snapshot.body,
            updatedAt: input.completedAt,
          });
      if (!finalized) throw new Error('Generation idempotency snapshot could not be committed');
      options.fault?.({ phase: 'IDEMPOTENCY_TERMINAL', outcome: 'SUCCEEDED' });
      return business;
    },
  );

  const failTransaction = options.database.transaction(
    (input: Parameters<DailyPlanExecutionUnitOfWork['fail']>[0]) => {
      options.dailyPlanRepository.failClaimedPreflight({
        ownerId: input.ownerId,
        preflightId: input.preflightId,
        expectedVersion: input.expectedPreflightVersion,
        code: input.runFailureCode,
        terminalReason: input.terminalReason,
        completedAt: input.completedAt,
        leaseToken: input.leaseToken,
      });
      options.fault?.({ phase: 'BUSINESS_TERMINAL', outcome: 'FAILED' });

      if (input.providerCall && !options.reliabilityRepository.finishProviderCall(input.providerCall)) {
        throw new Error('Provider call terminal could not be committed');
      }
      options.fault?.({ phase: 'PROVIDER_TERMINAL', outcome: 'FAILED' });

      if (
        !options.reliabilityRepository.fail({
          ownerId: input.ownerId,
          recordId: input.idempotencyRecordId,
          leaseToken: input.leaseToken,
          status: input.failureSnapshot.status,
          response: input.failureSnapshot.body,
          failureCode: input.failureSnapshot.failureCode,
          updatedAt: input.completedAt,
        })
      ) {
        throw new Error('Generation idempotency failure snapshot could not be committed');
      }
      options.fault?.({ phase: 'IDEMPOTENCY_TERMINAL', outcome: 'FAILED' });
    },
  );
  const findCorrelatedRun = options.database.prepare(
    `select id
     from daily_plan_runs
     where owner_id = ? and idempotency_record_id = ? and status = 'GENERATING'
       and lease_token = ?`,
  );
  const failExpiredRun = options.database.prepare(
    `update daily_plan_runs
     set status = 'FAILED', proposal_id = null,
         failure_code = 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
         completed_at = case when created_at > ? then created_at else ? end,
         lease_token = null, lease_expires_at = null,
         terminal_reason = 'DAILY_PLAN_PROVIDER_INTERRUPTED'
     where id = ? and owner_id = ? and status = 'GENERATING' and lease_token = ?`,
  );
  const consumeExpiredPreflight = options.database.prepare(
    `update daily_plan_preflights
     set status = 'CONSUMED', version = version + 1, updated_at = ?, consumed_at = ?
     where run_id = ? and owner_id = ? and status = 'CLAIMED'`,
  );
  const failExpiredProviderCalls = options.database.prepare(
    `update provider_call_logs
     set status = 'FAILED', failure_code = 'DAILY_PLAN_PROVIDER_INTERRUPTED',
         finish_reason = null, finished_at = ?,
         duration_ms = max(0, cast((julianday(?) - julianday(started_at)) * 86400000 as integer))
     where owner_id = ? and idempotency_record_id = ? and status = 'STARTED'`,
  );
  const findExpiredRecords = options.database.prepare(
    `select id, owner_id, idempotency_key, operation, resource_id, request_hash, state,
            lease_token, lease_expires_at, attempt_count, response_status, response_json,
            failure_code, created_at, updated_at
     from idempotency_records
     where operation = 'daily_plan.generate' and state = 'IN_PROGRESS'
       and lease_expires_at is not null and lease_expires_at <= ?
     order by lease_expires_at asc, id asc`,
  );

  type ExpiredRow = {
    id: string;
    owner_id: string;
    idempotency_key: string;
    operation: IdempotencyRecord['operation'];
    resource_id: string | null;
    request_hash: string;
    state: IdempotencyRecord['state'];
    lease_token: string | null;
    lease_expires_at: string | null;
    attempt_count: number;
    response_status: number | null;
    response_json: string | null;
    failure_code: string | null;
    created_at: string;
    updated_at: string;
  };

  function expiredRecord(row: ExpiredRow): IdempotencyRecord {
    return {
      id: row.id,
      ownerId: row.owner_id,
      key: row.idempotency_key,
      operation: row.operation,
      resourceId: row.resource_id,
      requestHash: row.request_hash,
      state: row.state,
      leaseToken: row.lease_token,
      leaseExpiresAt: row.lease_expires_at,
      attemptCount: row.attempt_count,
      response:
        row.response_status === null || row.response_json === null
          ? null
          : { status: row.response_status, body: JSON.parse(row.response_json) as unknown },
      failureCode: row.failure_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  const terminalizeExpiredTransaction = options.database.transaction(
    (record: IdempotencyRecord, nowIso: string): boolean => {
      if (
        record.operation !== 'daily_plan.generate' ||
        record.state !== 'IN_PROGRESS' ||
        !record.leaseToken
      ) {
        return false;
      }
      const run = findCorrelatedRun.get(
        record.ownerId,
        record.id,
        record.leaseToken,
      ) as { id: string } | undefined;
      if (run) {
        if (
          failExpiredRun.run(
            nowIso,
            nowIso,
            run.id,
            record.ownerId,
            record.leaseToken,
          ).changes !== 1
        ) {
          throw new Error('Expired Daily Plan run could not be finalized');
        }
        if (
          consumeExpiredPreflight.run(nowIso, nowIso, run.id, record.ownerId).changes !== 1
        ) {
          throw new Error('Expired Daily Plan preflight could not be finalized');
        }
      }
      failExpiredProviderCalls.run(nowIso, nowIso, record.ownerId, record.id);
      if (
        !options.reliabilityRepository.fail({
          ownerId: record.ownerId,
          recordId: record.id,
          leaseToken: record.leaseToken,
          status: INTERRUPTED_DAILY_PLAN_SNAPSHOT.status,
          response: INTERRUPTED_DAILY_PLAN_SNAPSHOT.body,
          failureCode: INTERRUPTED_DAILY_PLAN_SNAPSHOT.failureCode,
          updatedAt: nowIso,
        })
      ) {
        throw new Error('Expired idempotency snapshot could not be finalized');
      }
      return true;
    },
  );

  return {
    complete(input) {
      return completeTransaction(input);
    },
    fail(input) {
      failTransaction(input);
    },
    terminalizeExpired(record, nowIso) {
      return terminalizeExpiredTransaction(record, nowIso);
    },
    sweepExpired(nowIso) {
      const records = (findExpiredRecords.all(nowIso) as ExpiredRow[]).map(expiredRecord);
      let finalized = 0;
      for (const record of records) {
        if (terminalizeExpiredTransaction(record, nowIso)) finalized += 1;
      }
      return finalized;
    },
  };
}
