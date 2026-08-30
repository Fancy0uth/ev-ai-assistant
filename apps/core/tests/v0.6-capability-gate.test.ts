import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityRegistry } from '../src/modules/providers/capabilities';
import { createCapabilityRunRepository } from '../src/modules/providers/capability-run-repository';
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

  it('terminalizes an expired capability lease without calling a Provider', () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database);
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run('v06-owner', 'v06-owner', 'hash', '2026-08-31T00:00:00.000Z');
      database.prepare(`insert into external_capability_runs (
        id, owner_id, capability, operation, resource_id, provider_id, provider_label, adapter_kind,
        evidence_kind, disclosure_json, disclosure_version, status, lease_token, lease_expires_at,
        deadline_at, policy_version, local_date, reserved_calls, actual_calls, input_chars, output_chars,
        failure_code, app_version, created_at, updated_at, version
      ) values (?, ?, 'COURSE_SCHEDULE_VISION', 'COURSE_IMPORT_EXTRACT', 'resource', null, '未配置', 'NONE',
        'NONE', '{}', 'CAPABILITY_DISCLOSURE_V1', 'RUNNING', 'lease', '2026-08-31T00:00:00.000Z', null,
        'CAPABILITY_POLICY_V1', '2026-08-31', 1, 0, 0, 0, null, '0.5.0', ?, ?, 1)`)
        .run('expired-run', 'v06-owner', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');

      createCapabilityRunRepository(database).sweepExpired('2026-08-31T00:00:01.000Z');

      expect(database.prepare('select status, failure_code, actual_calls from external_capability_runs where id = ?').get('expired-run'))
        .toEqual({ status: 'FAILED', failure_code: 'CAPABILITY_EXECUTION_STALE', actual_calls: 0 });
    } finally {
      database.close();
    }
  });
});
