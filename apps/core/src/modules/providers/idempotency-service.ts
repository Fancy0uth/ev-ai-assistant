import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { IdempotencyOperation } from '@ev/contracts';
import type {
  IdempotencyRecord,
  ProviderReliabilityRepository,
} from './reliability-repository';

const DEFAULT_LEASE_MS = 20_000;
const INTERRUPTED_RESPONSE = {
  error: {
    code: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
    message: '每日计划生成已中断，请使用新的操作重新发起。',
  },
};

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor() {
    super('IDEMPOTENCY_CONFLICT');
    this.name = 'IdempotencyConflictError';
  }
}

export type IdempotencyClaim =
  | {
      kind: 'CLAIMED';
      recordId: string;
      ownerId: string;
      leaseToken: string;
      attemptCount: number;
      recovered: boolean;
    }
  | { kind: 'REPLAY'; status: number; body: unknown }
  | { kind: 'IN_PROGRESS' }
  | { kind: 'TERMINAL'; status: number; body: unknown };

export type IdempotencyNonClaim = Exclude<IdempotencyClaim, { kind: 'CLAIMED' }>;

export interface IdempotencyClaimInput {
  ownerId: string;
  key: string;
  operation: IdempotencyOperation;
  resourceId: string | null;
  body: unknown;
}

export interface IdempotencyService {
  claim(input: IdempotencyClaimInput): IdempotencyClaim;
  complete(input: Extract<IdempotencyClaim, { kind: 'CLAIMED' }> & {
    status: number;
    body: unknown;
  }): boolean;
  fail(input: Extract<IdempotencyClaim, { kind: 'CLAIMED' }> & {
    status: number;
    body: unknown;
    failureCode: string;
  }): boolean;
  executeLocal<T>(
    input: IdempotencyClaimInput,
    execute: () => { status: number; body: T },
  ): { replayed: boolean; status: number; body: T | unknown } | IdempotencyNonClaim;
}

export interface IdempotencyServiceOptions {
  database: Database.Database;
  repository: ProviderReliabilityRepository;
  now?: () => Date;
  newId?: () => string;
  newLeaseToken?: () => string;
  leaseMs?: number;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Idempotency request contains a non-finite number');
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
  throw new Error('Idempotency request contains an unsupported value');
}

export function hashIdempotencyRequest(input: IdempotencyClaimInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          ownerId: input.ownerId,
          operation: input.operation,
          resourceId: input.resourceId,
          body: input.body,
        }),
      ),
    )
    .digest('hex');
}

function matches(record: IdempotencyRecord, input: IdempotencyClaimInput, requestHash: string): boolean {
  return (
    record.operation === input.operation &&
    record.resourceId === input.resourceId &&
    record.requestHash === requestHash
  );
}

export function createIdempotencyService(options: IdempotencyServiceOptions): IdempotencyService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const newLeaseToken = options.newLeaseToken ?? randomUUID;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;

  const claimTransaction = options.database.transaction((input: IdempotencyClaimInput): IdempotencyClaim => {
    const requestHash = hashIdempotencyRequest(input);
    const existing = options.repository.find(input.ownerId, input.key);
    const nowDate = now();
    const nowIso = nowDate.toISOString();
    const leaseExpiresAt = new Date(nowDate.getTime() + leaseMs).toISOString();

    if (!existing) {
      const record = options.repository.createInProgress({
        id: newId(),
        ownerId: input.ownerId,
        key: input.key,
        operation: input.operation,
        resourceId: input.resourceId,
        requestHash,
        leaseToken: newLeaseToken(),
        leaseExpiresAt,
        attemptCount: 1,
        createdAt: nowIso,
      });
      return {
        kind: 'CLAIMED',
        recordId: record.id,
        ownerId: input.ownerId,
        leaseToken: record.leaseToken as string,
        attemptCount: 1,
        recovered: false,
      };
    }

    if (!matches(existing, input, requestHash)) throw new IdempotencyConflictError();
    if (existing.state !== 'IN_PROGRESS') {
      if (!existing.response) throw new Error('Terminal idempotency record is missing its response');
      return { kind: 'REPLAY', status: existing.response.status, body: existing.response.body };
    }
    if (!existing.leaseExpiresAt || existing.leaseExpiresAt > nowIso) return { kind: 'IN_PROGRESS' };

    if (existing.attemptCount === 1) {
      const leaseToken = newLeaseToken();
      const renewed = options.repository.renewExpiredLease({
        ownerId: input.ownerId,
        recordId: existing.id,
        previousLeaseExpiresAt: existing.leaseExpiresAt,
        leaseToken,
        leaseExpiresAt,
        updatedAt: nowIso,
      });
      if (!renewed) return { kind: 'IN_PROGRESS' };
      return {
        kind: 'CLAIMED',
        recordId: existing.id,
        ownerId: input.ownerId,
        leaseToken,
        attemptCount: 2,
        recovered: true,
      };
    }

    const terminal = options.repository.fail({
      ownerId: input.ownerId,
      recordId: existing.id,
      leaseToken: existing.leaseToken as string,
      status: 503,
      response: INTERRUPTED_RESPONSE,
      failureCode: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
      updatedAt: nowIso,
    });
    if (!terminal) return { kind: 'IN_PROGRESS' };
    return { kind: 'TERMINAL', status: 503, body: INTERRUPTED_RESPONSE };
  });

  return {
    claim(input) {
      return claimTransaction(input);
    },

    complete(input) {
      return options.repository.complete({
        ownerId: input.ownerId,
        recordId: input.recordId,
        leaseToken: input.leaseToken,
        status: input.status,
        response: input.body,
        updatedAt: now().toISOString(),
      });
    },

    fail(input) {
      return options.repository.fail({
        ownerId: input.ownerId,
        recordId: input.recordId,
        leaseToken: input.leaseToken,
        status: input.status,
        response: input.body,
        failureCode: input.failureCode,
        updatedAt: now().toISOString(),
      });
    },

    executeLocal(input, execute) {
      return options.database.transaction(() => {
        const claim = this.claim(input);
        if (claim.kind !== 'CLAIMED') return claim;
        const result = execute();
        if (!this.complete({ ...claim, ...result })) {
          throw new Error('Local idempotency response could not be finalized');
        }
        return { replayed: false, ...result };
      })();
    },
  };
}
