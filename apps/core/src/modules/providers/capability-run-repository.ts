import type Database from 'better-sqlite3';
import { APP_VERSION, type CapabilityDescriptor } from '@ev/contracts';

export interface CapabilityRunRepository {
  sweepExpired(now: string): number;
  create(input: {
    id: string; ownerId: string; resourceId: string; capability: 'PUBLIC_LEARNING_SEARCH'; operation: 'COURSE_RESOURCE_SEARCH';
    descriptor: CapabilityDescriptor; status: 'BLOCKED_PROVIDER' | 'AWAITING_DISCLOSURE'; createdAt: string;
  }): void;
  findByOwnerAndId(ownerId: string, id: string): CapabilityRun | undefined;
  findByOwnerAndIdempotencyKey(ownerId: string, idempotencyKey: string): CapabilityRun | undefined;
  claim(ownerId: string, id: string, idempotencyKey: string, requestHash: string, now: string): boolean;
  complete(ownerId: string, id: string, input: { status: 'SUCCEEDED' | 'FAILED'; actualCalls: number; inputChars: number; outputChars: number; failureCode: string | null; now: string }): void;
}

export interface CapabilityRun {
  id: string;
  ownerId: string;
  resourceId: string;
  status: 'BLOCKED_PROVIDER' | 'AWAITING_DISCLOSURE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  idempotencyKey: string | null;
  requestHash: string | null;
  version: number;
}

export function createCapabilityRunRepository(database: Database.Database): CapabilityRunRepository {
  const terminalize = database.prepare(`update external_capability_runs
    set status = 'FAILED', failure_code = 'CAPABILITY_EXECUTION_STALE', lease_token = null,
        lease_expires_at = null, updated_at = ?, version = version + 1
    where status = 'RUNNING' and lease_expires_at is not null and lease_expires_at <= ?`);
  const findByOwnerAndId = database.prepare('select id, owner_id, resource_id, status, idempotency_key, request_hash, version from external_capability_runs where owner_id = ? and id = ?');
  const findByOwnerAndIdempotencyKey = database.prepare('select id, owner_id, resource_id, status, idempotency_key, request_hash, version from external_capability_runs where owner_id = ? and idempotency_key = ?');
  const insert = database.prepare(`insert into external_capability_runs (
    id, owner_id, capability, operation, resource_id, provider_id, provider_label, adapter_kind, evidence_kind,
    disclosure_json, disclosure_version, idempotency_key, request_hash, status, lease_token, lease_expires_at,
    deadline_at, policy_version, local_date, reserved_calls, actual_calls, input_chars, output_chars, failure_code,
    app_version, created_at, updated_at, version
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CAPABILITY_DISCLOSURE_V1', null, null, ?, null, null, null,
    'CAPABILITY_POLICY_V1', ?, 0, 0, 0, 0, null, ?, ?, ?, 1)`);
  const claim = database.prepare(`update external_capability_runs
    set idempotency_key = ?, request_hash = ?, status = 'RUNNING', lease_token = ?, lease_expires_at = ?, deadline_at = ?, reserved_calls = 1, updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and status = 'AWAITING_DISCLOSURE' and idempotency_key is null`);
  const complete = database.prepare(`update external_capability_runs
    set status = ?, lease_token = null, lease_expires_at = null, actual_calls = ?, input_chars = ?, output_chars = ?, failure_code = ?, updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and status = 'RUNNING'`);
  const toRun = (row: {
    id: string; owner_id: string; resource_id: string; status: CapabilityRun['status']; idempotency_key: string | null; request_hash: string | null; version: number;
  }): CapabilityRun => ({ id: row.id, ownerId: row.owner_id, resourceId: row.resource_id, status: row.status, idempotencyKey: row.idempotency_key, requestHash: row.request_hash, version: row.version });
  return {
    sweepExpired(now) {
      return terminalize.run(now, now).changes;
    },
    create(input) {
      insert.run(
        input.id, input.ownerId, input.capability, input.operation, input.resourceId,
        input.descriptor.providerId, input.descriptor.providerLabel, input.descriptor.adapterKind, input.descriptor.evidenceKind,
        JSON.stringify(input.descriptor), input.status, input.createdAt.slice(0, 10), APP_VERSION, input.createdAt, input.createdAt,
      );
    },
    findByOwnerAndId(ownerId, id) {
      const row = findByOwnerAndId.get(ownerId, id) as Parameters<typeof toRun>[0] | undefined;
      return row ? toRun(row) : undefined;
    },
    findByOwnerAndIdempotencyKey(ownerId, idempotencyKey) {
      const row = findByOwnerAndIdempotencyKey.get(ownerId, idempotencyKey) as Parameters<typeof toRun>[0] | undefined;
      return row ? toRun(row) : undefined;
    },
    claim(ownerId, id, idempotencyKey, requestHash, now) {
      return claim.run(idempotencyKey, requestHash, `${idempotencyKey}:${now}`, new Date(Date.parse(now) + 30_000).toISOString(), new Date(Date.parse(now) + 15_000).toISOString(), now, ownerId, id).changes === 1;
    },
    complete(ownerId, id, input) {
      complete.run(input.status, input.actualCalls, input.inputChars, input.outputChars, input.failureCode, input.now, ownerId, id);
    },
  };
}
