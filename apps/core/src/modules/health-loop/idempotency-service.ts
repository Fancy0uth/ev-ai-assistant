import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { canonicalJson, type V07HealthLoopRepository } from './repository';

const DEFAULT_LEASE_MS = 20_000;

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

export class V07IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super('IDEMPOTENCY_KEY_REUSED');
    this.name = 'V07IdempotencyConflictError';
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

export interface V07IdempotencyService {
  executeLocal<T>(
    command: V07IdempotencyCommand,
    execute: () => { status: number; body: T },
  ):
    | { status: number; body: T | unknown; replayed: boolean }
    | { kind: 'IN_PROGRESS'; retryAfterSeconds: 1 };
}

export interface V07IdempotencyServiceOptions {
  database: Database.Database;
  repository: V07HealthLoopRepository;
  now?: () => Date;
  newId?: () => string;
  newLeaseToken?: () => string;
  leaseMs?: number;
}

function hashCommand(command: V07IdempotencyCommand): string {
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

export function createV07IdempotencyService(options: V07IdempotencyServiceOptions): V07IdempotencyService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const newLeaseToken = options.newLeaseToken ?? randomUUID;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const find = options.database.prepare(`select id, owner_id, idempotency_key, operation, resource_id,
    request_hash, state, lease_token, lease_expires_at, response_status, response_json
    from v07_idempotency_records where owner_id = ? and idempotency_key = ?`);
  const insert = options.database.prepare(`insert into v07_idempotency_records (
    id, owner_id, idempotency_key, operation, resource_id, request_hash, state, lease_token,
    lease_expires_at, response_status, response_json, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?, null, null, ?, ?)`);
  const complete = options.database.prepare(`update v07_idempotency_records
    set state = 'SUCCEEDED', lease_token = null, lease_expires_at = null, response_status = ?,
        response_json = ?, updated_at = ?
    where id = ? and owner_id = ? and state = 'CLAIMED' and lease_token = ?`);
  const expire = options.database.prepare(`update v07_idempotency_records
    set state = 'FAILED', lease_token = null, lease_expires_at = null, response_status = 503,
        response_json = ?, updated_at = ?
    where id = ? and owner_id = ? and state = 'CLAIMED' and lease_expires_at <= ?`);

  return {
    executeLocal(command, execute) {
      return options.database.transaction(() => {
        const requestHash = hashCommand(command);
        const at = now();
        const nowIso = at.toISOString();
        const existingRow = find.get(command.ownerId, command.key) as Parameters<typeof toRecord>[0] | undefined;
        if (existingRow) {
          const existing = toRecord(existingRow);
          if (
            existing.operation !== command.operation ||
            existing.resourceId !== command.resourceId ||
            existing.requestHash !== requestHash
          ) {
            throw new V07IdempotencyConflictError();
          }
          if (existing.state === 'CLAIMED') {
            if (existing.leaseExpiresAt && existing.leaseExpiresAt > nowIso) {
              return { kind: 'IN_PROGRESS' as const, retryAfterSeconds: 1 as const };
            }
            const interrupted = { error: { code: 'V07_COMMAND_INTERRUPTED' } };
            const changed = expire.run(
              canonicalJson(interrupted),
              nowIso,
              existing.id,
              command.ownerId,
              nowIso,
            ).changes;
            if (changed !== 1) return { kind: 'IN_PROGRESS' as const, retryAfterSeconds: 1 as const };
            return { status: 503, body: interrupted, replayed: true };
          }
          if (!existing.response) throw new Error('V07_TERMINAL_RESPONSE_MISSING');
          return { ...existing.response, replayed: true };
        }

        const recordId = newId();
        const leaseToken = newLeaseToken();
        insert.run(
          recordId,
          command.ownerId,
          command.key,
          command.operation,
          command.resourceId,
          requestHash,
          leaseToken,
          new Date(at.getTime() + leaseMs).toISOString(),
          nowIso,
          nowIso,
        );
        const result = execute();
        const finalized = complete.run(
          result.status,
          canonicalJson(result.body),
          nowIso,
          recordId,
          command.ownerId,
          leaseToken,
        ).changes;
        if (finalized !== 1) throw new Error('V07_LOCAL_IDEMPOTENCY_FINALIZE_FAILED');
        return { ...result, replayed: false };
      })();
    },
  };
}
