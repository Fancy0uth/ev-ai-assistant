import type Database from 'better-sqlite3';

export type V07Capability =
  | 'WORKOUT_TEXT_SELECTION'
  | 'MEAL_CANDIDATE_PARSE'
  | 'NUTRITION_DATA_LOOKUP';

export type V07CapabilityRunState =
  | 'BLOCKED_PROVIDER'
  | 'AWAITING_DISCLOSURE'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED';

export interface V07CapabilityRun {
  id: string;
  ownerId: string;
  capability: V07Capability;
  operation: string;
  resourceId: string;
  idempotencyKey: string | null;
  requestHash: string | null;
  state: V07CapabilityRunState;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  reservedCalls: number;
  actualCalls: number;
  providerId: string | null;
  providerLabel: string;
  adapterKind: 'NONE' | 'TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'PRODUCTION_ADAPTER';
  evidenceKind: 'NONE' | 'AUTOMATED_TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'REAL_PROVIDER';
  inputBytes: number;
  outputBytes: number;
  failureCode: string | null;
  localDate: string;
  nutritionSourceVersion: string | null;
  nutritionDatasetHash: string | null;
  appVersion: string;
  version: number;
}

export interface V07HealthLoopRepository {
  createCapabilityRun(input: {
    id: string;
    ownerId: string;
    capability: V07Capability;
    operation: string;
    resourceId: string;
    providerId: string | null;
    providerLabel: string;
    adapterKind: 'NONE' | 'TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'PRODUCTION_ADAPTER';
    evidenceKind: 'NONE' | 'AUTOMATED_TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'REAL_PROVIDER';
    disclosure: unknown;
    status: 'BLOCKED_PROVIDER' | 'AWAITING_DISCLOSURE';
    localDate: string;
    appVersion: string;
    createdAt: string;
    nutritionSourceVersion?: string | null;
    nutritionDatasetHash?: string | null;
  }): void;
  createClaimedCapabilityRun(input: {
    id: string;
    ownerId: string;
    capability: V07Capability;
    operation: string;
    resourceId: string;
    providerId: string;
    providerLabel: string;
    adapterKind: 'TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'PRODUCTION_ADAPTER';
    disclosure: unknown;
    localDate: string;
    appVersion: string;
    idempotencyKey: string;
    requestHash: string;
    leaseToken: string;
    leaseExpiresAt: string;
    deadlineAt: string;
    createdAt: string;
    nutritionSourceVersion?: string | null;
    nutritionDatasetHash?: string | null;
  }): void;
  findCapabilityRun(ownerId: string, id: string): V07CapabilityRun | undefined;
  findCapabilityRunByIdempotencyKey(ownerId: string, key: string): V07CapabilityRun | undefined;
  claimCapabilityRun(input: {
    ownerId: string;
    id: string;
    key: string;
    requestHash: string;
    leaseToken: string;
    leaseExpiresAt: string;
    deadlineAt: string;
    reservedCalls: number;
    now: string;
  }): boolean;
  completeCapabilityRun(input: {
    ownerId: string;
    id: string;
    leaseToken: string;
    actualCalls: number;
    inputBytes: number;
    outputBytes: number;
    evidenceKind: 'NONE' | 'AUTOMATED_TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'REAL_PROVIDER';
    now: string;
  }): boolean;
  failCapabilityRun(input: {
    ownerId: string;
    id: string;
    leaseToken: string;
    actualCalls: number;
    inputBytes: number;
    outputBytes: number;
    failureCode: string;
    now: string;
  }): boolean;
  failExpiredCapabilityRunByIdempotencyKey(ownerId: string, key: string, now: string): boolean;
  sweepExpiredCapabilityRuns(now: string): number;
  countReservedCalls(ownerId: string, localDate: string, capability: V07Capability): number;
  appendAudit(input: {
    id: string;
    ownerId: string;
    eventType: string;
    entityType: string;
    entityId: string;
    entityVersion: number;
    metadata: unknown;
    createdAt: string;
  }): void;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('V07_AUDIT_NON_FINITE_VALUE');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .filter((key) => object[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  throw new Error('V07_AUDIT_UNSUPPORTED_VALUE');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function toRun(row: {
  id: string;
  owner_id: string;
  capability: V07Capability;
  operation: string;
  resource_id: string;
  idempotency_key: string | null;
  request_hash: string | null;
  state: V07CapabilityRunState;
  lease_token: string | null;
  lease_expires_at: string | null;
  reserved_calls: number;
  actual_calls: number;
  provider_id: string | null;
  provider_label: string;
  adapter_kind: V07CapabilityRun['adapterKind'];
  evidence_kind: V07CapabilityRun['evidenceKind'];
  input_bytes: number;
  output_bytes: number;
  failure_code: string | null;
  local_date: string;
  nutrition_source_version: string | null;
  nutrition_dataset_hash: string | null;
  app_version: string;
  version: number;
}): V07CapabilityRun {
  return {
    id: row.id,
    ownerId: row.owner_id,
    capability: row.capability,
    operation: row.operation,
    resourceId: row.resource_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    state: row.state,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    reservedCalls: row.reserved_calls,
    actualCalls: row.actual_calls,
    providerId: row.provider_id,
    providerLabel: row.provider_label,
    adapterKind: row.adapter_kind,
    evidenceKind: row.evidence_kind,
    inputBytes: row.input_bytes,
    outputBytes: row.output_bytes,
    failureCode: row.failure_code,
    localDate: row.local_date,
    nutritionSourceVersion: row.nutrition_source_version,
    nutritionDatasetHash: row.nutrition_dataset_hash,
    appVersion: row.app_version,
    version: row.version,
  };
}

export function createV07HealthLoopRepository(database: Database.Database): V07HealthLoopRepository {
  const runColumns = `id, owner_id, capability, operation, resource_id, idempotency_key,
    request_hash, state, lease_token, lease_expires_at, reserved_calls, actual_calls, provider_id,
    provider_label, adapter_kind, evidence_kind, input_bytes, output_bytes, failure_code, local_date,
    nutrition_source_version, nutrition_dataset_hash, app_version, version`;
  const findCapabilityRun = database.prepare(
    `select ${runColumns} from v07_capability_runs where owner_id = ? and id = ?`,
  );
  const findCapabilityRunByIdempotencyKey = database.prepare(
    `select ${runColumns} from v07_capability_runs where owner_id = ? and idempotency_key = ?`,
  );
  const createCapabilityRun = database.prepare(`insert into v07_capability_runs (
    id, owner_id, capability, operation, resource_id, provider_id, provider_label, adapter_kind,
    evidence_kind, disclosure_json, disclosure_version, idempotency_key, request_hash, state,
    lease_token, lease_expires_at, deadline_at, policy_version, local_date, reserved_calls,
    actual_calls, input_bytes, output_bytes, failure_code, nutrition_source_version,
    nutrition_dataset_hash, app_version, created_at, updated_at, version
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HEALTH_DISCLOSURE_V1', null, null, ?, null, null,
    null, 'HEALTH_CAPABILITY_POLICY_V1', ?, 0, 0, 0, 0, null, ?, ?, ?, ?, ?, 1)`);
  const createClaimedCapabilityRun = database.prepare(`insert into v07_capability_runs (
    id, owner_id, capability, operation, resource_id, provider_id, provider_label, adapter_kind,
    evidence_kind, disclosure_json, disclosure_version, idempotency_key, request_hash, state,
    lease_token, lease_expires_at, deadline_at, policy_version, local_date, reserved_calls,
    actual_calls, input_bytes, output_bytes, failure_code, nutrition_source_version,
    nutrition_dataset_hash, app_version, created_at, updated_at, version
  ) values (?, ?, ?, ?, ?, ?, ?, ?, 'NONE', ?, 'HEALTH_DISCLOSURE_V1', ?, ?, 'RUNNING', ?, ?, ?,
    'HEALTH_CAPABILITY_POLICY_V1', ?, 1, 0, 0, 0, null, ?, ?, ?, ?, ?, 1)`);
  const claimCapabilityRun = database.prepare(`update v07_capability_runs
    set idempotency_key = ?, request_hash = ?, state = 'RUNNING', lease_token = ?,
        lease_expires_at = ?, deadline_at = ?, reserved_calls = ?, actual_calls = 0,
        evidence_kind = 'NONE', failure_code = null, updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and state = 'AWAITING_DISCLOSURE' and idempotency_key is null`);
  const completeCapabilityRun = database.prepare(`update v07_capability_runs
    set state = 'SUCCEEDED', lease_token = null, lease_expires_at = null, deadline_at = null,
        actual_calls = ?, reserved_calls = ?, input_bytes = ?, output_bytes = ?, evidence_kind = ?,
        failure_code = null, updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and state = 'RUNNING' and lease_token = ?`);
  const failCapabilityRun = database.prepare(`update v07_capability_runs
    set state = 'FAILED', lease_token = null, lease_expires_at = null, deadline_at = null,
        actual_calls = ?, reserved_calls = ?, input_bytes = ?, output_bytes = ?, evidence_kind = 'NONE',
        failure_code = ?, updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and state = 'RUNNING' and lease_token = ?`);
  const failExpiredCapabilityRunByIdempotencyKey = database.prepare(`update v07_capability_runs
    set state = 'FAILED', lease_token = null, lease_expires_at = null, deadline_at = null,
        actual_calls = max(actual_calls, reserved_calls), evidence_kind = 'NONE',
        failure_code = 'V07_COMMAND_INTERRUPTED', updated_at = ?, version = version + 1
    where owner_id = ? and idempotency_key = ? and state = 'RUNNING' and lease_expires_at <= ?`);
  const sweepExpiredCapabilityRuns = database.prepare(`update v07_capability_runs
    set state = 'FAILED', lease_token = null, lease_expires_at = null, deadline_at = null,
        actual_calls = max(actual_calls, reserved_calls), evidence_kind = 'NONE',
        failure_code = 'V07_COMMAND_INTERRUPTED', updated_at = ?, version = version + 1
    where state = 'RUNNING' and lease_expires_at <= ?`);
  const countReservedCalls = database.prepare(`select coalesce(sum(
    case when state = 'RUNNING' then reserved_calls else actual_calls end
  ), 0) as calls from v07_capability_runs where owner_id = ? and local_date = ? and capability = ?`);
  const appendAudit = database.prepare(`insert into v07_audit_events (
    id, owner_id, event_type, entity_type, entity_id, entity_version, metadata_json, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?)`);

  return {
    createCapabilityRun(input) {
      createCapabilityRun.run(
        input.id,
        input.ownerId,
        input.capability,
        input.operation,
        input.resourceId,
        input.providerId,
        input.providerLabel,
        input.adapterKind,
        input.evidenceKind,
        canonicalJson(input.disclosure),
        input.status,
        input.localDate,
        input.nutritionSourceVersion ?? null,
        input.nutritionDatasetHash ?? null,
        input.appVersion,
        input.createdAt,
        input.createdAt,
      );
    },
    createClaimedCapabilityRun(input) {
      createClaimedCapabilityRun.run(
        input.id,
        input.ownerId,
        input.capability,
        input.operation,
        input.resourceId,
        input.providerId,
        input.providerLabel,
        input.adapterKind,
        canonicalJson(input.disclosure),
        input.idempotencyKey,
        input.requestHash,
        input.leaseToken,
        input.leaseExpiresAt,
        input.deadlineAt,
        input.localDate,
        input.nutritionSourceVersion ?? null,
        input.nutritionDatasetHash ?? null,
        input.appVersion,
        input.createdAt,
        input.createdAt,
      );
    },
    findCapabilityRun(ownerId, id) {
      const row = findCapabilityRun.get(ownerId, id) as Parameters<typeof toRun>[0] | undefined;
      return row ? toRun(row) : undefined;
    },
    findCapabilityRunByIdempotencyKey(ownerId, key) {
      const row = findCapabilityRunByIdempotencyKey.get(ownerId, key) as Parameters<typeof toRun>[0] | undefined;
      return row ? toRun(row) : undefined;
    },
    claimCapabilityRun(input) {
      return claimCapabilityRun.run(
        input.key,
        input.requestHash,
        input.leaseToken,
        input.leaseExpiresAt,
        input.deadlineAt,
        input.reservedCalls,
        input.now,
        input.ownerId,
        input.id,
      ).changes === 1;
    },
    completeCapabilityRun(input) {
      const chargedCalls = Math.max(input.actualCalls, 0);
      return completeCapabilityRun.run(
        chargedCalls,
        chargedCalls,
        input.inputBytes,
        input.outputBytes,
        input.evidenceKind,
        input.now,
        input.ownerId,
        input.id,
        input.leaseToken,
      ).changes === 1;
    },
    failCapabilityRun(input) {
      const chargedCalls = Math.max(input.actualCalls, 0);
      return failCapabilityRun.run(
        chargedCalls,
        chargedCalls,
        input.inputBytes,
        input.outputBytes,
        input.failureCode,
        input.now,
        input.ownerId,
        input.id,
        input.leaseToken,
      ).changes === 1;
    },
    failExpiredCapabilityRunByIdempotencyKey(ownerId, key, now) {
      return failExpiredCapabilityRunByIdempotencyKey.run(now, ownerId, key, now).changes === 1;
    },
    sweepExpiredCapabilityRuns(now) {
      return sweepExpiredCapabilityRuns.run(now, now).changes;
    },
    countReservedCalls(ownerId, localDate, capability) {
      return (countReservedCalls.get(ownerId, localDate, capability) as { calls: number }).calls;
    },
    appendAudit(input) {
      appendAudit.run(
        input.id,
        input.ownerId,
        input.eventType,
        input.entityType,
        input.entityId,
        input.entityVersion,
        canonicalJson(input.metadata),
        input.createdAt,
      );
    },
  };
}
