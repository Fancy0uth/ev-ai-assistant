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
`;

describe('migration 14 daily-plan storage', () => {
  let testDirectory: string;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-migrations-'));
  });

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true });
  });

  it('preserves a legacy Owner and Task while backfilling the owner schedule version', () => {
    const databasePath = join(testDirectory, 'legacy.sqlite');
    const owner = {
      singleton_key: 1,
      id: 'legacy-owner',
      username: 'legacy-owner',
      password_hash: 'legacy-hash',
      created_at: '2026-08-17T00:00:00.000Z',
    };
    const task = {
      id: 'legacy-task',
      owner_id: owner.id,
      title: 'Keep this legacy task',
      area: 'WORK',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      target_date: '2026-08-18',
      completed_at: null,
      version: 3,
      created_at: '2026-08-17T00:01:00.000Z',
      updated_at: '2026-08-17T00:02:00.000Z',
    };
    const legacy = new Database(databasePath);
    try {
      legacy.pragma('foreign_keys = ON');
      legacy.exec(`
        create table schema_migrations (
          version integer primary key,
          name text not null,
          applied_at text not null
        );
      `);
      legacy.exec(migration001FixtureSql);
      legacy
        .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
        .run(1, 'initial_core_schema', owner.created_at);
      legacy
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(owner.id, owner.username, owner.password_hash, owner.created_at);
      legacy
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
      legacy.close();
    }

    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select * from owners where id = ?').get(owner.id)).toEqual(owner);
      expect(database.prepare('select * from tasks where id = ?').get(task.id)).toEqual(task);
      expect(
        database.prepare('select version from schedule_versions where owner_id = ?').get(owner.id),
      ).toEqual({ version: 1 });
      expect(
        database.prepare('select version, name from schema_migrations where version = 14').get(),
      ).toEqual({ version: 14, name: 'add_daily_plan_proposals' });
    } finally {
      database.close();
    }
  });

  it('increments schedule versions once for Event, TimeRequest, and RECOVERY Signal changes only', () => {
    const database = openDatabase(':memory:');
    const timestamp = '2026-08-17T00:00:00.000Z';
    const ownerId = 'schedule-owner';
    const version = () =>
      database.prepare('select version from schedule_versions where owner_id = ?').get(ownerId) as {
        version: number;
      };

    try {
      database
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(ownerId, ownerId, 'hash', timestamp);
      expect(version()).toEqual({ version: 1 });

      database
        .prepare(
          `insert into events (
            id, owner_id, calendar_rule_id, title, kind, local_date, start_local_time,
            end_local_time, is_hard, status, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'version-event',
          ownerId,
          null,
          'Versioned event',
          'MEETING',
          '2026-08-18',
          '09:00',
          '10:00',
          1,
          'CONFIRMED',
          1,
          timestamp,
          timestamp,
        );
      expect(version()).toEqual({ version: 2 });
      database.prepare('update events set title = ? where id = ?').run('Updated event', 'version-event');
      expect(version()).toEqual({ version: 3 });
      database.prepare('delete from events where id = ?').run('version-event');
      expect(version()).toEqual({ version: 4 });

      database
        .prepare(
          `insert into time_requests (
            id, owner_id, source, title, target_date, duration_minutes, priority,
            earliest_start_local_time, latest_end_local_time, is_fixed, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'version-request',
          ownerId,
          'SCHEDULE_COORDINATOR',
          'Versioned request',
          '2026-08-18',
          30,
          'HIGH',
          null,
          null,
          0,
          1,
          timestamp,
          timestamp,
        );
      expect(version()).toEqual({ version: 5 });
      database.prepare('update time_requests set title = ? where id = ?').run('Updated request', 'version-request');
      expect(version()).toEqual({ version: 6 });
      database.prepare('delete from time_requests where id = ?').run('version-request');
      expect(version()).toEqual({ version: 7 });

      const signal = database.prepare(
        `insert into signals (
          id, owner_id, local_date, kind, value, source, version, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      signal.run('energy-signal', ownerId, '2026-08-18', 'ENERGY', 70, 'CHECK_IN', 1, timestamp, timestamp);
      database.prepare('update signals set value = ? where id = ?').run(80, 'energy-signal');
      database.prepare("update signals set kind = 'RECOVERY' where id = ?").run('energy-signal');
      expect(version()).toEqual({ version: 8 });
      database.prepare("update signals set kind = 'ENERGY' where id = ?").run('energy-signal');
      expect(version()).toEqual({ version: 9 });
      database.prepare('delete from signals where id = ?').run('energy-signal');
      expect(version()).toEqual({ version: 9 });

      signal.run('recovery-signal', ownerId, '2026-08-18', 'RECOVERY', 50, 'CHECK_IN', 1, timestamp, timestamp);
      expect(version()).toEqual({ version: 10 });
      database.prepare('update signals set value = ? where id = ?').run(60, 'recovery-signal');
      expect(version()).toEqual({ version: 11 });
      database.prepare('delete from signals where id = ?').run('recovery-signal');
      expect(version()).toEqual({ version: 12 });
    } finally {
      database.close();
    }
  });

  it('enforces daily-plan proposal data integrity and matching run ownership', () => {
    const database = openDatabase(':memory:');
    const timestamp = '2026-08-17T00:00:00.000Z';
    const proposal = [
      'matching-proposal',
      'proposal-owner',
      'matching-run',
      'DAILY_PLAN_V1',
      '2026-08-18',
      'PENDING_REVIEW',
      1,
      'A valid daily plan proposal',
      '[]',
      1,
      timestamp,
      timestamp,
    ];
    const insertProposal = database.prepare(
      `insert into daily_plan_proposals (
        id, owner_id, run_id, contract_version, local_date, status, base_schedule_version,
        summary, items_json, version, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    try {
      const insertOwner = database.prepare(
        'insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)',
      );
      insertOwner.run('proposal-owner', 'proposal-owner', 'hash', timestamp);
      database.pragma('ignore_check_constraints = ON');
      database
        .prepare(
          `insert into owners (singleton_key, id, username, password_hash, created_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(2, 'other-owner', 'other-owner', 'hash', timestamp);
      database.pragma('ignore_check_constraints = OFF');
      database
        .prepare(
          `insert into daily_plan_runs (
            id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
            proposal_id, failure_code, created_at, completed_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'matching-run',
          'proposal-owner',
          'DAILY_PLAN_V1',
          '2026-08-18',
          'MANUAL',
          'CONTEXT_READY',
          '{}',
          null,
          null,
          timestamp,
          null,
        );

      insertProposal.run(...proposal);
      for (const [id, status] of [
        ['partially-applied-proposal', 'PARTIALLY_APPLIED'],
        ['applied-proposal', 'APPLIED'],
        ['rejected-proposal', 'REJECTED'],
        ['stale-proposal', 'STALE'],
      ]) {
        insertProposal.run(id, ...proposal.slice(1, 5), status, ...proposal.slice(6));
      }
      expect(() => insertProposal.run('wrong-owner-proposal', 'other-owner', ...proposal.slice(2))).toThrow();
      expect(() => insertProposal.run('wrong-contract', ...proposal.slice(1, 3), 'DAILY_PLAN_V2', ...proposal.slice(4))).toThrow();
      expect(() => insertProposal.run('wrong-status', ...proposal.slice(1, 5), 'PENDING', ...proposal.slice(6))).toThrow();
      expect(() => insertProposal.run('zero-base-version', ...proposal.slice(1, 6), 0, ...proposal.slice(7))).toThrow();
      expect(() => insertProposal.run('blank-summary', ...proposal.slice(1, 7), '   ', ...proposal.slice(8))).toThrow();
      expect(() =>
        insertProposal.run('long-summary', ...proposal.slice(1, 7), 'a'.repeat(801), ...proposal.slice(8)),
      ).toThrow();
      expect(() => insertProposal.run('invalid-json', ...proposal.slice(1, 8), '{', ...proposal.slice(9))).toThrow();
      expect(() => insertProposal.run('zero-version', ...proposal.slice(1, 9), 0, ...proposal.slice(10))).toThrow();
    } finally {
      database.close();
    }
  });
});
