import {
  APP_VERSION,
  type DeepSeekFinishReason,
  type DeepSeekModel,
  type DeepSeekUsage,
  type IdempotencyOperation,
} from '@ev/contracts';
import type Database from 'better-sqlite3';

export type IdempotencyRecordState = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord {
  id: string;
  ownerId: string;
  key: string;
  operation: IdempotencyOperation;
  resourceId: string | null;
  requestHash: string;
  state: IdempotencyRecordState;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  response: { status: number; body: unknown } | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdempotencyInProgressInput {
  id: string;
  ownerId: string;
  key: string;
  operation: IdempotencyOperation;
  resourceId: string | null;
  requestHash: string;
  leaseToken: string;
  leaseExpiresAt: string;
  attemptCount: number;
  createdAt: string;
}

export interface ProviderCallStartInput {
  id: string;
  ownerId: string;
  runId: string | null;
  idempotencyRecordId: string | null;
  provider: 'DEEPSEEK';
  operation: 'daily_plan.generate';
  model: DeepSeekModel;
  attemptNo: number;
  inputChars: number;
  localDate: string;
  startedAt: string;
}

export interface ProviderCallFinishInput {
  id: string;
  status: 'SUCCEEDED' | 'FAILED' | 'REJECTED';
  failureCode: string | null;
  finishReason: DeepSeekFinishReason | null;
  usage: DeepSeekUsage;
  outputChars: number | null;
  finishedAt: string;
  durationMs: number;
}

export interface ProviderCallReservationInput extends ProviderCallStartInput {
  reservedTokens: number;
  maxAttemptsPerDay: number;
  maxTokensPerDay: number;
}

interface IdempotencyRow {
  id: string;
  owner_id: string;
  idempotency_key: string;
  operation: IdempotencyOperation;
  resource_id: string | null;
  request_hash: string;
  state: IdempotencyRecordState;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  response_status: number | null;
  response_json: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: IdempotencyRow): IdempotencyRecord {
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

export interface ProviderReliabilityRepository {
  createInProgress(input: CreateIdempotencyInProgressInput): IdempotencyRecord;
  find(ownerId: string, key: string): IdempotencyRecord | undefined;
  complete(input: {
    ownerId: string;
    recordId: string;
    leaseToken: string;
    status: number;
    response: unknown;
    updatedAt: string;
  }): boolean;
  fail(input: {
    ownerId: string;
    recordId: string;
    leaseToken: string;
    status: number;
    response: unknown;
    failureCode: string;
    updatedAt: string;
  }): boolean;
  renewExpiredLease(input: {
    ownerId: string;
    recordId: string;
    previousLeaseExpiresAt: string;
    leaseToken: string;
    leaseExpiresAt: string;
    updatedAt: string;
  }): boolean;
  startProviderCall(input: ProviderCallStartInput): void;
  reserveProviderCall(input: ProviderCallReservationInput): boolean;
  finishProviderCall(input: ProviderCallFinishInput): boolean;
  usageForOwnerDate(ownerId: string, localDate: string): { attempts: number; totalTokens: number };
}

export function createProviderReliabilityRepository(
  database: Database.Database,
): ProviderReliabilityRepository {
  const findStatement = database.prepare(
    `select id, owner_id, idempotency_key, operation, resource_id, request_hash, state,
            lease_token, lease_expires_at, attempt_count, response_status, response_json,
            failure_code, created_at, updated_at
     from idempotency_records where owner_id = ? and idempotency_key = ?`,
  );
  const insertInProgress = database.prepare(
    `insert into idempotency_records (
      id, owner_id, idempotency_key, operation, resource_id, request_hash, state,
      lease_token, lease_expires_at, attempt_count, response_status, response_json,
      failure_code, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, null, null, null, ?, ?)`,
  );
  const completeStatement = database.prepare(
    `update idempotency_records
     set state = 'COMPLETED', lease_token = null, lease_expires_at = null,
         response_status = ?, response_json = ?, failure_code = null, updated_at = ?
     where id = ? and owner_id = ? and state = 'IN_PROGRESS' and lease_token = ?`,
  );
  const failStatement = database.prepare(
    `update idempotency_records
     set state = 'FAILED', lease_token = null, lease_expires_at = null,
         response_status = ?, response_json = ?, failure_code = ?, updated_at = ?
     where id = ? and owner_id = ? and state = 'IN_PROGRESS' and lease_token = ?`,
  );
  const renewExpiredLeaseStatement = database.prepare(
    `update idempotency_records
     set lease_token = ?, lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
     where id = ? and owner_id = ? and state = 'IN_PROGRESS'
       and lease_expires_at = ? and attempt_count = 1`,
  );
  const startProviderCallStatement = database.prepare(
    `insert into provider_call_logs (
      id, owner_id, run_id, idempotency_record_id, provider, operation, model, attempt_no,
      status, failure_code, finish_reason, prompt_tokens, completion_tokens, total_tokens,
      input_chars, output_chars, policy_version, contract_version, app_version, local_date,
      started_at, finished_at, duration_ms
    ) values (?, ?, ?, ?, ?, ?, ?, ?, 'STARTED', null, null, null, null, ?, ?, null,
      'PROVIDER_POLICY_V1', 'DAILY_PLAN_V1', ?, ?, ?, null, null)`,
  );
  const finishProviderCallStatement = database.prepare(
    `update provider_call_logs
     set status = ?, failure_code = ?, finish_reason = ?, prompt_tokens = ?,
         completion_tokens = ?, total_tokens = coalesce(?, total_tokens), output_chars = ?, finished_at = ?, duration_ms = ?
     where id = ? and status = 'STARTED'`,
  );
  const usageForOwnerDateStatement = database.prepare(
    `select count(*) as attempts, coalesce(sum(total_tokens), 0) as total_tokens
     from provider_call_logs
     where owner_id = ? and local_date = ? and status in ('STARTED', 'SUCCEEDED', 'FAILED')`,
  );
  const reserveProviderCallTransaction = database.transaction(
    (input: ProviderCallReservationInput): boolean => {
      const usage = usageForOwnerDateStatement.get(input.ownerId, input.localDate) as {
        attempts: number;
        total_tokens: number;
      };
      if (
        usage.attempts >= input.maxAttemptsPerDay ||
        usage.total_tokens + input.reservedTokens > input.maxTokensPerDay
      ) {
        return false;
      }
      startProviderCallStatement.run(
        input.id,
        input.ownerId,
        input.runId,
        input.idempotencyRecordId,
        input.provider,
        input.operation,
        input.model,
        input.attemptNo,
        input.reservedTokens,
        input.inputChars,
        APP_VERSION,
        input.localDate,
        input.startedAt,
      );
      return true;
    },
  );

  return {
    createInProgress(input) {
      insertInProgress.run(
        input.id,
        input.ownerId,
        input.key,
        input.operation,
        input.resourceId,
        input.requestHash,
        input.leaseToken,
        input.leaseExpiresAt,
        input.attemptCount,
        input.createdAt,
        input.createdAt,
      );
      const row = findStatement.get(input.ownerId, input.key) as IdempotencyRow | undefined;
      if (!row) throw new Error('Created idempotency record is missing');
      return toRecord(row);
    },

    find(ownerId, key) {
      const row = findStatement.get(ownerId, key) as IdempotencyRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    complete(input) {
      return (
        completeStatement.run(
          input.status,
          JSON.stringify(input.response),
          input.updatedAt,
          input.recordId,
          input.ownerId,
          input.leaseToken,
        ).changes === 1
      );
    },

    fail(input) {
      return (
        failStatement.run(
          input.status,
          JSON.stringify(input.response),
          input.failureCode,
          input.updatedAt,
          input.recordId,
          input.ownerId,
          input.leaseToken,
        ).changes === 1
      );
    },

    renewExpiredLease(input) {
      return (
        renewExpiredLeaseStatement.run(
          input.leaseToken,
          input.leaseExpiresAt,
          input.updatedAt,
          input.recordId,
          input.ownerId,
          input.previousLeaseExpiresAt,
        ).changes === 1
      );
    },

    startProviderCall(input) {
      startProviderCallStatement.run(
        input.id,
        input.ownerId,
        input.runId,
        input.idempotencyRecordId,
        input.provider,
        input.operation,
        input.model,
        input.attemptNo,
        null,
        input.inputChars,
        APP_VERSION,
        input.localDate,
        input.startedAt,
      );
    },

    reserveProviderCall(input) {
      return reserveProviderCallTransaction.immediate(input);
    },

    finishProviderCall(input) {
      return (
        finishProviderCallStatement.run(
          input.status,
          input.failureCode,
          input.finishReason,
          input.usage.promptTokens,
          input.usage.completionTokens,
          input.usage.totalTokens,
          input.outputChars,
          input.finishedAt,
          input.durationMs,
          input.id,
        ).changes === 1
      );
    },

    usageForOwnerDate(ownerId, localDate) {
      const row = usageForOwnerDateStatement.get(ownerId, localDate) as {
        attempts: number;
        total_tokens: number;
      };
      return { attempts: row.attempts, totalTokens: row.total_tokens };
    },
  };
}
