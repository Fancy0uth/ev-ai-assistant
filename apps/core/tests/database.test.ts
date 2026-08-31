import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/database';

const migration001FixtureSql = `
      create table owners (
        singleton_key integer primary key default 1 check (singleton_key = 1),
        id text not null unique,
        username text not null collate nocase unique
          check (length(trim(username)) between 3 and 32),
        password_hash text not null,
        created_at text not null
      );

      create table sessions (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        token_hash text not null unique,
        expires_at text not null,
        created_at text not null
      );

      create index sessions_owner_id_idx on sessions(owner_id);
      create index sessions_expires_at_idx on sessions(expires_at);

      create table tasks (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        title text not null check (length(trim(title)) between 1 and 200),
        area text not null check (area in ('WORK', 'STUDY', 'LIFE')),
        priority text not null check (priority in ('LOW', 'MEDIUM', 'HIGH')),
        status text not null check (
          status in ('OPEN', 'IN_PROGRESS', 'DONE', 'DEFERRED', 'CANCELLED')
        ),
        target_date text,
        completed_at text,
        version integer not null default 1 check (version >= 1),
        created_at text not null,
        updated_at text not null
      );

      create index tasks_owner_target_date_idx on tasks(owner_id, target_date);
      create index tasks_owner_status_idx on tasks(owner_id, status);
    `;

const migration002FixtureSql = `
      create table agent_sessions (
        id text not null primary key,
        owner_id text not null references owners(id) on delete cascade,
        title text not null check (
          length(title) between 1 and 80
          and length(trim(title)) > 0
        ),
        created_at text not null,
        updated_at text not null
      );

      create index agent_sessions_owner_updated_at_idx on agent_sessions(owner_id, updated_at);

      create table agent_messages (
        id text not null primary key,
        session_id text not null references agent_sessions(id) on delete cascade,
        role text not null check (role in ('USER', 'ASSISTANT')),
        content text not null check (
          length(content) between 1 and 8000
          and length(trim(content)) > 0
        ),
        created_at text not null
      );

      create index agent_messages_session_created_at_id_idx
        on agent_messages(session_id, created_at, id);
    `;

describe('SQLite lifecycle', () => {
  let testDirectory: string;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-db-'));
  });

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true });
  });

  it('applies current schema migrations once and persists data across reopen', () => {
    const databasePath = join(testDirectory, 'app.sqlite');
    const first = openDatabase(databasePath);
    first
      .prepare(
        'insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)',
      )
      .run('owner-1', 'codex', 'hash', '2026-08-07T00:00:00.000Z');
    first.close();

    const second = openDatabase(databasePath);
    const owner = second.prepare('select username from owners where id = ?').get('owner-1');
    const migrations = second.prepare('select count(*) as count from schema_migrations').get();

    expect(owner).toEqual({ username: 'codex' });
    expect(migrations).toEqual({ count: 20 });
    second.close();
  });

  it('enables WAL, foreign keys and a five-second busy timeout', () => {
    const database = openDatabase(join(testDirectory, 'app.sqlite'));

    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);

    database.close();
  });

  it('requires a real Owner for an encrypted DeepSeek credential row', () => {
    const database = openDatabase(':memory:');
    try {
      expect(() =>
        database
          .prepare(
            `insert into provider_credentials (
               owner_id, provider_key, protected_value, version, created_at, updated_at
             ) values (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'owner-b',
            'DEEPSEEK',
            'not-a-real-key',
            1,
            '2026-08-17T05:30:00.000Z',
            '2026-08-17T05:30:00.000Z',
          ),
      ).toThrow();

      database
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run('owner-a', 'owner-a', 'not-used', '2026-08-17T05:30:00.000Z');
      database
        .prepare(
          `insert into provider_credentials (
             owner_id, provider_key, protected_value, version, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'owner-a',
          'DEEPSEEK',
          'not-a-real-key',
          1,
          '2026-08-17T05:30:00.000Z',
          '2026-08-17T05:30:00.000Z',
        );

      expect(
        database.prepare('select owner_id, provider_key from provider_credentials').all(),
      ).toEqual([{ owner_id: 'owner-a', provider_key: 'DEEPSEEK' }]);
    } finally {
      database.close();
    }
  });

  it('enforces daily plan run lifecycle, JSON and owner constraints', () => {
    const database = openDatabase(':memory:');
    const createdAt = '2026-08-18T00:00:00.000Z';
    try {
      database
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run('daily-plan-owner', 'daily-plan-owner', 'not-used', createdAt);
      const insert = database.prepare(
        `insert into daily_plan_runs (
           id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
           proposal_id, failure_code, created_at, completed_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const valid = [
        'daily-plan-run-ready',
        'daily-plan-owner',
        'DAILY_PLAN_V1',
        '2026-08-18',
        'MANUAL',
        'CONTEXT_READY',
        '{"purpose":"DAILY_PLAN_GENERATION"}',
        null,
        null,
        createdAt,
        null,
      ];

      insert.run(...valid);
      expect(() => insert.run('bad-json', ...valid.slice(1, 6), '{not-json}', ...valid.slice(7))).toThrow();
      expect(() =>
        insert.run('bad-contract-version', ...valid.slice(1, 2), 'DAILY_PLAN_V2', ...valid.slice(3)),
      ).toThrow();
      expect(() =>
        insert.run('bad-trigger', ...valid.slice(1, 4), 'AUTOMATIC', ...valid.slice(5)),
      ).toThrow();
      expect(() =>
        insert.run('bad-status', ...valid.slice(1, 5), 'PENDING', ...valid.slice(6)),
      ).toThrow();
      expect(() =>
        insert.run(
          'missing-proposal',
          ...valid.slice(1, 5),
          'SUCCEEDED',
          valid[6],
          null,
          null,
          createdAt,
          '2026-08-18T01:00:00.000Z',
        ),
      ).toThrow();
      expect(() =>
        insert.run(
          'success-with-failure',
          ...valid.slice(1, 5),
          'SUCCEEDED',
          valid[6],
          'reserved-proposal-id',
          'DAILY_PLAN_PROVIDER_UNAVAILABLE',
          createdAt,
          '2026-08-18T01:00:00.000Z',
        ),
      ).toThrow();
      expect(() =>
        insert.run(
          'failed-with-unknown-code',
          ...valid.slice(1, 5),
          'FAILED',
          valid[6],
          null,
          'UNKNOWN',
          createdAt,
          '2026-08-18T01:00:00.000Z',
        ),
      ).toThrow();
      expect(() =>
        insert.run(
          'non-terminal-completed',
          ...valid.slice(1, 6),
          valid[6],
          null,
          null,
          createdAt,
          '2026-08-18T01:00:00.000Z',
        ),
      ).toThrow();
      expect(() =>
        insert.run(
          'completed-before-created',
          ...valid.slice(1, 5),
          'FAILED',
          valid[6],
          null,
          'DAILY_PLAN_PROVIDER_UNAVAILABLE',
          createdAt,
          '2026-08-17T23:59:59.000Z',
        ),
      ).toThrow();
      expect(() =>
        insert.run(
          'missing-owner',
          'no-owner',
          ...valid.slice(2),
        ),
      ).toThrow();

      insert.run(
        'succeeded-run',
        ...valid.slice(1, 5),
        'SUCCEEDED',
        valid[6],
        'reserved-proposal-id',
        null,
        createdAt,
        '2026-08-18T01:00:00.000Z',
      );
      insert.run(
        'failed-run',
        ...valid.slice(1, 5),
        'FAILED',
        valid[6],
        null,
        'DAILY_PLAN_PROVIDER_UNAVAILABLE',
        createdAt,
        '2026-08-18T01:00:00.000Z',
      );

      database.prepare('delete from owners where id = ?').run('daily-plan-owner');
      expect(database.prepare('select count(*) as count from daily_plan_runs').get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('upgrades a simulated v10 database to v11 without changing its Owner or Task', () => {
    const databasePath = join(testDirectory, 'v10.sqlite');
    const owner = {
      singleton_key: 1,
      id: 'owner-v10',
      username: 'owner-v10',
      password_hash: 'fixture-hash-v10',
      created_at: '2026-08-17T00:00:00.000Z',
    };
    const task = {
      id: 'task-v10',
      owner_id: owner.id,
      title: 'Preserve the v10 task',
      area: 'WORK',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      target_date: '2026-08-17',
      completed_at: null,
      version: 5,
      created_at: '2026-08-17T00:01:00.000Z',
      updated_at: '2026-08-17T00:02:00.000Z',
    };
    const v10 = openDatabase(databasePath);
    try {
      v10
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(owner.id, owner.username, owner.password_hash, owner.created_at);
      v10
        .prepare(
          `insert into tasks (
            id, owner_id, title, area, priority, status, target_date, completed_at,
            version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.owner_id,
          task.title,
          task.area,
          task.priority,
          task.status,
          task.target_date,
          task.completed_at,
          task.version,
          task.created_at,
          task.updated_at,
        );
      v10.exec('drop table provider_credentials');
      v10.prepare('delete from schema_migrations where version = ?').run(11);
    } finally {
      v10.close();
    }

    const upgraded = openDatabase(databasePath);
    try {
      expect(upgraded.prepare('select * from owners where id = ?').get(owner.id)).toEqual(owner);
      expect(upgraded.prepare('select * from tasks where id = ?').get(task.id)).toEqual({
        ...task,
        scheduling_duration_minutes: null,
        scheduling_earliest_start_local_time: null,
        scheduling_latest_end_local_time: null,
        scheduling_is_fixed: null,
      });
      expect(
        upgraded.prepare('select version, name from schema_migrations where version = 11').get(),
      ).toEqual({ version: 11, name: 'add_provider_credentials' });
      upgraded
        .prepare(
          `insert into provider_credentials (
            owner_id, provider_key, protected_value, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          owner.id,
          'DEEPSEEK',
          'opaque-v10-token',
          1,
          '2026-08-17T00:03:00.000Z',
          '2026-08-17T00:03:00.000Z',
        );
      expect(() =>
        upgraded
          .prepare(
            `insert into provider_credentials (
              owner_id, provider_key, protected_value, version, created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'missing-owner',
            'DEEPSEEK',
            'opaque-missing-owner-token',
            1,
            '2026-08-17T00:03:00.000Z',
            '2026-08-17T00:03:00.000Z',
          ),
      ).toThrow();
      expect(() =>
        upgraded
          .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
          .run('owner-v10-second', 'owner-v10-second', 'fixture-hash', owner.created_at),
      ).toThrow();
    } finally {
      upgraded.close();
    }
  });

  it('rejects agent session titles longer than the raw 80-character limit', () => {
    const database = openDatabase(join(testDirectory, 'app.sqlite'));
    try {
      database
        .prepare(
          'insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)',
        )
        .run('owner-raw-title-limit', 'raw-title-owner', 'hash', '2026-08-10T00:00:00.000Z');

      expect(() =>
        database
          .prepare(
            `insert into agent_sessions (id, owner_id, title, created_at, updated_at)
             values (?, ?, ?, ?, ?)`,
          )
          .run(
            'agent-session-raw-title-limit',
            'owner-raw-title-limit',
            `${'A'.repeat(80)} `,
            '2026-08-10T00:00:00.000Z',
            '2026-08-10T00:00:00.000Z',
          ),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('rejects agent message content longer than the raw 8000-character limit', () => {
    const database = openDatabase(join(testDirectory, 'app.sqlite'));
    try {
      database
        .prepare(
          'insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)',
        )
        .run('owner-raw-content-limit', 'raw-content-owner', 'hash', '2026-08-10T00:00:00.000Z');
      database
        .prepare(
          `insert into agent_sessions (id, owner_id, title, created_at, updated_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          'agent-session-raw-content-limit',
          'owner-raw-content-limit',
          'Valid session',
          '2026-08-10T00:00:00.000Z',
          '2026-08-10T00:00:00.000Z',
        );

      expect(() =>
        database
          .prepare(
            `insert into agent_messages (id, session_id, role, content, created_at)
             values (?, ?, ?, ?, ?)`,
          )
          .run(
            'agent-message-raw-content-limit',
            'agent-session-raw-content-limit',
            'USER',
            `${'A'.repeat(8000)} `,
            '2026-08-10T00:00:00.000Z',
          ),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('upgrades a frozen migration 001 database without changing old rows', () => {
    const databasePath = join(testDirectory, 'app.sqlite');
    const owner = {
      singleton_key: 1,
      id: 'owner-v1',
      username: 'fixture-owner',
      password_hash: '$argon2id$v=19$m=65536,t=3,p=1$fixture$hash',
      created_at: '2026-08-07T00:00:00.000Z',
    };
    const authSession = {
      id: 'auth-session-v1',
      owner_id: owner.id,
      token_hash: 'sha256:fixture-token-hash',
      expires_at: '2026-08-14T00:00:00.000Z',
      created_at: '2026-08-07T00:01:00.000Z',
    };
    const task = {
      id: 'task-v1',
      owner_id: owner.id,
      title: 'Preserve every original task field',
      area: 'STUDY',
      priority: 'HIGH',
      status: 'DONE',
      target_date: '2026-08-10',
      completed_at: '2026-08-10T08:30:00.000Z',
      version: 7,
      created_at: '2026-08-07T00:02:00.000Z',
      updated_at: '2026-08-10T08:30:00.000Z',
    };

    const versionOne = new Database(databasePath);
    try {
      versionOne.pragma('foreign_keys = ON');
      versionOne.exec(`
        create table schema_migrations (
          version integer primary key,
          name text not null,
          applied_at text not null
        );
      `);
      versionOne.exec(migration001FixtureSql);
      versionOne
        .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
        .run(1, 'initial_core_schema', '2026-08-07T00:00:00.000Z');
      versionOne
        .prepare(
          `insert into owners (id, username, password_hash, created_at)
           values (?, ?, ?, ?)`,
        )
        .run(owner.id, owner.username, owner.password_hash, owner.created_at);
      versionOne
        .prepare(
          `insert into sessions (id, owner_id, token_hash, expires_at, created_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          authSession.id,
          authSession.owner_id,
          authSession.token_hash,
          authSession.expires_at,
          authSession.created_at,
        );
      versionOne
        .prepare(
          `insert into tasks (
            id, owner_id, title, area, priority, status, target_date, completed_at,
            version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.owner_id,
          task.title,
          task.area,
          task.priority,
          task.status,
          task.target_date,
          task.completed_at,
          task.version,
          task.created_at,
          task.updated_at,
        );
    } finally {
      versionOne.close();
    }

    const upgraded = openDatabase(databasePath);
    try {
      expect(upgraded.prepare('select * from owners where id = ?').get(owner.id)).toEqual(owner);
      expect(upgraded.prepare('select * from sessions where id = ?').get(authSession.id)).toEqual(
        authSession,
      );
      expect(upgraded.prepare('select * from tasks where id = ?').get(task.id)).toEqual({
        ...task,
        scheduling_duration_minutes: null,
        scheduling_earliest_start_local_time: null,
        scheduling_latest_end_local_time: null,
        scheduling_is_fixed: null,
      });
      expect(
        upgraded
          .prepare(
            "select name from sqlite_master where type = 'table' and name like 'agent_%' order by name",
          )
          .all(),
      ).toEqual([
        { name: 'agent_messages' },
        { name: 'agent_runs' },
        { name: 'agent_sessions' },
      ]);
      expect(
        upgraded.prepare('select version, name from schema_migrations order by version').all(),
      ).toEqual([
        { version: 1, name: 'initial_core_schema' },
        { version: 2, name: 'add_agent_storage' },
        { version: 3, name: 'add_local_daily_console' },
        { version: 4, name: 'add_course_import_runs' },
        { version: 5, name: 'add_daily_planner_jobs' },
        { version: 6, name: 'add_agent_runs' },
        { version: 7, name: 'add_memory_revisions' },
        { version: 8, name: 'add_confirmed_meal_records' },
        { version: 9, name: 'add_course_resources' },
        { version: 10, name: 'add_read_only_project_scopes' },
        { version: 11, name: 'add_provider_credentials' },
        { version: 12, name: 'add_provider_connection_tests' },
        { version: 13, name: 'add_daily_plan_runs' },
        { version: 14, name: 'add_daily_plan_proposals' },
        { version: 15, name: 'add_daily_plan_decisions' },
        { version: 16, name: 'add_daily_plan_automatic_run_guard' },
        { version: 17, name: 'add_scheduling_lifecycle' },
        { version: 18, name: 'add_provider_reliability' },
        { version: 19, name: 'add_v06_learning_schedule_loop' },
        { version: 20, name: 'add_v07_fitness_nutrition_loop' },
      ]);
      expect(
        upgraded.prepare('select count(*) as count from schema_migrations where version = 2').get(),
      ).toEqual({ count: 1 });
      expect(upgraded.pragma('foreign_keys', { simple: true })).toBe(1);

      expect(() =>
        upgraded
          .prepare(
            `insert into agent_sessions (id, owner_id, title, created_at, updated_at)
             values (?, ?, ?, ?, ?)`,
          )
          .run(
            'invalid-agent-session',
            owner.id,
            '   ',
            '2026-08-10T09:00:00.000Z',
            '2026-08-10T09:00:00.000Z',
          ),
      ).toThrow();

      upgraded
        .prepare(
          `insert into agent_sessions (id, owner_id, title, created_at, updated_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          'agent-session-message-cascade',
          owner.id,
          'Delete this session',
          '2026-08-10T09:00:00.000Z',
          '2026-08-10T09:00:00.000Z',
        );
      expect(() =>
        upgraded
          .prepare(
            `insert into agent_messages (id, session_id, role, content, created_at)
             values (?, ?, ?, ?, ?)`,
          )
          .run(
            'invalid-agent-role',
            'agent-session-message-cascade',
            'SYSTEM',
            'Invalid role',
            '2026-08-10T09:01:00.000Z',
          ),
      ).toThrow();
      expect(() =>
        upgraded
          .prepare(
            `insert into agent_messages (id, session_id, role, content, created_at)
             values (?, ?, ?, ?, ?)`,
          )
          .run(
            'invalid-agent-content',
            'agent-session-message-cascade',
            'USER',
            '   ',
            '2026-08-10T09:01:00.000Z',
          ),
      ).toThrow();
      upgraded
        .prepare(
          `insert into agent_messages (id, session_id, role, content, created_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          'agent-message-session-cascade',
          'agent-session-message-cascade',
          'USER',
          'Delete this message with its session',
          '2026-08-10T09:01:00.000Z',
        );
      upgraded
        .prepare('delete from agent_sessions where id = ?')
        .run('agent-session-message-cascade');
      expect(
        upgraded.prepare('select count(*) as count from agent_messages').get(),
      ).toEqual({ count: 0 });

      upgraded
        .prepare(
          `insert into agent_sessions (id, owner_id, title, created_at, updated_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          'agent-session-owner-cascade',
          owner.id,
          'Delete this owner',
          '2026-08-10T09:02:00.000Z',
          '2026-08-10T09:02:00.000Z',
        );
      upgraded
        .prepare(
          `insert into agent_messages (id, session_id, role, content, created_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          'agent-message-owner-cascade',
          'agent-session-owner-cascade',
          'ASSISTANT',
          'Delete this message with its owner',
          '2026-08-10T09:03:00.000Z',
        );
      upgraded.prepare('delete from owners where id = ?').run(owner.id);
      expect(
        upgraded.prepare('select count(*) as count from agent_sessions').get(),
      ).toEqual({ count: 0 });
      expect(
        upgraded.prepare('select count(*) as count from agent_messages').get(),
      ).toEqual({ count: 0 });
    } finally {
      upgraded.close();
    }

    const reopened = openDatabase(databasePath);
    try {
      expect(
        reopened.prepare('select count(*) as count from schema_migrations where version = 9').get(),
      ).toEqual({ count: 1 });
      expect(reopened.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      reopened.close();
    }
  });

  it('upgrades a frozen migration 002 database while retaining Owner, Task and Agent rows', () => {
    const databasePath = join(testDirectory, 'app.sqlite');
    const fixture = new Database(databasePath);
    const owner = {
      singleton_key: 1,
      id: 'owner-v2',
      username: 'fixture-owner-v2',
      password_hash: 'fixture-hash-v2',
      created_at: '2026-08-10T00:00:00.000Z',
    };
    const task = {
      id: 'task-v2',
      owner_id: owner.id,
      title: 'Migration must preserve me',
      area: 'WORK',
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      target_date: '2026-08-17',
      completed_at: null,
      version: 4,
      created_at: '2026-08-10T00:01:00.000Z',
      updated_at: '2026-08-16T00:01:00.000Z',
    };
    const agentSession = {
      id: 'agent-session-v2',
      owner_id: owner.id,
      title: 'Keep my conversation',
      created_at: '2026-08-10T00:02:00.000Z',
      updated_at: '2026-08-10T00:02:00.000Z',
    };
    const agentMessage = {
      id: 'agent-message-v2',
      session_id: agentSession.id,
      role: 'USER',
      content: 'Keep my message',
      created_at: '2026-08-10T00:03:00.000Z',
    };

    try {
      fixture.pragma('foreign_keys = ON');
      fixture.exec(`
        create table schema_migrations (
          version integer primary key,
          name text not null,
          applied_at text not null
        );
      `);
      fixture.exec(migration001FixtureSql);
      fixture.exec(migration002FixtureSql);
      fixture
        .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
        .run(1, 'initial_core_schema', '2026-08-07T00:00:00.000Z');
      fixture
        .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
        .run(2, 'add_agent_storage', '2026-08-10T00:00:00.000Z');
      fixture
        .prepare(
          `insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)`,
        )
        .run(owner.id, owner.username, owner.password_hash, owner.created_at);
      fixture
        .prepare(
          `insert into tasks (
            id, owner_id, title, area, priority, status, target_date, completed_at,
            version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.owner_id,
          task.title,
          task.area,
          task.priority,
          task.status,
          task.target_date,
          task.completed_at,
          task.version,
          task.created_at,
          task.updated_at,
        );
      fixture
        .prepare(
          `insert into agent_sessions (id, owner_id, title, created_at, updated_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          agentSession.id,
          agentSession.owner_id,
          agentSession.title,
          agentSession.created_at,
          agentSession.updated_at,
        );
      fixture
        .prepare(
          `insert into agent_messages (id, session_id, role, content, created_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          agentMessage.id,
          agentMessage.session_id,
          agentMessage.role,
          agentMessage.content,
          agentMessage.created_at,
        );
    } finally {
      fixture.close();
    }

    const upgraded = openDatabase(databasePath);
    try {
      expect(upgraded.prepare('select * from owners where id = ?').get(owner.id)).toEqual(owner);
      expect(upgraded.prepare('select * from tasks where id = ?').get(task.id)).toEqual({
        ...task,
        scheduling_duration_minutes: null,
        scheduling_earliest_start_local_time: null,
        scheduling_latest_end_local_time: null,
        scheduling_is_fixed: null,
      });
      expect(
        upgraded.prepare('select * from agent_sessions where id = ?').get(agentSession.id),
      ).toEqual(agentSession);
      expect(
        upgraded.prepare('select * from agent_messages where id = ?').get(agentMessage.id),
      ).toEqual(agentMessage);
      expect(
        upgraded.prepare('select version, name from schema_migrations order by version').all(),
      ).toEqual([
        { version: 1, name: 'initial_core_schema' },
        { version: 2, name: 'add_agent_storage' },
        { version: 3, name: 'add_local_daily_console' },
        { version: 4, name: 'add_course_import_runs' },
        { version: 5, name: 'add_daily_planner_jobs' },
        { version: 6, name: 'add_agent_runs' },
        { version: 7, name: 'add_memory_revisions' },
        { version: 8, name: 'add_confirmed_meal_records' },
        { version: 9, name: 'add_course_resources' },
        { version: 10, name: 'add_read_only_project_scopes' },
        { version: 11, name: 'add_provider_credentials' },
        { version: 12, name: 'add_provider_connection_tests' },
        { version: 13, name: 'add_daily_plan_runs' },
        { version: 14, name: 'add_daily_plan_proposals' },
        { version: 15, name: 'add_daily_plan_decisions' },
        { version: 16, name: 'add_daily_plan_automatic_run_guard' },
        { version: 17, name: 'add_scheduling_lifecycle' },
        { version: 18, name: 'add_provider_reliability' },
        { version: 19, name: 'add_v06_learning_schedule_loop' },
        { version: 20, name: 'add_v07_fitness_nutrition_loop' },
      ]);
      expect(
        upgraded
          .prepare("select name from sqlite_master where type = 'table' and name = 'proposals'")
          .get(),
      ).toEqual({ name: 'proposals' });
    } finally {
      upgraded.close();
    }
  });
});
