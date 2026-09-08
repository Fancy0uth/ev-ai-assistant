import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { APP_VERSION } from '@ev/contracts';
import { createDailyPlanningContextService } from '../src/modules/daily-planning/context-service';
import { createDailyPlanPreflightService } from '../src/modules/daily-planning/preflight-service';
import { createDailyPlanRunRepository } from '../src/modules/daily-planning/repository';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000005501';
const databaseHandles: Database.Database[] = [];

afterEach(() => {
  while (databaseHandles.length > 0) databaseHandles.pop()?.close();
});

describe('v0.5 Daily Plan Provider lease', () => {
  it('allows one expired-lease recovery and rejects a late holder from changing the recovered run', () => {
    const database = openDatabase(':memory:');
    databaseHandles.push(database);
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'lease-owner', 'hash', '2026-08-24T00:00:00.000Z');
    const repository = createDailyPlanRunRepository(database);
    const contextService = createDailyPlanningContextService(repository, {
      newId: () => '00000000-0000-4000-8000-000000005511',
    });
    const preflights = createDailyPlanPreflightService({
      contextService,
      repository,
      newId: () => '00000000-0000-4000-8000-000000005512',
      now: () => new Date('2026-08-24T00:00:00.000Z'),
    });
    const prepared = preflights.prepare(ownerId, '2026-08-24');
    const approved = preflights.approve(ownerId, prepared.id, prepared.version, []);
    const first = repository.claimApprovedPreflight({
      ownerId,
      preflightId: approved.id,
      expectedVersion: approved.version,
      claimedAt: '2026-08-24T00:00:00.000Z',
      execution: {
        leaseToken: 'lease-one',
        leaseExpiresAt: '2026-08-24T00:00:20.000Z',
        deadlineAt: '2026-08-24T00:00:15.000Z',
        attemptCount: 1,
        idempotencyRecordId: null,
      },
    });
    if (first.kind !== 'claimed') throw new Error('expected first provider lease claim');

    const recovered = repository.recoverClaimedPreflight({
      ownerId,
      preflightId: approved.id,
      expectedVersion: first.preflight.version,
      claimedAt: '2026-08-24T00:00:21.000Z',
      execution: {
        leaseToken: 'lease-two',
        leaseExpiresAt: '2026-08-24T00:00:41.000Z',
        deadlineAt: '2026-08-24T00:00:36.000Z',
        attemptCount: 2,
        idempotencyRecordId: null,
      },
    });
    if (recovered.kind !== 'claimed') throw new Error('expected recovery claim');

    expect(repository.getRun(ownerId, first.run.id)).toMatchObject({
      status: 'GENERATING',
      attemptCount: 2,
      leaseExpiresAt: '2026-08-24T00:00:41.000Z',
      deadlineAt: '2026-08-24T00:00:36.000Z',
      appVersion: APP_VERSION,
    });
    expect(() =>
      repository.failClaimedPreflight({
        ownerId,
        preflightId: approved.id,
        expectedVersion: first.preflight.version,
        code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
        terminalReason: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
        completedAt: '2026-08-24T00:00:22.000Z',
        leaseToken: 'lease-one',
      }),
    ).toThrow();

    repository.failClaimedPreflight({
      ownerId,
      preflightId: approved.id,
      expectedVersion: recovered.preflight.version,
      code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
      terminalReason: 'DAILY_PLAN_PROVIDER_TIMEOUT',
      completedAt: '2026-08-24T00:00:22.000Z',
      leaseToken: 'lease-two',
    });
    expect(repository.getRun(ownerId, first.run.id)).toMatchObject({
      status: 'FAILED',
      attemptCount: 2,
      terminalReason: 'DAILY_PLAN_PROVIDER_TIMEOUT',
      proposalId: null,
    });
  });
});
