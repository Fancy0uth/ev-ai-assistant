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
    expect(migrations).toEqual({ count: 2 });
    second.close();
  });

  it('enables WAL, foreign keys and a five-second busy timeout', () => {
    const database = openDatabase(join(testDirectory, 'app.sqlite'));

    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);

    database.close();
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
      expect(upgraded.prepare('select * from tasks where id = ?').get(task.id)).toEqual(task);
      expect(
        upgraded
          .prepare(
            "select name from sqlite_master where type = 'table' and name like 'agent_%' order by name",
          )
          .all(),
      ).toEqual([{ name: 'agent_messages' }, { name: 'agent_sessions' }]);
      expect(
        upgraded.prepare('select version, name from schema_migrations order by version').all(),
      ).toEqual([
        { version: 1, name: 'initial_core_schema' },
        { version: 2, name: 'add_agent_storage' },
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
        reopened.prepare('select count(*) as count from schema_migrations where version = 2').get(),
      ).toEqual({ count: 1 });
      expect(reopened.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      reopened.close();
    }
  });
});
