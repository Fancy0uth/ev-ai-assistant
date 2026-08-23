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

describe('daily-plan storage migrations', () => {
  let testDirectory: string;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-migrations-'));
  });

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true });
  });

  it('preserves a legacy Owner and Task while enforcing auditable daily-plan decisions', () => {
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
      expect(database.prepare('select * from tasks where id = ?').get(task.id)).toEqual({
        ...task,
        scheduling_duration_minutes: null,
        scheduling_earliest_start_local_time: null,
        scheduling_latest_end_local_time: null,
        scheduling_is_fixed: null,
      });
      expect(
        database.prepare('select version from schedule_versions where owner_id = ?').get(owner.id),
      ).toEqual({ version: 1 });

      const decisionTimestamp = '2026-08-18T00:00:00.000Z';
      const proposalId = 'legacy-proposal';
      const timeRequestId = 'legacy-time-request';
      const scheduledEventId = 'legacy-scheduled-event';
      const insertDecision = database.prepare(
        `insert into proposal_decisions (
          id, owner_id, proposal_id, proposal_item_id, time_request_id, decision,
          scheduled_event_id, actual_start_local_time, actual_end_local_time, rejection_reason, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      database
        .prepare(
          `insert into daily_plan_runs (
            id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
            proposal_id, failure_code, created_at, completed_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'legacy-run',
          owner.id,
          'DAILY_PLAN_V1',
          '2026-08-18',
          'MANUAL',
          'CONTEXT_READY',
          '{}',
          null,
          null,
          decisionTimestamp,
          null,
        );
      database
        .prepare(
          `insert into daily_plan_proposals (
            id, owner_id, run_id, contract_version, local_date, status, base_schedule_version,
            summary, items_json, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          proposalId,
          owner.id,
          'legacy-run',
          'DAILY_PLAN_V1',
          '2026-08-18',
          'PENDING_REVIEW',
          1,
          'Legacy decision proposal',
          '[]',
          1,
          decisionTimestamp,
          decisionTimestamp,
        );
      database
        .prepare(
          `insert into time_requests (
            id, owner_id, source, title, target_date, duration_minutes, priority,
            earliest_start_local_time, latest_end_local_time, is_fixed, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          timeRequestId,
          owner.id,
          'SCHEDULE_COORDINATOR',
          'Legacy time request',
          '2026-08-18',
          30,
          'HIGH',
          null,
          null,
          0,
          1,
          decisionTimestamp,
          decisionTimestamp,
        );
      database
        .prepare(
          `insert into events (
            id, owner_id, calendar_rule_id, title, kind, local_date, start_local_time,
            end_local_time, is_hard, status, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          scheduledEventId,
          owner.id,
          null,
          'Legacy scheduled event',
          'WORK_BLOCK',
          '2026-08-18',
          '09:00',
          '09:30',
          0,
          'CONFIRMED',
          1,
          decisionTimestamp,
          decisionTimestamp,
        );

      const decision = [
        'legacy-decision',
        owner.id,
        proposalId,
        'legacy-proposal-item',
        timeRequestId,
        'APPLY',
        scheduledEventId,
        '09:00',
        '09:30',
        null,
        decisionTimestamp,
      ];
      insertDecision.run(...decision);
      expect(database.prepare('select * from proposal_decisions where id = ?').get(decision[0])).toEqual({
        id: decision[0],
        owner_id: owner.id,
        proposal_id: proposalId,
        proposal_item_id: 'legacy-proposal-item',
        time_request_id: timeRequestId,
        decision: 'APPLY',
        scheduled_event_id: scheduledEventId,
        actual_start_local_time: '09:00',
        actual_end_local_time: '09:30',
        rejection_reason: null,
        created_at: decisionTimestamp,
      });
      expect(() =>
        insertDecision.run(
          'duplicate-item-decision',
          owner.id,
          proposalId,
          'legacy-proposal-item',
          timeRequestId,
          'APPLY',
          null,
          null,
          null,
          null,
          decisionTimestamp,
        ),
      ).toThrow();
      expect(() =>
        insertDecision.run(
          'unknown-proposal-decision',
          owner.id,
          'unknown-proposal',
          'unknown-proposal-item',
          timeRequestId,
          'REJECT',
          null,
          null,
          null,
          'No matching proposal',
          decisionTimestamp,
        ),
      ).toThrow();
      expect(() =>
        insertDecision.run(
          'unknown-request-decision',
          owner.id,
          proposalId,
          'unknown-request-item',
          'unknown-time-request',
          'REJECT',
          null,
          null,
          null,
          'No matching request',
          decisionTimestamp,
        ),
      ).toThrow();
      const rejectedDecision = [
        'rejected-decision',
        owner.id,
        proposalId,
        'rejected-proposal-item',
        timeRequestId,
        'REJECT',
        null,
        null,
        null,
        'Keep the existing plan',
        decisionTimestamp,
      ];
      insertDecision.run(...rejectedDecision);
      expect(
        database.prepare('select decision, rejection_reason from proposal_decisions where id = ?').get(rejectedDecision[0]),
      ).toEqual({ decision: 'REJECT', rejection_reason: 'Keep the existing plan' });
      expect(() =>
        insertDecision.run(
          'invalid-decision',
          owner.id,
          proposalId,
          'invalid-decision-item',
          timeRequestId,
          'INVALID',
          null,
          null,
          null,
          null,
          decisionTimestamp,
        ),
      ).toThrow();
      expect(() =>
        database.prepare('update proposal_decisions set decision = ? where id = ?').run('REJECT', decision[0]),
      ).toThrow('proposal decisions are immutable');
      expect(() => database.prepare('delete from proposal_decisions where id = ?').run(decision[0])).toThrow(
        'proposal decisions are immutable',
      );
      expect(() => database.prepare('delete from events where id = ?').run(scheduledEventId)).toThrow();
      expect(() => database.prepare('delete from time_requests where id = ?').run(timeRequestId)).toThrow();
      expect(() => database.prepare('delete from daily_plan_proposals where id = ?').run(proposalId)).toThrow();
      expect(() => database.prepare('delete from owners where id = ?').run(owner.id)).toThrow();
      expect(database.prepare('select * from proposal_decisions where id = ?').get(decision[0])).toEqual({
        id: decision[0],
        owner_id: owner.id,
        proposal_id: proposalId,
        proposal_item_id: 'legacy-proposal-item',
        time_request_id: timeRequestId,
        decision: 'APPLY',
        scheduled_event_id: scheduledEventId,
        actual_start_local_time: '09:00',
        actual_end_local_time: '09:30',
        rejection_reason: null,
        created_at: decisionTimestamp,
      });
      expect(
        database.prepare('select version, name from schema_migrations where version = 14').get(),
      ).toEqual({ version: 14, name: 'add_daily_plan_proposals' });
      expect(
        database.prepare('select version, name from schema_migrations where version = 15').get(),
      ).toEqual({ version: 15, name: 'add_daily_plan_decisions' });
      expect(
        database.prepare('select version, name from schema_migrations where version = 16').get(),
      ).toEqual({ version: 16, name: 'add_daily_plan_automatic_run_guard' });
      expect(
        database.prepare('select version, name from schema_migrations where version = 17').get(),
      ).toEqual({ version: 17, name: 'add_scheduling_lifecycle' });
    } finally {
      database.close();
    }
  });

  it('allows manual history but prevents two automatic runs for the same Owner and date', () => {
    const database = openDatabase(':memory:');
    const timestamp = '2026-08-18T00:00:00.000Z';
    const ownerId = 'automatic-run-owner';
    const insertRun = database.prepare(
      `insert into daily_plan_runs (
        id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
        proposal_id, failure_code, created_at, completed_at
      ) values (?, ?, 'DAILY_PLAN_V1', '2026-08-18', ?, 'CONTEXT_READY', '{}', null, null, ?, null)`,
    );

    try {
      database
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(ownerId, ownerId, 'hash', timestamp);
      insertRun.run('manual-run-one', ownerId, 'MANUAL', timestamp);
      insertRun.run('manual-run-two', ownerId, 'MANUAL', timestamp);
      insertRun.run('scheduled-run', ownerId, 'SCHEDULED_0700', timestamp);

      expect(() =>
        insertRun.run('recovery-run', ownerId, 'FIRST_VISIT_RECOVERY', timestamp),
      ).toThrow();
      expect(
        database.prepare('select count(*) as count from daily_plan_runs where owner_id = ?').get(ownerId),
      ).toEqual({ count: 3 });
      expect(
        database.prepare('select version, name from schema_migrations where version = 16').get(),
      ).toEqual({ version: 16, name: 'add_daily_plan_automatic_run_guard' });
    } finally {
      database.close();
    }
  });

  it('adds v17 lifecycle storage without rewriting v16 TimeRequest history', () => {
    const databasePath = join(testDirectory, 'v16.sqlite');
    const timestamp = '2026-08-23T00:00:00.000Z';
    const ownerId = 'v16-owner';
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
      legacy.exec(`
        create table time_requests (
          id text primary key,
          owner_id text not null references owners(id) on delete cascade,
          source text not null,
          title text not null,
          target_date text not null,
          duration_minutes integer not null,
          priority text not null,
          earliest_start_local_time text,
          latest_end_local_time text,
          is_fixed integer not null,
          version integer not null,
          created_at text not null,
          updated_at text not null
        );

        create table daily_plan_runs (
          id text primary key,
          owner_id text not null references owners(id) on delete cascade,
          contract_version text not null,
          local_date text not null,
          trigger text not null,
          status text not null,
          context_manifest_json text not null,
          proposal_id text,
          failure_code text,
          created_at text not null,
          completed_at text,
          unique (id, owner_id)
        );
      `);
      const addMigration = legacy.prepare(
        'insert into schema_migrations (version, name, applied_at) values (?, ?, ?)',
      );
      for (let version = 1; version <= 16; version += 1) {
        addMigration.run(version, `legacy-v${version}`, timestamp);
      }
      legacy
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(ownerId, ownerId, 'hash', timestamp);
      legacy
        .prepare(
          `insert into tasks (
            id, owner_id, title, area, priority, status, target_date, completed_at,
            version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'v16-task',
          ownerId,
          'Keep v16 task',
          'WORK',
          'HIGH',
          'OPEN',
          '2026-08-24',
          null,
          4,
          timestamp,
          timestamp,
        );
      legacy
        .prepare(
          `insert into time_requests (
            id, owner_id, source, title, target_date, duration_minutes, priority,
            earliest_start_local_time, latest_end_local_time, is_fixed, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'v16-request',
          ownerId,
          'PROJECT_AGENT',
          'Keep v16 request',
          '2026-08-24',
          45,
          'HIGH',
          '09:00',
          '11:00',
          0,
          2,
          timestamp,
          timestamp,
        );
      legacy
        .prepare(
          `insert into daily_plan_runs (
            id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
            proposal_id, failure_code, created_at, completed_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'v16-run',
          ownerId,
          'DAILY_PLAN_V1',
          '2026-08-24',
          'MANUAL',
          'CONTEXT_READY',
          '{}',
          null,
          null,
          timestamp,
          null,
        );
    } finally {
      legacy.close();
    }

    const database = openDatabase(databasePath);
    try {
      const taskColumns = database
        .prepare("select name from pragma_table_info('tasks') order by cid")
        .all() as Array<{ name: string }>;
      expect(taskColumns.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          'scheduling_duration_minutes',
          'scheduling_earliest_start_local_time',
          'scheduling_latest_end_local_time',
          'scheduling_is_fixed',
        ]),
      );
      expect(database.prepare('select * from tasks where id = ?').get('v16-task')).toMatchObject({
        id: 'v16-task',
        title: 'Keep v16 task',
        version: 4,
        scheduling_duration_minutes: null,
        scheduling_earliest_start_local_time: null,
        scheduling_latest_end_local_time: null,
        scheduling_is_fixed: null,
      });
      expect(
        database.prepare('select origin_kind, origin_id, origin_version, lifecycle_status, closed_at, closed_reason from time_requests where id = ?').get('v16-request'),
      ).toEqual({
        origin_kind: null,
        origin_id: null,
        origin_version: null,
        lifecycle_status: 'ACTIVE',
        closed_at: null,
        closed_reason: null,
      });

      const insertTimeRequest = database.prepare(
        `insert into time_requests (
          id, owner_id, source, title, target_date, duration_minutes, priority,
          earliest_start_local_time, latest_end_local_time, is_fixed, version, created_at, updated_at,
          origin_kind, origin_id, origin_version, lifecycle_status, closed_at, closed_reason
        ) values (?, ?, 'PROJECT_AGENT', 'Lifecycle request', '2026-08-24', 45, 'HIGH', null, null, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertTimeRequest.run(
        'active-origin-request',
        ownerId,
        timestamp,
        timestamp,
        'TASK',
        '33333333-3333-4333-8333-333333333333',
        1,
        'ACTIVE',
        null,
        null,
      );
      expect(() =>
        insertTimeRequest.run(
          'duplicate-active-origin-request',
          ownerId,
          timestamp,
          timestamp,
          'TASK',
          '33333333-3333-4333-8333-333333333333',
          2,
          'ACTIVE',
          null,
          null,
        ),
      ).toThrow();
      expect(() =>
        insertTimeRequest.run(
          'partial-origin-request',
          ownerId,
          timestamp,
          timestamp,
          'TASK',
          null,
          null,
          'ACTIVE',
          null,
          null,
        ),
      ).toThrow();
      expect(() =>
        insertTimeRequest.run(
          'active-with-closure-request',
          ownerId,
          timestamp,
          timestamp,
          null,
          null,
          null,
          'ACTIVE',
          timestamp,
          'CANCELLED',
        ),
      ).toThrow();
      database
        .prepare(
          "update time_requests set lifecycle_status = 'CLOSED', closed_at = ?, closed_reason = 'COMPLETED' where id = ?",
        )
        .run(timestamp, 'active-origin-request');
      insertTimeRequest.run(
        'replacement-active-origin-request',
        ownerId,
        timestamp,
        timestamp,
        'TASK',
        '33333333-3333-4333-8333-333333333333',
        3,
        'ACTIVE',
        null,
        null,
      );

      database
        .prepare(
          `insert into daily_plan_preflights (
            id, owner_id, run_id, contract_version, local_date, status, base_schedule_version,
            items_json, version, created_at, updated_at, approved_at, claimed_at, consumed_at
          ) values (?, ?, ?, 'DAILY_PLAN_PREFLIGHT_V1', '2026-08-24', 'AWAITING_APPROVAL', 1, '[]', 1, ?, ?, null, null, null)`,
        )
        .run('v17-preflight', ownerId, 'v16-run', timestamp, timestamp);
      expect(database.prepare('select id, status from daily_plan_preflights where id = ?').get('v17-preflight')).toEqual({
        id: 'v17-preflight',
        status: 'AWAITING_APPROVAL',
      });
      expect(
        database.prepare('select version, name from schema_migrations where version = 17').get(),
      ).toEqual({ version: 17, name: 'add_scheduling_lifecycle' });
    } finally {
      database.close();
    }
  });

  it('preserves v2 agent-session data while upgrading through v17', () => {
    const databasePath = join(testDirectory, 'v2.sqlite');
    const timestamp = '2026-08-23T00:00:00.000Z';
    const ownerId = 'v2-owner';
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
      legacy.exec(`
        create table agent_sessions (
          id text not null primary key,
          owner_id text not null references owners(id) on delete cascade,
          title text not null,
          created_at text not null,
          updated_at text not null
        );
      `);
      legacy
        .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
        .run(1, 'initial_core_schema', timestamp);
      legacy
        .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
        .run(2, 'add_agent_storage', timestamp);
      legacy
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(ownerId, ownerId, 'hash', timestamp);
      legacy
        .prepare(
          'insert into agent_sessions (id, owner_id, title, created_at, updated_at) values (?, ?, ?, ?, ?)',
        )
        .run('v2-agent-session', ownerId, 'Keep v2 session', timestamp, timestamp);
    } finally {
      legacy.close();
    }

    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select * from agent_sessions where id = ?').get('v2-agent-session')).toEqual({
        id: 'v2-agent-session',
        owner_id: ownerId,
        title: 'Keep v2 session',
        created_at: timestamp,
        updated_at: timestamp,
      });
      expect(
        database.prepare('select version, name from schema_migrations where version = 17').get(),
      ).toEqual({ version: 17, name: 'add_scheduling_lifecycle' });
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

  it('invalidates both owners on Event, TimeRequest, and RECOVERY Signal transfers', () => {
    const database = openDatabase(':memory:');
    const timestamp = '2026-08-17T00:00:00.000Z';
    const sourceOwnerId = 'source-owner';
    const targetOwnerId = 'target-owner';
    const version = (ownerId: string) =>
      database.prepare('select version from schedule_versions where owner_id = ?').get(ownerId) as {
        version: number;
      };

    try {
      database
        .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(sourceOwnerId, sourceOwnerId, 'hash', timestamp);
      database.pragma('ignore_check_constraints = ON');
      database
        .prepare(
          `insert into owners (singleton_key, id, username, password_hash, created_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(2, targetOwnerId, targetOwnerId, 'hash', timestamp);
      database.pragma('ignore_check_constraints = OFF');
      expect(version(sourceOwnerId)).toEqual({ version: 1 });
      expect(version(targetOwnerId)).toEqual({ version: 1 });

      database
        .prepare(
          `insert into events (
            id, owner_id, calendar_rule_id, title, kind, local_date, start_local_time,
            end_local_time, is_hard, status, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'transferred-event',
          sourceOwnerId,
          null,
          'Transferred event',
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
      database.prepare('update events set owner_id = ? where id = ?').run(targetOwnerId, 'transferred-event');
      expect(version(sourceOwnerId)).toEqual({ version: 3 });
      expect(version(targetOwnerId)).toEqual({ version: 2 });
      database.prepare('update events set title = ? where id = ?').run('Moved event', 'transferred-event');
      expect(version(targetOwnerId)).toEqual({ version: 3 });
      database.prepare('delete from events where id = ?').run('transferred-event');
      expect(version(targetOwnerId)).toEqual({ version: 4 });

      database
        .prepare(
          `insert into time_requests (
            id, owner_id, source, title, target_date, duration_minutes, priority,
            earliest_start_local_time, latest_end_local_time, is_fixed, version, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'transferred-request',
          sourceOwnerId,
          'SCHEDULE_COORDINATOR',
          'Transferred request',
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
      database
        .prepare('update time_requests set owner_id = ? where id = ?')
        .run(targetOwnerId, 'transferred-request');
      expect(version(sourceOwnerId)).toEqual({ version: 5 });
      expect(version(targetOwnerId)).toEqual({ version: 5 });
      database.prepare('update time_requests set title = ? where id = ?').run('Moved request', 'transferred-request');
      expect(version(targetOwnerId)).toEqual({ version: 6 });
      database.prepare('delete from time_requests where id = ?').run('transferred-request');
      expect(version(targetOwnerId)).toEqual({ version: 7 });

      const insertSignal = database.prepare(
        `insert into signals (
          id, owner_id, local_date, kind, value, source, version, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertSignal.run(
        'transferred-recovery-signal',
        sourceOwnerId,
        '2026-08-18',
        'RECOVERY',
        50,
        'CHECK_IN',
        1,
        timestamp,
        timestamp,
      );
      database
        .prepare('update signals set owner_id = ? where id = ?')
        .run(targetOwnerId, 'transferred-recovery-signal');
      expect(version(sourceOwnerId)).toEqual({ version: 7 });
      expect(version(targetOwnerId)).toEqual({ version: 8 });
      database.prepare('update signals set value = ? where id = ?').run(60, 'transferred-recovery-signal');
      expect(version(targetOwnerId)).toEqual({ version: 9 });
      database.prepare('delete from signals where id = ?').run('transferred-recovery-signal');
      expect(version(targetOwnerId)).toEqual({ version: 10 });

      insertSignal.run(
        'transferred-energy-signal',
        sourceOwnerId,
        '2026-08-18',
        'ENERGY',
        70,
        'CHECK_IN',
        1,
        timestamp,
        timestamp,
      );
      database
        .prepare('update signals set owner_id = ? where id = ?')
        .run(targetOwnerId, 'transferred-energy-signal');
      expect(version(sourceOwnerId)).toEqual({ version: 7 });
      expect(version(targetOwnerId)).toEqual({ version: 10 });
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
