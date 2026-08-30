import { openDatabase } from '../src/storage/database';
import { createProviderReliabilityRepository } from '../src/modules/providers/reliability-repository';
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { APP_VERSION } from '@ev/contracts';

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('v0.5 provider reliability repository', () => {
  it('keeps idempotency records owner-scoped and persists only allowlisted Provider metadata', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const createdAt = '2026-08-23T00:00:00.000Z';
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run('owner-a', 'owner-a', 'hash', createdAt);
    database.pragma('ignore_check_constraints = ON');
    database
      .prepare(
        `insert into owners (singleton_key, id, username, password_hash, created_at)
         values (2, ?, ?, ?, ?)`,
      )
      .run('owner-b', 'owner-b', 'hash', createdAt);
    database.pragma('ignore_check_constraints = OFF');
    const repository = createProviderReliabilityRepository(database);

    const first = repository.createInProgress({
      id: 'idempotency-a',
      ownerId: 'owner-a',
      key: 'v05-idempotency-key-0001',
      operation: 'daily_plan.generate',
      resourceId: 'preflight-a',
      requestHash: 'a'.repeat(64),
      leaseToken: 'lease-token-a',
      leaseExpiresAt: '2026-08-23T00:00:20.000Z',
      attemptCount: 1,
      createdAt,
    });
    repository.createInProgress({
      id: 'idempotency-b',
      ownerId: 'owner-b',
      key: first.key,
      operation: first.operation,
      resourceId: first.resourceId,
      requestHash: first.requestHash,
      leaseToken: 'lease-token-b',
      leaseExpiresAt: '2026-08-23T00:00:20.000Z',
      attemptCount: 1,
      createdAt,
    });

    expect(repository.find('owner-a', 'v05-idempotency-key-0001')).toMatchObject({
      id: 'idempotency-a',
      ownerId: 'owner-a',
      state: 'IN_PROGRESS',
      response: null,
    });
    expect(repository.find('owner-b', 'v05-idempotency-key-0001')).toMatchObject({
      id: 'idempotency-b',
      ownerId: 'owner-b',
    });
    expect(
      repository.complete({
        ownerId: 'owner-a',
        recordId: 'idempotency-a',
        leaseToken: 'lease-token-a',
        status: 201,
        response: { data: { safe: 'proposal' } },
        updatedAt: '2026-08-23T00:00:01.000Z',
      }),
    ).toBe(true);

    repository.startProviderCall({
      id: 'provider-call-a',
      ownerId: 'owner-a',
      runId: null,
      idempotencyRecordId: 'idempotency-a',
      provider: 'DEEPSEEK',
      operation: 'daily_plan.generate',
      model: 'deepseek-v4-flash',
      attemptNo: 1,
      inputChars: 199,
      localDate: '2026-08-23',
      startedAt: createdAt,
    });
    expect(
      repository.finishProviderCall({
        id: 'provider-call-a',
        status: 'SUCCEEDED',
        failureCode: null,
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        outputChars: 73,
        finishedAt: '2026-08-23T00:00:01.000Z',
        durationMs: 1_000,
      }),
    ).toBe(true);

    expect(
      database.prepare('select * from provider_call_logs where id = ?').get('provider-call-a'),
    ).toEqual({
      id: 'provider-call-a',
      owner_id: 'owner-a',
      run_id: null,
      idempotency_record_id: 'idempotency-a',
      provider: 'DEEPSEEK',
      operation: 'daily_plan.generate',
      model: 'deepseek-v4-flash',
      attempt_no: 1,
      status: 'SUCCEEDED',
      failure_code: null,
      finish_reason: 'stop',
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      input_chars: 199,
      output_chars: 73,
      policy_version: 'PROVIDER_POLICY_V1',
      contract_version: 'DAILY_PLAN_V1',
      app_version: APP_VERSION,
      local_date: '2026-08-23',
      started_at: createdAt,
      finished_at: '2026-08-23T00:00:01.000Z',
      duration_ms: 1_000,
    });
  });
});
