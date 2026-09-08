import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/database';
import { runMigrations } from '../src/storage/migrations';

const directories: string[] = [];
const timestamp = '2026-09-01T00:00:00.000Z';
const hash = (character: string) => character.repeat(64);

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function insertOwners(database: Database.Database): void {
  database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('owner-a', 'owner-a', 'hash-a', timestamp);
  database.pragma('ignore_check_constraints = ON');
  database.prepare('insert into owners (singleton_key, id, username, password_hash, created_at) values (?, ?, ?, ?, ?)').run(2, 'owner-b', 'owner-b', 'hash-b', timestamp);
  database.pragma('ignore_check_constraints = OFF');
}

function seedV20Graph(database: Database.Database): void {
  insertOwners(database);
  for (const owner of ['a', 'b']) {
    const ownerId = `owner-${owner}`;
    database.prepare(`insert into signals (id, owner_id, local_date, kind, value, source, version, created_at, updated_at)
      values (?, ?, '2026-09-01', 'RECOVERY', 80, 'CHECK_IN', 1, ?, ?)`).run(`signal-${owner}`, ownerId, timestamp, timestamp);
    database.prepare(`insert into fitness_check_ins_v2 (
      id, owner_id, local_date, sleep_minutes, energy_level, discomfort_level, has_pain, acute_risk,
      signal_id, recovery_json, safety_json, policy_version, version, created_at
    ) values (?, ?, '2026-09-01', 480, 5, 0, 0, 0, ?, '{}', '{}', 'WORKOUT_SAFETY_V1', 1, ?)`)
      .run(`check-${owner}`, ownerId, `signal-${owner}`, timestamp);
    database.prepare(`insert into workouts_v2 (
      id, owner_id, check_in_id, signal_id, generation_mode, state, current_revision_id,
      proposal_id, action_id, time_request_id, feedback_id, version, created_at, updated_at
    ) values (?, ?, ?, ?, 'MANUAL', 'DRAFT', null, null, null, null, null, 1, ?, ?)`)
      .run(`workout-${owner}`, ownerId, `check-${owner}`, `signal-${owner}`, timestamp, timestamp);
    database.prepare(`insert into proposals (id, owner_id, kind, status, source, title, changes_json, version, created_at, expires_at, decided_at)
      values (?, ?, 'WORKOUT', 'PENDING', 'FITNESS_AGENT', ?, '[]', 1, ?, null, null)`)
      .run(`proposal-${owner}`, ownerId, `Proposal ${owner}`, timestamp);
    database.prepare(`insert into actions (id, owner_id, event_id, title, kind, status, target_date, version, created_at, updated_at)
      values (?, ?, null, ?, 'FITNESS', 'OPEN', '2026-09-01', 1, ?, ?)`)
      .run(`action-${owner}`, ownerId, `Action ${owner}`, timestamp, timestamp);
    database.prepare(`insert into time_requests (
      id, owner_id, source, title, target_date, duration_minutes, priority,
      earliest_start_local_time, latest_end_local_time, is_fixed, version, created_at, updated_at
    ) values (?, ?, 'FITNESS_AGENT', ?, '2026-09-01', 30, 'MEDIUM', null, null, 0, 1, ?, ?)`)
      .run(`time-${owner}`, ownerId, `Time ${owner}`, timestamp, timestamp);
    database.prepare(`insert into activity_sessions (
      id, owner_id, action_id, kind, started_at, ended_at, summary, version, created_at, updated_at
    ) values (?, ?, ?, 'WORKOUT', ?, '2026-09-01T00:30:00.000Z', 'Synthetic', 1, ?, ?)`)
      .run(`activity-${owner}`, ownerId, `action-${owner}`, timestamp, timestamp, timestamp);
    database.prepare(`insert into v07_capability_runs (
      id, owner_id, capability, operation, resource_id, provider_id, provider_label, adapter_kind,
      evidence_kind, disclosure_json, disclosure_version, state, policy_version, local_date,
      app_version, created_at, updated_at, version
    ) values (?, ?, 'WORKOUT_TEXT_SELECTION', 'fixture', ?, null, 'Not configured', 'NONE',
      'NONE', '{}', 'HEALTH_DISCLOSURE_V1', 'BLOCKED_PROVIDER', 'HEALTH_CAPABILITY_POLICY_V1',
      '2026-09-01', '0.7.0', ?, ?, 1)`)
      .run(`run-${owner}`, ownerId, `workout-${owner}`, timestamp, timestamp);
    database.prepare(`insert into workout_revisions_v2 (
      id, owner_id, workout_id, parent_revision_id, revision_no, title, rationale, plan_json,
      catalog_id, catalog_version, catalog_hash, content_hash, created_by, capability_run_id, created_at
    ) values (?, ?, ?, null, 1, ?, 'Synthetic', '{}', 'ev-ai-internal-starter', '2026.08.31.1', ?, ?, 'MODEL', ?, ?)`)
      .run(`workout-revision-${owner}`, ownerId, `workout-${owner}`, `Workout ${owner}`, hash(owner), hash(owner === 'a' ? 'c' : 'd'), `run-${owner}`, timestamp);
    database.prepare('update workouts_v2 set current_revision_id = ? where id = ?').run(`workout-revision-${owner}`, `workout-${owner}`);
    if (owner === 'b') {
      database.prepare(`insert into workout_feedback_v2 (
        id, owner_id, workout_id, action_id, outcome, perceived_effort, had_pain, note,
        started_at, ended_at, activity_session_id, created_at
      ) values (?, ?, ?, ?, 'COMPLETED', 5, 0, null, ?, '2026-09-01T00:30:00.000Z', ?, ?)`)
        .run('feedback-b', ownerId, 'workout-b', 'action-b', timestamp, 'activity-b', timestamp);
      database.prepare(`insert into workouts_v2 (
        id, owner_id, check_in_id, signal_id, generation_mode, state, current_revision_id,
        proposal_id, action_id, time_request_id, feedback_id, version, created_at, updated_at
      ) values ('workout-b-spare', ?, 'check-b', 'signal-b', 'MANUAL', 'DRAFT', null, null, null, null, null, 1, ?, ?)`)
        .run(ownerId, timestamp, timestamp);
    }
    database.prepare(`insert into meal_drafts_v2 (
      id, owner_id, local_date, mode, original_text, state, current_revision_id,
      confirmed_meal_id, version, created_at, updated_at
    ) values (?, ?, '2026-09-01', 'MANUAL', null, 'CANDIDATES_READY', null, null, 1, ?, ?)`)
      .run(`draft-${owner}`, ownerId, timestamp, timestamp);
    if (owner === 'b') {
      database.prepare(`insert into meal_drafts_v2 (
        id, owner_id, local_date, mode, original_text, state, current_revision_id,
        confirmed_meal_id, version, created_at, updated_at
      ) values ('draft-b-spare', ?, '2026-09-02', 'MANUAL', null, 'CANDIDATES_READY', null, null, 1, ?, ?)`)
        .run(ownerId, timestamp, timestamp);
    }
    database.prepare(`insert into meal_revisions_v2 (
      id, owner_id, draft_id, parent_revision_id, revision_no, candidates_json,
      content_hash, created_by, capability_run_id, created_at
    ) values (?, ?, ?, null, 1, '[]', ?, 'DATA_PROVIDER', ?, ?)`)
      .run(`meal-revision-${owner}`, ownerId, `draft-${owner}`, hash(owner === 'a' ? 'e' : 'f'), `run-${owner}`, timestamp);
    database.prepare('update meal_drafts_v2 set current_revision_id = ? where id = ?').run(`meal-revision-${owner}`, `draft-${owner}`);
    database.prepare(`insert into nutrition_source_snapshots_v2 (
      id, owner_id, source_kind, source_id, source_version, dataset_hash, redistribution,
      license_decision_id, adapter_kind, evidence_kind, created_at
    ) values (?, ?, 'TEST_FIXTURE', ?, '1', ?, 0, null, 'TEST_FIXTURE', 'AUTOMATED_TEST_FIXTURE', ?)`)
      .run(`source-${owner}`, ownerId, `source-${owner}`, hash(owner === 'a' ? '1' : '2'), timestamp);
    database.prepare(`insert into nutrition_food_snapshots_v2 (
      id, owner_id, draft_id, candidate_id, source_snapshot_id, record_id, record_hash,
      display_name, serving_quantity_decimal, serving_unit, energy_kcal_decimal,
      protein_grams_decimal, carbohydrate_grams_decimal, fat_grams_decimal, capability_run_id, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, '1', 'GRAM', '1', '1', '1', '1', ?, ?)`)
      .run(`food-${owner}`, ownerId, `draft-${owner}`, `candidate-${owner}`, `source-${owner}`, `record-${owner}`, hash(owner === 'a' ? '3' : '4'), `Food ${owner}`, `run-${owner}`, timestamp);
    database.prepare(`insert into meals_v2 (
      id, owner_id, draft_id, local_date, energy_kcal_decimal, protein_grams_decimal,
      carbohydrate_grams_decimal, fat_grams_decimal, calculation_version, version, created_at
    ) values (?, ?, ?, '2026-09-01', '1', '1', '1', '1', 'DECIMAL_MICRO_V1', 1, ?)`)
      .run(`meal-${owner}`, ownerId, `draft-${owner}`, timestamp);
  }
}

type CrossOwnerProbe = readonly [label: string, sql: string, params: readonly unknown[]];

const crossOwnerProbes: readonly CrossOwnerProbe[] = [
  ['check-in.signal', `insert into fitness_check_ins_v2 values ('probe-check', 'owner-a', '2026-09-01', 480, 5, 0, 0, 0, 'signal-b', '{}', '{}', 'WORKOUT_SAFETY_V1', 1, ?)`, [timestamp]],
    ['workout.check-in', `insert into workouts_v2 values ('probe-workout', 'owner-a', 'check-b', 'signal-a', 'MANUAL', 'DRAFT', null, null, null, null, null, 1, ?, ?)`, [timestamp, timestamp]],
    ['workout.signal', `insert into workouts_v2 values ('probe-workout', 'owner-a', 'check-a', 'signal-b', 'MANUAL', 'DRAFT', null, null, null, null, null, 1, ?, ?)`, [timestamp, timestamp]],
    ['workout-revision.workout', `insert into workout_revisions_v2 values ('probe-revision', 'owner-a', 'workout-b', null, 2, 'Probe', 'Probe', '{}', 'ev-ai-internal-starter', '2026.08.31.1', ?, ?, 'MODEL', 'run-a', ?)`, [hash('5'), hash('6'), timestamp]],
    ['workout-revision.parent', `insert into workout_revisions_v2 values ('probe-revision', 'owner-a', 'workout-a', 'workout-revision-b', 2, 'Probe', 'Probe', '{}', 'ev-ai-internal-starter', '2026.08.31.1', ?, ?, 'MODEL', 'run-a', ?)`, [hash('5'), hash('6'), timestamp]],
    ['workout-revision.capability', `insert into workout_revisions_v2 values ('probe-revision', 'owner-a', 'workout-a', null, 2, 'Probe', 'Probe', '{}', 'ev-ai-internal-starter', '2026.08.31.1', ?, ?, 'MODEL', 'run-b', ?)`, [hash('5'), hash('6'), timestamp]],
    ['workout-citation.revision', `insert into workout_revision_citations_v2 values ('probe-citation', 'owner-a', 'workout-revision-b', ?, 0, 'ev-ai-internal-starter', '2026.08.31.1', ?, 'probe', ?, 'FIRST_PARTY_INTERNAL', 0, ?)`, [hash('7'), hash('8'), hash('9'), timestamp]],
    ['workout-action.workout', `insert into workout_actions_v2 values ('probe-link', 'owner-a', 'workout-b', 'workout-revision-a', 'action-a', ?)`, [timestamp]],
    ['workout-action.revision', `insert into workout_actions_v2 values ('probe-link', 'owner-a', 'workout-a', 'workout-revision-b', 'action-a', ?)`, [timestamp]],
    ['workout-action.action', `insert into workout_actions_v2 values ('probe-link', 'owner-a', 'workout-a', 'workout-revision-a', 'action-b', ?)`, [timestamp]],
    ['workout-feedback.workout', `insert into workout_feedback_v2 values ('probe-feedback', 'owner-a', 'workout-b-spare', 'action-a', 'SKIPPED', null, 0, null, null, null, null, ?)`, [timestamp]],
    ['workout-feedback.action', `insert into workout_feedback_v2 values ('probe-feedback', 'owner-a', 'workout-a', 'action-b', 'SKIPPED', null, 0, null, null, null, null, ?)`, [timestamp]],
    ['workout-feedback.activity', `insert into workout_feedback_v2 values ('probe-feedback', 'owner-a', 'workout-a', 'action-a', 'COMPLETED', 5, 0, null, ?, '2026-09-01T00:30:00.000Z', 'activity-b', ?)`, [timestamp, timestamp]],
    ['workout.current-revision', `update workouts_v2 set current_revision_id = 'workout-revision-b' where id = 'workout-a'`, []],
    ['workout.proposal', `update workouts_v2 set state = 'PROPOSAL_PENDING', proposal_id = 'proposal-b' where id = 'workout-a'`, []],
    ['workout.action', `update workouts_v2 set state = 'ACCEPTED', proposal_id = 'proposal-a', action_id = 'action-b', time_request_id = 'time-a' where id = 'workout-a'`, []],
    ['workout.time-request', `update workouts_v2 set state = 'ACCEPTED', proposal_id = 'proposal-a', action_id = 'action-a', time_request_id = 'time-b' where id = 'workout-a'`, []],
    ['workout.feedback', `update workouts_v2 set state = 'COMPLETED', proposal_id = 'proposal-a', action_id = 'action-a', time_request_id = 'time-a', feedback_id = 'feedback-b' where id = 'workout-a'`, []],
    ['meal-revision.draft', `insert into meal_revisions_v2 values ('probe-meal-revision', 'owner-a', 'draft-b', null, 2, '[]', ?, 'OWNER', null, ?)`, [hash('a'), timestamp]],
    ['meal-revision.parent', `insert into meal_revisions_v2 values ('probe-meal-revision', 'owner-a', 'draft-a', 'meal-revision-b', 2, '[]', ?, 'OWNER', null, ?)`, [hash('a'), timestamp]],
    ['meal-revision.capability', `insert into meal_revisions_v2 values ('probe-meal-revision', 'owner-a', 'draft-a', null, 2, '[]', ?, 'DATA_PROVIDER', 'run-b', ?)`, [hash('a'), timestamp]],
    ['food.draft', `insert into nutrition_food_snapshots_v2 values ('probe-food', 'owner-a', 'draft-b', 'probe-candidate', 'source-a', 'probe-record', ?, 'Probe', '1', 'GRAM', '1', '1', '1', '1', 'run-a', ?)`, [hash('b'), timestamp]],
    ['food.source', `insert into nutrition_food_snapshots_v2 values ('probe-food', 'owner-a', 'draft-a', 'probe-candidate', 'source-b', 'probe-record', ?, 'Probe', '1', 'GRAM', '1', '1', '1', '1', 'run-a', ?)`, [hash('b'), timestamp]],
    ['food.capability', `insert into nutrition_food_snapshots_v2 values ('probe-food', 'owner-a', 'draft-a', 'probe-candidate', 'source-a', 'probe-record', ?, 'Probe', '1', 'GRAM', '1', '1', '1', '1', 'run-b', ?)`, [hash('b'), timestamp]],
    ['meal.draft', `insert into meals_v2 values ('probe-meal', 'owner-a', 'draft-b-spare', '2026-09-02', '1', '1', '1', '1', 'DECIMAL_MICRO_V1', 1, ?)`, [timestamp]],
    ['meal-entry.meal', `insert into meal_entries_v2 values ('probe-entry', 'owner-a', 'meal-b', 'meal-revision-a', 'probe', 'food-a', 'Probe', '1', 'GRAM', '1', '1', '1', '1', ?)`, [timestamp]],
    ['meal-entry.revision', `insert into meal_entries_v2 values ('probe-entry', 'owner-a', 'meal-a', 'meal-revision-b', 'probe', 'food-a', 'Probe', '1', 'GRAM', '1', '1', '1', '1', ?)`, [timestamp]],
    ['meal-entry.food', `insert into meal_entries_v2 values ('probe-entry', 'owner-a', 'meal-a', 'meal-revision-a', 'probe', 'food-b', 'Probe', '1', 'GRAM', '1', '1', '1', '1', ?)`, [timestamp]],
    ['meal-draft.current-revision', `update meal_drafts_v2 set current_revision_id = 'meal-revision-b' where id = 'draft-a'`, []],
    ['meal-draft.confirmed-meal', `update meal_drafts_v2 set state = 'CONFIRMED', confirmed_meal_id = 'meal-b' where id = 'draft-a'`, []],
];

function acceptedCrossOwnerProbes(database: Database.Database): string[] {
  const accepted: string[] = [];
  for (const [label, sql, params] of crossOwnerProbes) {
    database.exec('savepoint v07_cross_owner_probe');
    try {
      database.prepare(sql).run(...params);
      accepted.push(label);
    } catch {
      // Rejection is the expected DB-level defense.
    } finally {
      database.exec('rollback to v07_cross_owner_probe');
      database.exec('release v07_cross_owner_probe');
    }
  }
  return accepted;
}

const v07LineageTables = [
  'fitness_check_ins_v2',
  'workouts_v2',
  'workout_revisions_v2',
  'workout_revision_citations_v2',
  'workout_actions_v2',
  'workout_feedback_v2',
  'meal_drafts_v2',
  'meal_revisions_v2',
  'nutrition_source_snapshots_v2',
  'nutrition_food_snapshots_v2',
  'meals_v2',
  'meal_entries_v2',
  'v07_capability_runs',
] as const;

function snapshotV07Lineage(database: Database.Database): Record<string, Buffer> {
  return Object.fromEntries(v07LineageTables.map((table) => [
    table,
    Buffer.from(JSON.stringify(database.prepare(`select * from ${table} order by id`).all())),
  ]));
}

function snapshotBytes(database: Database.Database, startVersion: number): Record<string, Buffer> {
  const snapshot = (sql: string) => Buffer.from(JSON.stringify(database.prepare(sql).all()));
  return {
    owners: snapshot('select singleton_key, id, username, password_hash, created_at from owners order by id'),
    tasks: snapshot(`select id, owner_id, title, area, priority, status, target_date, completed_at, version, created_at, updated_at from tasks order by id`),
    ...(startVersion >= 2 ? { agentSessions: snapshot('select * from agent_sessions order by id') } : {}),
    ...(startVersion >= 6 ? { agentRuns: snapshot('select * from agent_runs order by id') } : {}),
    ...(startVersion >= 3 ? { proposals: snapshot('select * from proposals order by id'), signals: snapshot('select * from signals order by id') } : {}),
    ...(startVersion >= 8 ? { legacyMeals: snapshot('select * from meal_records order by id') } : {}),
    ...(startVersion >= 18 ? { appVersions: snapshot('select id, owner_id, app_version from daily_plan_runs order by id') } : {}),
  };
}

function seedHistoricalFixture(database: Database.Database, startVersion: number): Record<string, Buffer> {
  database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run(`owner-v${startVersion}`, `owner-v${startVersion}`, `hash-v${startVersion}`, timestamp);
  const ownerId = `owner-v${startVersion}`;
  database.prepare(`insert into tasks (id, owner_id, title, area, priority, status, target_date, completed_at, version, created_at, updated_at)
    values (?, ?, ?, 'WORK', 'HIGH', 'IN_PROGRESS', '2026-09-01', null, 3, ?, ?)`)
    .run(`task-v${startVersion}`, ownerId, `Task v${startVersion}`, timestamp, timestamp);
  if (startVersion >= 2) {
    database.prepare('insert into agent_sessions (id, owner_id, title, created_at, updated_at) values (?, ?, ?, ?, ?)')
      .run(`agent-session-v${startVersion}`, ownerId, `Agent v${startVersion}`, timestamp, timestamp);
  }
  if (startVersion >= 6) {
    database.prepare(`insert into agent_runs (id, owner_id, provider_key, capability, status, context_json, output_json, failure_code, created_at, updated_at)
      values (?, ?, 'CODEX_LOCAL', 'LIFE_PLANNING', 'SUCCEEDED', '{}', '{}', null, ?, ?)`)
      .run(`agent-run-v${startVersion}`, ownerId, timestamp, timestamp);
  }
  if (startVersion >= 3) {
    database.prepare(`insert into proposals (id, owner_id, kind, status, source, title, changes_json, version, created_at, expires_at, decided_at)
      values (?, ?, 'SCHEDULE', 'PENDING', 'DAILY_SCHEDULER', ?, '[]', 2, ?, null, null)`)
      .run(`proposal-v${startVersion}`, ownerId, `Proposal v${startVersion}`, timestamp);
    database.prepare(`insert into signals (id, owner_id, local_date, kind, value, source, version, created_at, updated_at)
      values (?, ?, '2026-09-01', 'ENERGY', 77.5, 'RULES', 2, ?, ?)`)
      .run(`signal-v${startVersion}`, ownerId, timestamp, timestamp);
  }
  if (startVersion >= 8) {
    database.prepare(`insert into meal_records (id, owner_id, local_date, entries_json, calories, protein_grams, carbohydrate_grams, fat_grams, created_at)
      values (?, ?, '2026-09-01', '[{"name":"Legacy","grams":1}]', 10.5, 1.25, 2.5, 0.75, ?)`)
      .run(`legacy-meal-v${startVersion}`, ownerId, timestamp);
  }
  if (startVersion >= 18) {
    for (const [suffix, appVersion] of [['05', '0.5.0'], ['06', '0.6.0']] as const) {
      database.prepare(`insert into daily_plan_runs (
        id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
        proposal_id, failure_code, created_at, completed_at, app_version
      ) values (?, ?, 'DAILY_PLAN_V1', ?, 'MANUAL', 'CONTEXT_READY', '{}', null, null, ?, null, ?)`)
        .run(`daily-run-v${startVersion}-${suffix}`, ownerId, `2026-09-${suffix === '05' ? '05' : '06'}`, timestamp, appVersion);
    }
  }
  return snapshotBytes(database, startVersion);
}

describe('v0.7 corrective migration', () => {
  it.each([20, 21].flatMap((startVersion) => crossOwnerProbes.map(([label, sql, params]) => [startVersion, label, sql, params] as const)))(
    'fails closed upgrading a corrupt v%i database at %s',
    (startVersion, label, sql, params) => {
      const database = new Database(':memory:');
      try {
        database.pragma('foreign_keys = ON');
        runMigrations(database, 20);
        seedV20Graph(database);
        database.prepare(sql).run(...params);
        if (startVersion === 21) runMigrations(database, 21);
        const before = snapshotV07Lineage(database);

        expect(() => runMigrations(database)).toThrow(`V07_OWNER_LINEAGE_PREFLIGHT_FAILED:${label}`);
        expect(database.prepare('select count(*) as count from schema_migrations where version = 22').get()).toEqual({ count: 0 });
        expect(snapshotV07Lineage(database)).toEqual(before);
      } finally {
        database.close();
      }
    },
  );

  it('rejects every new cross-Owner v0.7 lineage write at the database boundary', () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database);
      seedV20Graph(database);
      expect(acceptedCrossOwnerProbes(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('upgrades an already-applied v20 database additively without rebuilding or changing v0.7 rows', () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database, 20);
      seedV20Graph(database);
      const tables = ['fitness_check_ins_v2', 'workouts_v2', 'meal_drafts_v2', 'meals_v2'];
      const rootpages = Object.fromEntries(tables.map((table) => [table, database.prepare("select rootpage from sqlite_master where type = 'table' and name = ?").get(table)]));
      const rows = Object.fromEntries(tables.map((table) => [table, Buffer.from(JSON.stringify(database.prepare(`select * from ${table} order by id`).all()))]));
      runMigrations(database);
      runMigrations(database);
      expect(database.prepare('select version, name from schema_migrations where version = 21').get()).toEqual({ version: 21, name: 'enforce_v07_owner_lineage' });
      expect(database.prepare('select version, name from schema_migrations where version = 22').get()).toEqual({ version: 22, name: 'certify_v07_owner_lineage' });
      expect(database.prepare('select count(*) as count from schema_migrations').get()).toEqual({ count: 22 });
      for (const table of tables) {
        expect(database.prepare("select rootpage from sqlite_master where type = 'table' and name = ?").get(table)).toEqual(rootpages[table]);
        expect(Buffer.from(JSON.stringify(database.prepare(`select * from ${table} order by id`).all()))).toEqual(rows[table]);
      }
    } finally {
      database.close();
    }
  });

  it.each([1, 2, 16, 17, 18, 19, 20, 21])('preserves historical v%i fixtures through two normal startups', (startVersion) => {
    const directory = mkdtempSync(join(tmpdir(), `ev-v07-migration-v${startVersion}-`));
    directories.push(directory);
    const databasePath = join(directory, 'app.sqlite');
    const fixture = new Database(databasePath);
    let before: Record<string, Buffer>;
    try {
      fixture.pragma('foreign_keys = ON');
      runMigrations(fixture, startVersion);
      before = seedHistoricalFixture(fixture, startVersion);
    } finally {
      fixture.close();
    }
    for (let startup = 0; startup < 2; startup += 1) {
      const upgraded = openDatabase(databasePath);
      try {
        expect(snapshotBytes(upgraded, startVersion)).toEqual(before!);
        expect(upgraded.prepare('select max(version) as version from schema_migrations').get()).toEqual({ version: 22 });
      } finally {
        upgraded.close();
      }
    }
  });
});
