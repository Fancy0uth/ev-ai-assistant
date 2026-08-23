import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/storage/database';
import {
  IdempotencyConflictError,
  createIdempotencyService,
} from '../src/modules/providers/idempotency-service';
import { createProviderReliabilityRepository } from '../src/modules/providers/reliability-repository';

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('v0.5 idempotency service', () => {
  it('normalizes request data, replays an owner-scoped completed response, and rejects semantic key reuse', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const now = new Date('2026-08-23T00:00:00.000Z');
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run('owner-a', 'owner-a', 'hash', now.toISOString());
    const repository = createProviderReliabilityRepository(database);
    const service = createIdempotencyService({
      database,
      repository,
      now: () => now,
      newId: () => 'record-a',
      newLeaseToken: () => 'lease-a',
    });
    const request = {
      ownerId: 'owner-a',
      key: 'v05-idempotency-key-0001',
      operation: 'daily_plan.generate' as const,
      resourceId: 'preflight-a',
      body: { expectedPreflightVersion: 2, preflightId: 'preflight-a' },
    };

    const claimed = service.claim(request);
    expect(claimed).toMatchObject({ kind: 'CLAIMED', attemptCount: 1, leaseToken: 'lease-a' });
    if (claimed.kind !== 'CLAIMED') throw new Error('expected a fresh claim');
    expect(
      service.complete({
        ...claimed,
        status: 201,
        body: { data: { id: 'proposal-a' } },
      }),
    ).toBe(true);

    expect(service.claim({ ...request, body: { preflightId: 'preflight-a', expectedPreflightVersion: 2 } })).toEqual({
      kind: 'REPLAY',
      status: 201,
      body: { data: { id: 'proposal-a' } },
    });
    expect(() => service.claim({ ...request, body: { preflightId: 'preflight-a', expectedPreflightVersion: 3 } })).toThrow(
      IdempotencyConflictError,
    );
  });

  it('recovers one expired lease and then terminally seals a second expiration', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    let current = new Date('2026-08-23T00:00:00.000Z');
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run('owner-recovery', 'owner-recovery', 'hash', current.toISOString());
    let id = 0;
    const service = createIdempotencyService({
      database,
      repository: createProviderReliabilityRepository(database),
      now: () => current,
      newId: () => `record-${++id}`,
      newLeaseToken: () => `lease-${++id}`,
    });
    const request = {
      ownerId: 'owner-recovery',
      key: 'v05-idempotency-key-0002',
      operation: 'daily_plan.generate' as const,
      resourceId: 'preflight-recovery',
      body: { preflightId: 'preflight-recovery', expectedPreflightVersion: 2 },
    };

    expect(service.claim(request)).toMatchObject({ kind: 'CLAIMED', attemptCount: 1, recovered: false });
    current = new Date('2026-08-23T00:00:21.000Z');
    expect(service.claim(request)).toMatchObject({ kind: 'CLAIMED', attemptCount: 2, recovered: true });
    current = new Date('2026-08-23T00:00:42.000Z');
    expect(service.claim(request)).toMatchObject({
      kind: 'TERMINAL',
      status: 503,
      body: { error: { code: 'DAILY_PLAN_PROVIDER_INTERRUPTED' } },
    });
  });
});
