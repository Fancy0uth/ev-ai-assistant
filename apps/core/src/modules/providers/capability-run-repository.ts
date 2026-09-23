import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { APP_VERSION, type CapabilityDescriptor } from '@ev/contracts';
import { CAPABILITY_POLICY, providerUsageLocalDate } from './provider-policy';

export interface CapabilityRunRepository {
  sweepExpired(now: string): number;
  create(input: {
    id: string; ownerId: string; resourceId: string;
    capability: 'PUBLIC_LEARNING_SEARCH' | 'LEARNING_TEXT_ANALYSIS';
    operation: 'COURSE_RESOURCE_SEARCH' | 'LEARNING_ADVICE_GENERATE';
    descriptor: CapabilityDescriptor; status: 'BLOCKED_PROVIDER' | 'AWAITING_DISCLOSURE'; createdAt: string;
  }): void;
  findByOwnerAndId(ownerId: string, id: string): CapabilityRun | undefined;
  findByOwnerAndIdempotencyKey(ownerId: string, idempotencyKey: string): CapabilityRun | undefined;
  claim(ownerId: string, id: string, idempotencyKey: string, requestHash: string, now: string): boolean;
  quotaExhausted(ownerId: string, id: string, now: string): boolean;
  complete(ownerId: string, id: string, input: {
    leaseToken: string;
    status: 'SUCCEEDED' | 'FAILED';
    actualCalls: number;
    inputChars: number;
    outputChars: number;
    failureCode: string | null;
    evidenceKind: CapabilityDescriptor['evidenceKind'];
    now: string;
  }): boolean;
}

export interface CapabilityRun {
  id: string;
  ownerId: string;
  resourceId: string;
  status: 'BLOCKED_PROVIDER' | 'AWAITING_DISCLOSURE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  idempotencyKey: string | null;
  requestHash: string | null;
  leaseToken: string | null;
  version: number;
}

type Capability = 'COURSE_SCHEDULE_VISION' | 'PUBLIC_LEARNING_SEARCH' | 'LEARNING_TEXT_ANALYSIS';

function executionPolicy(capability: Capability) {
  if (capability === 'COURSE_SCHEDULE_VISION') return CAPABILITY_POLICY.vision;
  if (capability === 'PUBLIC_LEARNING_SEARCH') return CAPABILITY_POLICY.publicSearch;
  return CAPABILITY_POLICY.learningAdvice;
}

export function createCapabilityRunRepository(database: Database.Database): CapabilityRunRepository {
  const findExpired = database.prepare(`select id, owner_id, operation, resource_id, reserved_calls, actual_calls
    from external_capability_runs
    where status = 'RUNNING' and lease_expires_at is not null and lease_expires_at <= ?
    order by id`);
  const terminalize = database.prepare(`update external_capability_runs
    set status = 'FAILED', failure_code = 'CAPABILITY_EXECUTION_STALE', lease_token = null,
        lease_expires_at = null, deadline_at = null, reserved_calls = ?, actual_calls = ?,
        evidence_kind = 'NONE', updated_at = ?, version = version + 1
    where id = ? and owner_id = ? and status = 'RUNNING'
      and lease_expires_at is not null and lease_expires_at <= ?`);
  const failCourseImport = database.prepare(`update course_imports_v2
    set status = 'FAILED', failure_code = 'CAPABILITY_EXECUTION_STALE', updated_at = ?, version = version + 1
    where id = ? and owner_id = ? and capability_run_id = ? and status = 'EXTRACTING'`);
  const failResourceSearch = database.prepare(`update course_resource_search_runs
    set status = 'FAILED', failure_code = 'CAPABILITY_EXECUTION_STALE', updated_at = ?, version = version + 1
    where id = ? and owner_id = ? and capability_run_id = ? and status = 'SEARCHING'`);
  const failLearningRun = database.prepare(`update learning_runs
    set status = 'FAILED', failure_code = 'CAPABILITY_EXECUTION_STALE', updated_at = ?, version = version + 1
    where id = ? and owner_id = ? and capability_run_id = ? and status = 'GENERATING'`);
  const runColumns = 'id, owner_id, resource_id, status, idempotency_key, request_hash, lease_token, version';
  const findByOwnerAndId = database.prepare(`select ${runColumns} from external_capability_runs where owner_id = ? and id = ?`);
  const findByOwnerAndIdempotencyKey = database.prepare(`select ${runColumns} from external_capability_runs where owner_id = ? and idempotency_key = ?`);
  const insert = database.prepare(`insert into external_capability_runs (
    id, owner_id, capability, operation, resource_id, provider_id, provider_label, adapter_kind, evidence_kind,
    disclosure_json, disclosure_version, idempotency_key, request_hash, status, lease_token, lease_expires_at,
    deadline_at, policy_version, local_date, reserved_calls, actual_calls, input_chars, output_chars, failure_code,
    app_version, created_at, updated_at, version
  ) values (?, ?, ?, ?, ?, ?, ?, ?, 'NONE', ?, 'CAPABILITY_DISCLOSURE_V1', null, null, ?, null, null, null,
    'CAPABILITY_POLICY_V1', ?, 0, 0, 0, 0, null, ?, ?, ?, 1)`);
  const findClaimTarget = database.prepare(`select capability from external_capability_runs
    where owner_id = ? and id = ? and status = 'AWAITING_DISCLOSURE' and idempotency_key is null`);
  const usage = database.prepare(`select coalesce(sum(case when status = 'RUNNING' then reserved_calls else actual_calls end), 0) as calls
    from external_capability_runs where owner_id = ? and local_date = ? and capability = ?`);
  const claim = database.prepare(`update external_capability_runs
    set idempotency_key = ?, request_hash = ?, status = 'RUNNING', lease_token = ?, lease_expires_at = ?, deadline_at = ?,
        local_date = ?, reserved_calls = 1, actual_calls = 0, evidence_kind = 'NONE', failure_code = null,
        updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and status = 'AWAITING_DISCLOSURE' and idempotency_key is null`);
  const complete = database.prepare(`update external_capability_runs
    set status = ?, lease_token = null, lease_expires_at = null, deadline_at = null,
        reserved_calls = ?, actual_calls = ?, input_chars = ?, output_chars = ?, failure_code = ?, evidence_kind = ?,
        updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and status = 'RUNNING' and lease_token = ?`);
  const claimTransaction = database.transaction((
    ownerId: string,
    id: string,
    idempotencyKey: string,
    requestHash: string,
    now: string,
  ): boolean => {
    const target = findClaimTarget.get(ownerId, id) as { capability: Capability } | undefined;
    if (!target) return false;
    const executionLocalDate = providerUsageLocalDate(new Date(now));
    const consumed = usage.get(ownerId, executionLocalDate, target.capability) as { calls: number };
    if (consumed.calls >= CAPABILITY_POLICY.maxCallsPerOwnerDay) return false;
    const policy = executionPolicy(target.capability);
    const leaseToken = randomUUID();
    const deadlineAt = new Date(Date.parse(now) + policy.totalTimeoutMs).toISOString();
    const leaseExpiresAt = new Date(Date.parse(deadlineAt) + CAPABILITY_POLICY.leaseGraceMs).toISOString();
    try {
      return claim.run(
        idempotencyKey,
        requestHash,
        leaseToken,
        leaseExpiresAt,
        deadlineAt,
        executionLocalDate,
        now,
        ownerId,
        id,
      ).changes === 1;
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: external_capability_runs\.owner_id, external_capability_runs\.idempotency_key/.test(error.message)) return false;
      throw error;
    }
  });
  const sweepTransaction = database.transaction((now: string): number => {
    const expired = findExpired.all(now) as Array<{
      id: string;
      owner_id: string;
      operation: 'COURSE_IMPORT_EXTRACT' | 'COURSE_RESOURCE_SEARCH' | 'LEARNING_ADVICE_GENERATE';
      resource_id: string;
      reserved_calls: number;
      actual_calls: number;
    }>;
    let terminalized = 0;
    for (const run of expired) {
      const charged = Math.max(run.actual_calls, run.reserved_calls);
      const changed = terminalize.run(charged, charged, now, run.id, run.owner_id, now).changes;
      if (changed !== 1) continue;
      terminalized += 1;
      if (run.operation === 'COURSE_IMPORT_EXTRACT') {
        failCourseImport.run(now, run.resource_id, run.owner_id, run.id);
      } else if (run.operation === 'COURSE_RESOURCE_SEARCH') {
        failResourceSearch.run(now, run.resource_id, run.owner_id, run.id);
      } else {
        failLearningRun.run(now, run.resource_id, run.owner_id, run.id);
      }
    }
    return terminalized;
  });
  const toRun = (row: {
    id: string;
    owner_id: string;
    resource_id: string;
    status: CapabilityRun['status'];
    idempotency_key: string | null;
    request_hash: string | null;
    lease_token: string | null;
    version: number;
  }): CapabilityRun => ({
    id: row.id,
    ownerId: row.owner_id,
    resourceId: row.resource_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    leaseToken: row.lease_token,
    version: row.version,
  });
  return {
    sweepExpired(now) {
      return sweepTransaction.immediate(now);
    },
    create(input) {
      insert.run(
        input.id,
        input.ownerId,
        input.capability,
        input.operation,
        input.resourceId,
        input.descriptor.providerId,
        input.descriptor.providerLabel,
        input.descriptor.adapterKind,
        JSON.stringify(input.descriptor),
        input.status,
        providerUsageLocalDate(new Date(input.createdAt)),
        APP_VERSION,
        input.createdAt,
        input.createdAt,
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
      return claimTransaction.immediate(ownerId, id, idempotencyKey, requestHash, now);
    },
    quotaExhausted(ownerId, id, now) {
      const target = database.prepare('select capability from external_capability_runs where owner_id = ? and id = ?')
        .get(ownerId, id) as { capability: Capability } | undefined;
      if (!target) return false;
      const executionLocalDate = providerUsageLocalDate(new Date(now));
      return (usage.get(ownerId, executionLocalDate, target.capability) as { calls: number }).calls >= CAPABILITY_POLICY.maxCallsPerOwnerDay;
    },
    complete(ownerId, id, input) {
      const evidenceKind = input.status === 'SUCCEEDED' ? input.evidenceKind : 'NONE';
      return complete.run(
        input.status,
        input.actualCalls,
        input.actualCalls,
        input.inputChars,
        input.outputChars,
        input.failureCode,
        evidenceKind,
        input.now,
        ownerId,
        id,
        input.leaseToken,
      ).changes === 1;
    },
  };
}
