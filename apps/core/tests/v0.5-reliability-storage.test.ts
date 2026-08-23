import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/storage/migrations';

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('v0.5 reliability storage migration', () => {
  it('upgrades v17 data additively and exposes no raw Provider payload columns', () => {
    const database = new Database(':memory:');
    databases.push(database);
    database.pragma('foreign_keys = ON');
    runMigrations(database, 17);

    const ownerId = 'v17-owner';
    const createdAt = '2026-08-23T00:00:00.000Z';
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'v17-owner', 'password-hash', createdAt);
    database
      .prepare(
        `insert into tasks (
          id, owner_id, title, area, priority, status, target_date, completed_at,
          version, created_at, updated_at
        ) values (?, ?, ?, 'WORK', 'HIGH', 'OPEN', ?, null, 1, ?, ?)`,
      )
      .run('v17-task', ownerId, 'Preserve Task', '2026-08-24', createdAt, createdAt);
    database
      .prepare(
        `insert into provider_credentials (
          owner_id, provider_key, protected_value, version, created_at, updated_at
        ) values (?, 'DEEPSEEK', ?, 1, ?, ?)`,
      )
      .run(ownerId, 'fixture-dpapi-reference', createdAt, createdAt);
    database
      .prepare(
        `insert into daily_plan_runs (
          id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
          proposal_id, failure_code, created_at, completed_at
        ) values (?, ?, 'DAILY_PLAN_V1', '2026-08-24', 'MANUAL', 'CONTEXT_READY', '{}', null, null, ?, null)`,
      )
      .run('v17-run', ownerId, createdAt);

    const before = {
      owner: database.prepare('select * from owners where id = ?').get(ownerId),
      task: database.prepare('select * from tasks where id = ?').get('v17-task'),
      credential: database
        .prepare('select * from provider_credentials where owner_id = ?')
        .get(ownerId),
      run: database
        .prepare('select id, owner_id, status, context_manifest_json from daily_plan_runs where id = ?')
        .get('v17-run'),
      runRootPage: database
        .prepare("select rootpage from sqlite_master where type = 'table' and name = 'daily_plan_runs'")
        .get(),
    };

    runMigrations(database);

    expect(
      database.prepare('select version, name from schema_migrations where version = 18').get(),
    ).toEqual({ version: 18, name: 'add_provider_reliability' });
    expect(database.prepare('select * from owners where id = ?').get(ownerId)).toEqual(before.owner);
    expect(database.prepare('select * from tasks where id = ?').get('v17-task')).toEqual(before.task);
    expect(
      database.prepare('select * from provider_credentials where owner_id = ?').get(ownerId),
    ).toEqual(before.credential);
    expect(
      database
        .prepare('select id, owner_id, status, context_manifest_json from daily_plan_runs where id = ?')
        .get('v17-run'),
    ).toEqual(before.run);
    expect(
      database.prepare('select app_version from daily_plan_runs where id = ?').get('v17-run'),
    ).toEqual({ app_version: null });
    expect(
      database
        .prepare("select rootpage from sqlite_master where type = 'table' and name = 'daily_plan_runs'")
        .get(),
    ).toEqual(before.runRootPage);

    database.prepare('update daily_plan_runs set app_version = ? where id = ?').run('0.5.0', 'v17-run');
    expect(
      database.prepare('select app_version from daily_plan_runs where id = ?').get('v17-run'),
    ).toEqual({ app_version: '0.5.0' });
    database.prepare('update daily_plan_runs set app_version = ? where id = ?').run('0.6.0', 'v17-run');
    expect(
      database.prepare('select app_version from daily_plan_runs where id = ?').get('v17-run'),
    ).toEqual({ app_version: '0.6.0' });

    expect(() =>
      database
        .prepare(
          `insert into provider_call_logs (
            id, owner_id, run_id, idempotency_record_id, provider, operation, model, attempt_no,
            status, failure_code, finish_reason, prompt_tokens, completion_tokens, total_tokens,
            input_chars, output_chars, policy_version, contract_version, app_version, local_date,
            started_at, finished_at, duration_ms
          ) values (?, ?, null, null, 'DEEPSEEK', 'daily_plan.generate', 'deepseek-v4-flash', 1,
            'SUCCEEDED', null, 'stop', 1, 1, 2, 10, 10,
            'PROVIDER_POLICY_V1', 'DAILY_PLAN_V1', ?, '2026-08-24', ?, ?, 1)`,
        )
        .run('v06-provider-call', ownerId, '0.6.0', createdAt, createdAt),
    ).not.toThrow();
    expect(
      database.prepare('select app_version from provider_call_logs where id = ?').get('v06-provider-call'),
    ).toEqual({ app_version: '0.6.0' });

    const runColumns = database
      .prepare('select name from pragma_table_info(\'daily_plan_runs\') order by cid')
      .all() as Array<{ name: string }>;
    expect(runColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'attempt_count',
        'lease_token',
        'lease_expires_at',
        'deadline_at',
        'terminal_reason',
        'app_version',
        'idempotency_record_id',
      ]),
    );

    const callLogColumns = database
      .prepare('select name from pragma_table_info(\'provider_call_logs\') order by cid')
      .all() as Array<{ name: string }>;
    expect(callLogColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'owner_id',
        'run_id',
        'idempotency_record_id',
        'provider',
        'model',
        'finish_reason',
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
        'app_version',
      ]),
    );
    expect(callLogColumns.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(['api_key', 'authorization', 'request_body', 'response_body', 'prompt']),
    );
  });
});
