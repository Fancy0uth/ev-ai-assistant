import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_core_schema',
    sql: `
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
    `,
  },
  {
    version: 2,
    name: 'add_agent_storage',
    sql: `
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
    `,
  },
  {
    version: 3,
    name: 'add_local_daily_console',
    sql: `
      create table terms (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        title text not null check (length(trim(title)) between 1 and 100),
        timezone text not null check (length(trim(timezone)) between 1 and 100),
        week_one_monday text not null,
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null
      );

      create index terms_owner_updated_at_idx on terms(owner_id, updated_at desc, id);

      create table courses (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        term_id text not null references terms(id) on delete cascade,
        title text not null check (length(trim(title)) between 1 and 200),
        course_code text,
        official_url text,
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null
      );

      create index courses_owner_term_idx on courses(owner_id, term_id, title, id);

      create table calendar_rules (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        term_id text not null references terms(id) on delete cascade,
        course_id text references courses(id) on delete set null,
        title text not null check (length(trim(title)) between 1 and 200),
        weekday integer not null check (weekday between 1 and 7),
        start_local_time text not null,
        end_local_time text not null check (end_local_time > start_local_time),
        week_start integer not null check (week_start between 1 and 53),
        week_end integer not null check (week_end between week_start and 53),
        week_pattern text not null check (week_pattern in ('EVERY_WEEK', 'ODD_WEEKS', 'EVEN_WEEKS')),
        is_hard integer not null check (is_hard in (0, 1)),
        version integer not null check (version >= 1)
      );

      create index calendar_rules_owner_term_idx on calendar_rules(owner_id, term_id, weekday, id);

      create table calendar_exceptions (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        calendar_rule_id text not null references calendar_rules(id) on delete cascade,
        local_date text not null,
        kind text not null check (kind in ('CANCEL', 'RESCHEDULE')),
        start_local_time text,
        end_local_time text,
        title text,
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        check (
          (kind = 'CANCEL' and start_local_time is null and end_local_time is null)
          or (kind = 'RESCHEDULE' and start_local_time is not null and end_local_time is not null
              and end_local_time > start_local_time)
        )
      );

      create unique index calendar_exceptions_rule_date_idx
        on calendar_exceptions(calendar_rule_id, local_date);

      create table events (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        calendar_rule_id text references calendar_rules(id) on delete set null,
        title text not null check (length(trim(title)) between 1 and 200),
        kind text not null check (kind in (
          'COURSE', 'MEETING', 'PERSONAL', 'WORK_BLOCK', 'WORKOUT', 'STUDY'
        )),
        local_date text not null,
        start_local_time text not null,
        end_local_time text not null check (end_local_time > start_local_time),
        is_hard integer not null check (is_hard in (0, 1)),
        status text not null check (status in ('CONFIRMED', 'CANCELLED')),
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null
      );

      create index events_owner_date_time_idx
        on events(owner_id, local_date, start_local_time, id);

      create table actions (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        event_id text references events(id) on delete set null,
        title text not null check (length(trim(title)) between 1 and 200),
        kind text not null check (kind in ('WORK', 'STUDY', 'FITNESS', 'NUTRITION', 'LIFE')),
        status text not null check (status in (
          'OPEN', 'IN_PROGRESS', 'DONE', 'DEFERRED', 'CANCELLED'
        )),
        target_date text,
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null
      );

      create index actions_owner_date_status_idx on actions(owner_id, target_date, status, id);

      create table activity_sessions (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        action_id text references actions(id) on delete set null,
        kind text not null check (kind in ('PROJECT', 'STUDY', 'WORKOUT', 'LIFE')),
        started_at text not null,
        ended_at text,
        summary text,
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        check (ended_at is null or ended_at > started_at)
      );

      create index activity_sessions_owner_started_at_idx
        on activity_sessions(owner_id, started_at desc, id);

      create table signals (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        local_date text not null,
        kind text not null check (kind in ('RECOVERY', 'ENERGY', 'SLEEP', 'DISCOMFORT')),
        value real not null check (value between 0 and 100),
        source text not null check (source in ('CHECK_IN', 'RULES', 'AGENT')),
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null
      );

      create index signals_owner_date_kind_idx on signals(owner_id, local_date, kind, id);

      create table time_requests (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        source text not null check (source in (
          'SCHEDULE_COORDINATOR', 'FITNESS_AGENT', 'LEARNING_AGENT', 'PROJECT_AGENT', 'NUTRITION_AGENT'
        )),
        title text not null check (length(trim(title)) between 1 and 200),
        target_date text not null,
        duration_minutes integer not null check (duration_minutes between 5 and 960),
        priority text not null check (priority in ('LOW', 'MEDIUM', 'HIGH')),
        earliest_start_local_time text,
        latest_end_local_time text,
        is_fixed integer not null check (is_fixed in (0, 1)),
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        check (
          earliest_start_local_time is null or latest_end_local_time is null
          or latest_end_local_time > earliest_start_local_time
        )
      );

      create index time_requests_owner_date_priority_idx
        on time_requests(owner_id, target_date, priority, id);

      create table proposals (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        kind text not null check (kind in ('SCHEDULE', 'WORKOUT', 'NUTRITION', 'LEARNING', 'PROJECT')),
        status text not null check (status in ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
        source text not null check (source in (
          'COURSE_IMPORT', 'DAILY_SCHEDULER', 'FITNESS_AGENT', 'NUTRITION_AGENT', 'LEARNING_AGENT', 'PROJECT_AGENT'
        )),
        title text not null check (length(trim(title)) between 1 and 200),
        changes_json text not null check (json_valid(changes_json)),
        version integer not null check (version >= 1),
        created_at text not null,
        expires_at text,
        decided_at text
      );

      create index proposals_owner_status_created_idx
        on proposals(owner_id, status, created_at desc, id);

      create table proposal_audits (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        proposal_id text not null references proposals(id) on delete cascade,
        decision text not null check (decision in ('ACCEPT', 'REJECT')),
        expected_version integer not null check (expected_version >= 1),
        applied_version integer not null check (applied_version >= 1),
        created_at text not null
      );

      create index proposal_audits_proposal_created_idx
        on proposal_audits(proposal_id, created_at, id);
    `,
  },
  {
    version: 4,
    name: 'add_course_import_runs',
    sql: `
      create table course_import_runs (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        term_id text not null references terms(id) on delete cascade,
        status text not null check (status in ('BLOCKED', 'REVIEW_REQUIRED', 'PROPOSED', 'FAILED')),
        image_mime_type text not null check (image_mime_type in ('image/png', 'image/jpeg', 'image/webp')),
        image_byte_size integer not null check (image_byte_size between 1 and 5000000),
        image_sha256 text not null check (length(image_sha256) = 64),
        candidates_json text not null check (json_valid(candidates_json)),
        proposal_id text references proposals(id) on delete set null,
        failure_code text,
        created_at text not null,
        updated_at text not null
      );

      create index course_import_runs_owner_created_idx
        on course_import_runs(owner_id, created_at desc, id);
    `,
  },
  {
    version: 5,
    name: 'add_daily_planner_jobs',
    sql: `
      create table daily_plan_jobs (
        owner_id text not null references owners(id) on delete cascade,
        local_date text not null,
        status text not null check (status in ('PENDING_CONFIRMATION', 'NO_CHANGES')),
        proposal_id text references proposals(id) on delete set null,
        created_at text not null,
        updated_at text not null,
        primary key (owner_id, local_date),
        check (
          (status = 'PENDING_CONFIRMATION' and proposal_id is not null)
          or (status = 'NO_CHANGES' and proposal_id is null)
        )
      );
    `,
  },
  {
    version: 6,
    name: 'add_agent_runs',
    sql: `
      create table agent_runs (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        provider_key text not null check (provider_key in ('DEEPSEEK', 'CODEX_LOCAL')),
        capability text not null check (capability in (
          'LIFE_PLANNING', 'FITNESS_COACHING', 'LEARNING_SUPPORT', 'PROJECT_ANALYSIS'
        )),
        status text not null check (status in ('BLOCKED', 'SUCCEEDED', 'FAILED')),
        context_json text not null check (json_valid(context_json)),
        output_json text check (output_json is null or json_valid(output_json)),
        failure_code text,
        created_at text not null,
        updated_at text not null
      );

      create index agent_runs_owner_created_idx on agent_runs(owner_id, created_at desc, id);
    `,
  },
  {
    version: 7,
    name: 'add_memory_revisions',
    sql: `
      create table memory_documents (
        owner_id text not null references owners(id) on delete cascade,
        scope text not null check (scope in ('GENERAL', 'FITNESS', 'LEARNING', 'PROJECT')),
        content text not null check (length(content) between 1 and 20000),
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        primary key (owner_id, scope)
      );

      create table memory_revisions (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        scope text not null check (scope in ('GENERAL', 'FITNESS', 'LEARNING', 'PROJECT')),
        content text not null check (length(content) between 1 and 20000),
        version integer not null check (version >= 1),
        created_at text not null,
        unique (owner_id, scope, version)
      );

      create index memory_revisions_owner_scope_version_idx
        on memory_revisions(owner_id, scope, version desc);
    `,
  },
  {
    version: 8,
    name: 'add_confirmed_meal_records',
    sql: `
      create table meal_records (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        local_date text not null,
        entries_json text not null check (json_valid(entries_json)),
        calories real not null check (calories >= 0),
        protein_grams real not null check (protein_grams >= 0),
        carbohydrate_grams real not null check (carbohydrate_grams >= 0),
        fat_grams real not null check (fat_grams >= 0),
        created_at text not null
      );

      create index meal_records_owner_date_idx on meal_records(owner_id, local_date, created_at, id);
    `,
  },
  {
    version: 9,
    name: 'add_course_resources',
    sql: `
      create table course_resources (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        course_id text not null references courses(id) on delete cascade,
        title text not null check (length(trim(title)) between 1 and 200),
        url text not null check (length(url) between 1 and 2000),
        source text not null check (source in ('USER_PROVIDED', 'PUBLIC_SEARCH')),
        created_at text not null
      );
      create index course_resources_owner_course_idx on course_resources(owner_id, course_id, created_at, id);
    `,
  },
  {
    version: 10,
    name: 'add_read_only_project_scopes',
    sql: `
      create table project_scopes (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        label text not null check (length(trim(label)) between 1 and 120),
        root_path text not null check (length(trim(root_path)) between 1 and 2000),
        created_at text not null,
        updated_at text not null,
        unique(owner_id, root_path)
      );
      create index project_scopes_owner_created_idx on project_scopes(owner_id, created_at, id);
    `,
  },
  {
    version: 11,
    name: 'add_provider_credentials',
    sql: `
      create table provider_credentials (
        owner_id text not null references owners(id) on delete cascade,
        provider_key text not null check (provider_key = 'DEEPSEEK'),
        protected_value text not null,
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        primary key (owner_id, provider_key)
      );
    `,
  },
  {
    version: 12,
    name: 'add_provider_connection_tests',
    sql: `
      create table provider_connection_tests (
        owner_id text not null references owners(id) on delete cascade,
        provider_key text not null check (provider_key = 'DEEPSEEK'),
        status text not null check (status in ('SUCCEEDED', 'FAILED')),
        failure_code text check (failure_code is null or failure_code in (
          'AUTHENTICATION_FAILED',
          'RATE_LIMITED',
          'NETWORK_ERROR',
          'INVALID_RESPONSE',
          'PROVIDER_UNAVAILABLE'
        )),
        created_at text not null,
        check (
          (status = 'SUCCEEDED' and failure_code is null)
          or (status = 'FAILED' and failure_code is not null)
        )
      );
      create index provider_connection_tests_owner_latest_idx
        on provider_connection_tests(owner_id, provider_key, created_at desc);
    `,
  },
  {
    version: 13,
    name: 'add_daily_plan_runs',
    sql: `
      create table daily_plan_runs (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        contract_version text not null check (contract_version = 'DAILY_PLAN_V1'),
        local_date text not null,
        trigger text not null check (trigger in (
          'MANUAL',
          'SCHEDULED_0700',
          'FIRST_VISIT_RECOVERY'
        )),
        status text not null check (status in (
          'CREATED',
          'CONTEXT_READY',
          'GENERATING',
          'SUCCEEDED',
          'FAILED'
        )),
        context_manifest_json text not null check (json_valid(context_manifest_json)),
        proposal_id text,
        failure_code text check (failure_code is null or failure_code in (
          'DAILY_PLAN_PROVIDER_NOT_CONFIGURED',
          'DAILY_PLAN_PROVIDER_UNAVAILABLE',
          'DAILY_PLAN_CONTEXT_INVALID',
          'DAILY_PLAN_MODEL_OUTPUT_INVALID',
          'DAILY_PLAN_UNSUPPORTED_ACTION',
          'DAILY_PLAN_CONTEXT_REFERENCE_UNKNOWN',
          'DAILY_PLAN_VALIDATION_FAILED',
          'DAILY_PLAN_BASE_VERSION_STALE',
          'DAILY_PLAN_RUN_STATE_CONFLICT',
          'DAILY_PLAN_PROPOSAL_NOT_REVIEWABLE'
        )),
        created_at text not null,
        completed_at text,
        check (
          (status = 'SUCCEEDED'
            and proposal_id is not null
            and failure_code is null
            and completed_at is not null
            and completed_at >= created_at)
          or (status = 'FAILED'
            and proposal_id is null
            and failure_code is not null
            and completed_at is not null
            and completed_at >= created_at)
          or (status in ('CREATED', 'CONTEXT_READY', 'GENERATING')
            and proposal_id is null
            and failure_code is null
            and completed_at is null)
        )
      );

      create index daily_plan_runs_owner_date_status_idx
        on daily_plan_runs(owner_id, local_date, status, id);
      create index daily_plan_runs_owner_created_at_idx
        on daily_plan_runs(owner_id, created_at desc, id);
    `,
  },
  {
    version: 14,
    name: 'add_daily_plan_proposals',
    sql: `
      create table schedule_versions (
        owner_id text primary key references owners(id) on delete cascade,
        version integer not null check (version >= 1),
        updated_at text not null
      );

      insert into schedule_versions (owner_id, version, updated_at)
      select id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from owners;

      create trigger schedule_versions_after_owner_insert
      after insert on owners begin
        insert into schedule_versions (owner_id, version, updated_at)
        values (new.id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      end;

      create trigger schedule_versions_after_event_insert
      after insert on events begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id = new.owner_id;
      end;

      create trigger schedule_versions_after_event_update
      after update on events begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id in (old.owner_id, new.owner_id);
      end;

      create trigger schedule_versions_after_event_delete
      after delete on events begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id = old.owner_id;
      end;

      create trigger schedule_versions_after_time_request_insert
      after insert on time_requests begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id = new.owner_id;
      end;

      create trigger schedule_versions_after_time_request_update
      after update on time_requests begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id in (old.owner_id, new.owner_id);
      end;

      create trigger schedule_versions_after_time_request_delete
      after delete on time_requests begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id = old.owner_id;
      end;

      create trigger schedule_versions_after_recovery_signal_insert
      after insert on signals
      when new.kind = 'RECOVERY' begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id = new.owner_id;
      end;

      create trigger schedule_versions_after_recovery_signal_update
      after update on signals
      when old.kind = 'RECOVERY' or new.kind = 'RECOVERY' begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id in (old.owner_id, new.owner_id);
      end;

      create trigger schedule_versions_after_recovery_signal_delete
      after delete on signals
      when old.kind = 'RECOVERY' begin
        update schedule_versions
        set version = version + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where owner_id = old.owner_id;
      end;

      create unique index daily_plan_runs_id_owner_id_idx
        on daily_plan_runs(id, owner_id);

      create table daily_plan_proposals (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        run_id text not null,
        contract_version text not null check (contract_version = 'DAILY_PLAN_V1'),
        local_date text not null,
        status text not null check (status in (
          'PENDING_REVIEW',
          'PARTIALLY_APPLIED',
          'APPLIED',
          'REJECTED',
          'STALE'
        )),
        base_schedule_version integer not null check (base_schedule_version >= 1),
        summary text not null check (length(trim(summary)) between 1 and 800),
        items_json text not null check (json_valid(items_json)),
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        foreign key (run_id, owner_id)
          references daily_plan_runs(id, owner_id) on delete cascade
      );

      create index daily_plan_proposals_owner_date_status_idx
        on daily_plan_proposals(owner_id, local_date, status);
      create index daily_plan_proposals_run_id_idx on daily_plan_proposals(run_id);
    `,
  },
];

export function runMigrations(database: Database.Database): void {
  database.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at text not null
    );
  `);

  const applied = new Set(
    (
      database.prepare('select version from schema_migrations order by version').all() as Array<{
        version: number;
      }>
    ).map(({ version }) => version),
  );

  const applyMigration = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database
      .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      applyMigration(migration);
    }
  }
}
