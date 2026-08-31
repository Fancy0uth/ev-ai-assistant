import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ApiError, V07_DAILY_QUOTA_RETRY_AFTER_SECONDS } from '../../http/api-error';
import { canonicalJson, type V07HealthLoopRepository } from './repository';

const DEFAULT_LEASE_MS = 20_000;
const INTERRUPTED_BODY = {
  error: {
    code: 'V07_COMMAND_INTERRUPTED',
    message: '此前命令已中断，请使用新的 Idempotency-Key 重试',
  },
};

export type V07IdempotencyOperation =
  | 'fitness.check_in.create'
  | 'fitness.workout.create'
  | 'fitness.workout.revise'
  | 'fitness.workout.propose'
  | 'fitness.workout.feedback'
  | 'nutrition.meal_draft.create'
  | 'nutrition.meal_draft.revise'
  | 'nutrition.meal_draft.match'
  | 'nutrition.meal.confirm';

export interface V07IdempotencyCommand {
  ownerId: string;
  key: string;
  operation: V07IdempotencyOperation;
  resourceId: string;
  body: unknown;
}

export class V07IdempotencyConflictError extends ApiError {
  constructor() {
    super(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key 已用于不同请求');
    this.name = 'V07IdempotencyConflictError';
  }
}

export class V07IdempotencyInProgressError extends ApiError {
  readonly retryAfterSeconds = 1;

  constructor() {
    super(409, 'IN_PROGRESS', '请求仍在处理中');
    this.name = 'V07IdempotencyInProgressError';
  }
}

export class V07IdempotencyReplayError extends ApiError {
  readonly idempotencyReplayed = true;
  readonly retryAfterSeconds?: number;

  constructor(status: number, body: unknown) {
    const error = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error;
    if (!error || typeof error.code !== 'string' || typeof error.message !== 'string') {
      throw new Error('V07_TERMINAL_ERROR_RESPONSE_INVALID');
    }
    super(status, error.code, error.message, error.details);
    this.name = 'V07IdempotencyReplayError';
    if (status === 429 && error.code === 'RATE_LIMITED') {
      this.retryAfterSeconds = V07_DAILY_QUOTA_RETRY_AFTER_SECONDS;
    }
  }
}

interface V07IdempotencyRecord {
  id: string;
  ownerId: string;
  key: string;
  operation: V07IdempotencyOperation;
  resourceId: string;
  requestHash: string;
  state: 'CLAIMED' | 'SUCCEEDED' | 'FAILED';
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  response: { status: number; body: unknown } | null;
}

export interface V07ExternalClaim {
  recordId: string;
  ownerId: string;
  key: string;
  operation: V07IdempotencyOperation;
  resourceId: string;
  requestHash: string;
  leaseToken: string;
  leaseExpiresAt: string;
  claimedAt: string;
}

type StableResponse<T> = { status: number; body: T; replayed: boolean };
type ExternalStart<T> = { kind: 'CLAIMED'; claim: V07ExternalClaim } | { kind: 'REPLAY'; response: StableResponse<T> };

export interface V07IdempotencyService {
  executeLocal<T>(
    command: V07IdempotencyCommand,
    execute: () => { status: number; body: T },
  ): StableResponse<T>;
  beginExternal<T>(command: V07IdempotencyCommand): ExternalStart<T>;
  completeExternal<T>(
    claim: V07ExternalClaim,
    execute: () => { status: number; body: T },
    onControlledFailure?: (error: ApiError) => void,
  ): StableResponse<T>;
  failExternal(claim: V07ExternalClaim, error: ApiError, finalize?: () => void): void;
}

export interface V07IdempotencyServiceOptions {
  database: Database.Database;
  repository: V07HealthLoopRepository;
  now?: () => Date;
  newId?: () => string;
  newLeaseToken?: () => string;
  leaseMs?: number;
}

export function hashV07IdempotencyCommand(command: V07IdempotencyCommand): string {
  return createHash('sha256')
    .update(canonicalJson({
      ownerId: command.ownerId,
      operation: command.operation,
      resourceId: command.resourceId,
      body: command.body,
    }))
    .digest('hex');
}

function toRecord(row: {
  id: string;
  owner_id: string;
  idempotency_key: string;
  operation: V07IdempotencyOperation;
  resource_id: string;
  request_hash: string;
  state: V07IdempotencyRecord['state'];
  lease_token: string | null;
  lease_expires_at: string | null;
  response_status: number | null;
  response_json: string | null;
}): V07IdempotencyRecord {
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
    response: row.response_status === null || row.response_json === null
      ? null
      : { status: row.response_status, body: JSON.parse(row.response_json) as unknown },
  };
}

function apiErrorResponse(error: ApiError): { status: number; body: unknown } {
  return {
    status: error.statusCode,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
  };
}

export function createV07IdempotencyService(options: V07IdempotencyServiceOptions): V07IdempotencyService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const newLeaseToken = options.newLeaseToken ?? randomUUID;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const find = options.database.prepare(`select id, owner_id, idempotency_key, operation, resource_id,
    request_hash, state, lease_token, lease_expires_at, response_status, response_json
    from v07_idempotency_records where owner_id = ? and idempotency_key = ?`);
  const findExpired = options.database.prepare(`select id, owner_id, idempotency_key, operation, resource_id,
    request_hash, state, lease_token, lease_expires_at, response_status, response_json
    from v07_idempotency_records where state = 'CLAIMED' and lease_expires_at <= ?
    order by lease_expires_at, id`);
  const insert = options.database.prepare(`insert into v07_idempotency_records (
    id, owner_id, idempotency_key, operation, resource_id, request_hash, state, lease_token,
    lease_expires_at, response_status, response_json, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?, null, null, ?, ?)`);
  const complete = options.database.prepare(`update v07_idempotency_records
    set state = ?, lease_token = null, lease_expires_at = null, response_status = ?,
        response_json = ?, updated_at = ?
    where id = ? and owner_id = ? and state = 'CLAIMED' and lease_token = ?`);
  const expire = options.database.prepare(`update v07_idempotency_records
    set state = 'FAILED', lease_token = null, lease_expires_at = null, response_status = 503,
        response_json = ?, updated_at = ?
    where id = ? and owner_id = ? and state = 'CLAIMED' and lease_expires_at <= ?`);

  function terminalizeExpired(record: V07IdempotencyRecord, nowIso: string): boolean {
    const changed = expire.run(canonicalJson(INTERRUPTED_BODY), nowIso, record.id, record.ownerId, nowIso).changes === 1;
    if (changed) options.repository.failExpiredCapabilityRunByIdempotencyKey(record.ownerId, record.key, nowIso);
    return changed;
  }

  options.database.transaction(() => {
    const nowIso = now().toISOString();
    const expired = (findExpired.all(nowIso) as Array<Parameters<typeof toRecord>[0]>).map(toRecord);
    for (const record of expired) terminalizeExpired(record, nowIso);
    options.repository.sweepExpiredCapabilityRuns(nowIso);
  })();

  function replay<T>(response: { status: number; body: unknown }): StableResponse<T> {
    if (response.status >= 400) throw new V07IdempotencyReplayError(response.status, response.body);
    return { status: response.status, body: response.body as T, replayed: true };
  }

  function begin<T>(command: V07IdempotencyCommand): ExternalStart<T> {
    const started = options.database.transaction(() => {
      const requestHash = hashV07IdempotencyCommand(command);
      const at = now();
      const nowIso = at.toISOString();
      const existingRow = find.get(command.ownerId, command.key) as Parameters<typeof toRecord>[0] | undefined;
      if (existingRow) {
        const existing = toRecord(existingRow);
        if (existing.operation !== command.operation || existing.resourceId !== command.resourceId || existing.requestHash !== requestHash) {
          throw new V07IdempotencyConflictError();
        }
        if (existing.state === 'CLAIMED') {
          if (existing.leaseExpiresAt && existing.leaseExpiresAt > nowIso) throw new V07IdempotencyInProgressError();
          if (!terminalizeExpired(existing, nowIso)) throw new V07IdempotencyInProgressError();
          return { kind: 'REPLAY' as const, response: { status: 503, body: INTERRUPTED_BODY } };
        }
        if (!existing.response) throw new Error('V07_TERMINAL_RESPONSE_MISSING');
        return { kind: 'REPLAY' as const, response: existing.response };
      }

      const recordId = newId();
      const leaseToken = newLeaseToken();
      const leaseExpiresAt = new Date(at.getTime() + leaseMs).toISOString();
      insert.run(
        recordId,
        command.ownerId,
        command.key,
        command.operation,
        command.resourceId,
        requestHash,
        leaseToken,
        leaseExpiresAt,
        nowIso,
        nowIso,
      );
      return {
        kind: 'CLAIMED' as const,
        claim: {
          recordId,
          ownerId: command.ownerId,
          key: command.key,
          operation: command.operation,
          resourceId: command.resourceId,
          requestHash,
          leaseToken,
          leaseExpiresAt,
          claimedAt: nowIso,
        },
      };
    })();
    return started.kind === 'REPLAY'
      ? { kind: 'REPLAY', response: replay<T>(started.response) }
      : started;
  }

  function finalize<T>(claim: V07ExternalClaim, result: { status: number; body: T }): StableResponse<T> {
    const state = result.status >= 400 ? 'FAILED' : 'SUCCEEDED';
    const changed = complete.run(
      state,
      result.status,
      canonicalJson(result.body),
      now().toISOString(),
      claim.recordId,
      claim.ownerId,
      claim.leaseToken,
    ).changes;
    if (changed !== 1) throw new Error('V07_IDEMPOTENCY_FINALIZE_FAILED');
    return { ...result, replayed: false };
  }

  function failExternal(claim: V07ExternalClaim, error: ApiError, finalizeFailure?: () => void): void {
    const response = apiErrorResponse(error);
    options.database.transaction(() => {
      finalizeFailure?.();
      finalize(claim, response);
    })();
  }

  return {
    executeLocal(command, execute) {
      const started = begin<ReturnType<typeof execute>['body']>(command);
      if (started.kind === 'REPLAY') return started.response;
      try {
        return options.database.transaction(() => finalize(started.claim, execute()))();
      } catch (error) {
        if (error instanceof ApiError) failExternal(started.claim, error);
        throw error;
      }
    },
    beginExternal(command) {
      return begin(command);
    },
    completeExternal(claim, execute, onControlledFailure) {
      try {
        return options.database.transaction(() => finalize(claim, execute()))();
      } catch (error) {
        if (error instanceof ApiError) failExternal(claim, error, () => onControlledFailure?.(error));
        throw error;
      }
    },
    failExternal,
  };
}
