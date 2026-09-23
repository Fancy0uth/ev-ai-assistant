import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityRegistry } from '../src/modules/providers/capabilities';
import { createCapabilityRunRepository } from '../src/modules/providers/capability-run-repository';
import { CAPABILITY_POLICY, executeCapabilityAdapter } from '../src/modules/providers/provider-policy';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/storage/migrations';

afterEach(() => vi.unstubAllEnvs());

describe('v0.6 capability fake gate', () => {
  it('refuses a fake Vision descriptor when the runner-owned data root gate is absent', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EV_E2E_V06_LEARNING_TEST_ADAPTERS', '1');
    vi.stubEnv('EV_E2E_RUN_DIR', 'C:/runner-owned');

    expect(() =>
      createCapabilityRegistry({
        dataRoot: 'C:/outside-runner',
        vision: {
          descriptor: {
            providerId: 'test-vision',
            providerLabel: 'Test Vision',
            adapterKind: 'TEST_FAKE',
          },
          async extractCourseSchedule() {
            return { candidates: [] };
          },
        },
      }),
    ).toThrow(/runner-owned/i);
  });

  it('keeps a configured production adapter at NONE until an execution terminalizes it', () => {
    const registry = createCapabilityRegistry({
      dataRoot: 'C:/test-data',
      publicSearch: {
        descriptor: { providerId: 'production-search', providerLabel: 'Controlled Search', adapterKind: 'PRODUCTION_ADAPTER' },
        async search() { return { results: [] }; },
      },
    });

    expect(registry.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'PUBLIC_LEARNING_SEARCH', adapterKind: 'PRODUCTION_ADAPTER', availability: 'READY', evidenceKind: 'NONE' }),
    ]));
  });

  it('conservatively charges expired reservations without recharging completed zero-call failures', () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database);
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run('quota-owner', 'quota-owner', 'hash', '2026-08-31T00:00:00.000Z');
      const repository = createCapabilityRunRepository(database);
      const descriptor = {
        capability: 'PUBLIC_LEARNING_SEARCH' as const,
        providerId: 'controlled-search', providerLabel: 'Controlled Search', adapterKind: 'PRODUCTION_ADAPTER' as const,
        evidenceKind: 'NONE' as const, availability: 'READY' as const,
      };
      for (let index = 0; index < 21; index += 1) {
        repository.create({
          id: `stale-run-${index}`, ownerId: 'quota-owner', resourceId: `stale-resource-${index}`,
          capability: 'PUBLIC_LEARNING_SEARCH', operation: 'COURSE_RESOURCE_SEARCH', descriptor,
          status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T00:00:00.000Z',
        });
      }
      for (let index = 0; index < 20; index += 1) {
        expect(repository.claim(
          'quota-owner', `stale-run-${index}`, `stale-key-${index}`, `${index}`.padStart(64, '0'),
          '2026-08-31T01:00:00.000Z',
        )).toBe(true);
      }

      expect(repository.sweepExpired('2026-08-31T01:00:21.000Z')).toBe(20);
      expect(database.prepare(`select count(*) as count from external_capability_runs
        where id like 'stale-run-%' and status = 'FAILED' and failure_code = 'CAPABILITY_EXECUTION_STALE'
          and reserved_calls = 1 and actual_calls = 1 and evidence_kind = 'NONE'`).get()).toEqual({ count: 20 });
      expect(repository.claim(
        'quota-owner', 'stale-run-20', 'stale-key-20', '20'.padStart(64, '0'),
        '2026-08-31T01:00:22.000Z',
      )).toBe(false);

      database.pragma('ignore_check_constraints = ON');
      database.prepare('insert into owners (singleton_key, id, username, password_hash, created_at) values (?, ?, ?, ?, ?)')
        .run(2, 'other-owner', 'other-owner', 'hash', '2026-08-31T00:00:00.000Z');
      repository.create({
        id: 'other-owner-stale-date', ownerId: 'other-owner', resourceId: 'other-owner-resource',
        capability: 'PUBLIC_LEARNING_SEARCH', operation: 'COURSE_RESOURCE_SEARCH', descriptor,
        status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T00:00:00.000Z',
      });
      repository.create({
        id: 'other-capability-stale-date', ownerId: 'quota-owner', resourceId: 'other-capability-resource',
        capability: 'LEARNING_TEXT_ANALYSIS', operation: 'LEARNING_ADVICE_GENERATE',
        descriptor: { ...descriptor, capability: 'LEARNING_TEXT_ANALYSIS' },
        status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T00:00:00.000Z',
      });
      repository.create({
        id: 'other-date-stale-date', ownerId: 'quota-owner', resourceId: 'other-date-resource',
        capability: 'PUBLIC_LEARNING_SEARCH', operation: 'COURSE_RESOURCE_SEARCH', descriptor,
        status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T00:00:00.000Z',
      });
      expect(repository.claim('other-owner', 'other-owner-stale-date', 'other-owner-stale-key', 'a'.repeat(64), '2026-08-31T01:00:22.000Z')).toBe(true);
      expect(repository.claim('quota-owner', 'other-capability-stale-date', 'other-capability-stale-key', 'b'.repeat(64), '2026-08-31T01:00:22.000Z')).toBe(true);
      expect(repository.claim('quota-owner', 'other-date-stale-date', 'other-date-stale-key', 'c'.repeat(64), '2026-09-01T01:00:22.000Z')).toBe(true);

      repository.create({
        id: 'completed-zero-call', ownerId: 'quota-owner', resourceId: 'completed-zero-resource',
        capability: 'PUBLIC_LEARNING_SEARCH', operation: 'COURSE_RESOURCE_SEARCH', descriptor,
        status: 'AWAITING_DISCLOSURE', createdAt: '2026-09-02T00:00:00.000Z',
      });
      expect(repository.claim('quota-owner', 'completed-zero-call', 'completed-zero-key', 'd'.repeat(64), '2026-09-02T01:00:00.000Z')).toBe(true);
      const zeroCallRun = repository.findByOwnerAndId('quota-owner', 'completed-zero-call');
      expect(repository.complete('quota-owner', 'completed-zero-call', {
        leaseToken: zeroCallRun!.leaseToken!, status: 'FAILED', actualCalls: 0, inputChars: 0, outputChars: 0,
        failureCode: 'CAPABILITY_INPUT_LIMIT_EXCEEDED', evidenceKind: 'REAL_PROVIDER', now: '2026-09-02T01:00:01.000Z',
      })).toBe(true);
      const completedBeforeSweep = database.prepare('select status, reserved_calls, actual_calls, evidence_kind, version from external_capability_runs where id = ?')
        .get('completed-zero-call');
      expect(completedBeforeSweep).toEqual({ status: 'FAILED', reserved_calls: 0, actual_calls: 0, evidence_kind: 'NONE', version: 3 });
      expect(repository.sweepExpired('2026-09-03T00:00:00.000Z')).toBe(3);
      expect(database.prepare('select status, reserved_calls, actual_calls, evidence_kind, version from external_capability_runs where id = ?').get('completed-zero-call'))
        .toEqual(completedBeforeSweep);
    } finally {
      database.close();
    }
  });

  it('persists NONE before a Fake succeeds', () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database);
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run('quota-owner', 'quota-owner', 'hash', '2026-08-31T00:00:00.000Z');
      const repository = createCapabilityRunRepository(database);
      const fakeDescriptor = {
        capability: 'PUBLIC_LEARNING_SEARCH' as const,
        providerId: 'fake-search', providerLabel: 'Fake Search', adapterKind: 'TEST_FAKE' as const,
        evidenceKind: 'AUTOMATED_FAKE' as const, availability: 'READY' as const,
      };
      repository.create({
        id: 'fake-run', ownerId: 'quota-owner', resourceId: 'fake-resource',
        capability: 'PUBLIC_LEARNING_SEARCH', operation: 'COURSE_RESOURCE_SEARCH', descriptor: fakeDescriptor,
        status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T01:00:00.000Z',
      });
      expect(database.prepare('select distinct evidence_kind from external_capability_runs').all())
        .toEqual([{ evidence_kind: 'NONE' }]);
      expect(repository.claim('quota-owner', 'fake-run', 'fake-success-key', 'a'.repeat(64), '2026-08-31T01:01:00.000Z')).toBe(true);
      expect(database.prepare('select status, evidence_kind from external_capability_runs where id = ?').get('fake-run'))
        .toEqual({ status: 'RUNNING', evidence_kind: 'NONE' });
      const running = repository.findByOwnerAndId('quota-owner', 'fake-run');
      expect(running?.leaseToken).toEqual(expect.any(String));
      expect(repository.complete('quota-owner', 'fake-run', {
        leaseToken: running!.leaseToken!, status: 'SUCCEEDED', actualCalls: 1, inputChars: 10, outputChars: 20,
        failureCode: null, evidenceKind: 'AUTOMATED_FAKE', now: '2026-08-31T01:02:00.000Z',
      })).toBe(true);
      expect(database.prepare('select status, reserved_calls, actual_calls, evidence_kind from external_capability_runs where id = ?').get('fake-run'))
        .toEqual({ status: 'SUCCEEDED', reserved_calls: 1, actual_calls: 1, evidence_kind: 'AUTOMATED_FAKE' });
    } finally {
      database.close();
    }
  });

  it('reserves quota by the Shanghai claim date instead of the run creation date', () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database);
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run('quota-owner', 'quota-owner', 'hash', '2026-08-31T00:00:00.000Z');
      const repository = createCapabilityRunRepository(database);
      const descriptor = {
        capability: 'PUBLIC_LEARNING_SEARCH' as const,
        providerId: 'controlled-search', providerLabel: 'Controlled Search', adapterKind: 'PRODUCTION_ADAPTER' as const,
        evidenceKind: 'NONE' as const, availability: 'READY' as const,
      };
      for (let index = 0; index < 20; index += 1) {
        repository.create({
          id: `august-run-${index}`, ownerId: 'quota-owner', resourceId: `august-resource-${index}`,
          capability: 'PUBLIC_LEARNING_SEARCH', operation: 'COURSE_RESOURCE_SEARCH', descriptor,
          status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T01:00:00.000Z',
        });
      }
      for (let index = 0; index < 20; index += 1) {
        expect(repository.claim('quota-owner', `august-run-${index}`, `august-key-${index}`, `${index}`.padStart(64, '0'), '2026-08-31T01:01:00.000Z')).toBe(true);
      }

      for (let index = 0; index < 21; index += 1) {
        repository.create({
          id: `september-run-${index}`, ownerId: 'quota-owner', resourceId: `september-resource-${index}`,
          capability: 'PUBLIC_LEARNING_SEARCH', operation: 'COURSE_RESOURCE_SEARCH', descriptor,
          status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T02:00:00.000Z',
        });
      }
      for (let index = 0; index < 20; index += 1) {
        expect(repository.claim('quota-owner', `september-run-${index}`, `september-key-${index}`, `${index + 20}`.padStart(64, '0'), '2026-09-01T01:01:00.000Z')).toBe(true);
      }
      expect(database.prepare('select local_date from external_capability_runs where id = ?').get('september-run-0'))
        .toEqual({ local_date: '2026-09-01' });
      expect(repository.claim('quota-owner', 'september-run-20', 'september-key-20', '40'.padStart(64, '0'), '2026-09-01T01:01:00.000Z')).toBe(false);
      expect(database.prepare('select status, idempotency_key, reserved_calls from external_capability_runs where id = ?').get('september-run-20'))
        .toEqual({ status: 'AWAITING_DISCLOSURE', idempotency_key: null, reserved_calls: 0 });

      database.pragma('ignore_check_constraints = ON');
      database.prepare('insert into owners (singleton_key, id, username, password_hash, created_at) values (?, ?, ?, ?, ?)')
        .run(2, 'other-owner', 'other-owner', 'hash', '2026-08-31T00:00:00.000Z');
      repository.create({
        id: 'other-owner-run', ownerId: 'other-owner', resourceId: 'other-owner-resource',
        capability: 'PUBLIC_LEARNING_SEARCH', operation: 'COURSE_RESOURCE_SEARCH', descriptor,
        status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T01:00:00.000Z',
      });
      repository.create({
        id: 'other-capability-run', ownerId: 'quota-owner', resourceId: 'other-capability-resource',
        capability: 'LEARNING_TEXT_ANALYSIS', operation: 'LEARNING_ADVICE_GENERATE',
        descriptor: { ...descriptor, capability: 'LEARNING_TEXT_ANALYSIS' },
        status: 'AWAITING_DISCLOSURE', createdAt: '2026-08-31T01:00:00.000Z',
      });
      expect(repository.claim('other-owner', 'other-owner-run', 'other-owner-key', 'b'.repeat(64), '2026-09-01T01:01:00.000Z')).toBe(true);
      expect(repository.claim('quota-owner', 'other-capability-run', 'other-capability-key', 'd'.repeat(64), '2026-09-01T01:01:00.000Z')).toBe(true);
    } finally {
      database.close();
    }
  });

  it.each([
    ['Vision', CAPABILITY_POLICY.vision.totalTimeoutMs, CAPABILITY_POLICY.vision.maxOutputChars],
    ['Public Search', CAPABILITY_POLICY.publicSearch.totalTimeoutMs, CAPABILITY_POLICY.publicSearch.maxOutputChars],
    ['Learning Advice', CAPABILITY_POLICY.learningAdvice.totalTimeoutMs, CAPABILITY_POLICY.learningAdvice.maxOutputChars],
  ])('bounds the %s object-adapter port by its frozen timeout and output limit', async (_name, timeoutMs, maxOutputChars) => {
    vi.useFakeTimers();
    let timeoutError: unknown;
    const hanging = executeCapabilityAdapter({
      inputSize: 1, maxInputSize: 1, maxOutputChars, timeoutMs,
      invoke: () => new Promise<never>(() => undefined),
    }).catch((error: unknown) => { timeoutError = error; });
    await vi.advanceTimersByTimeAsync(timeoutMs);
    await hanging;
    expect(timeoutError).toMatchObject({ code: 'CAPABILITY_EXECUTION_TIMEOUT', providerCallStarted: true });
    vi.useRealTimers();

    await expect(executeCapabilityAdapter({
      inputSize: 1, maxInputSize: 1, maxOutputChars, timeoutMs,
      invoke: async () => 'x'.repeat(maxOutputChars + 1),
    })).rejects.toMatchObject({ code: 'CAPABILITY_OUTPUT_LIMIT_EXCEEDED', providerCallStarted: true });
  });
});
