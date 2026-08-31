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
  {
    version: 15,
    name: 'add_daily_plan_decisions',
    sql: `
      create table proposal_decisions (
        id text primary key,
        owner_id text not null references owners(id) on delete restrict,
        proposal_id text not null references daily_plan_proposals(id) on delete restrict,
        proposal_item_id text not null,
        time_request_id text not null references time_requests(id) on delete restrict,
        decision text not null check (decision in ('APPLY', 'REJECT')),
        scheduled_event_id text references events(id) on delete restrict,
        actual_start_local_time text,
        actual_end_local_time text,
        rejection_reason text,
        created_at text not null,
        unique (proposal_id, proposal_item_id)
      );

      create index proposal_decisions_owner_proposal_idx
        on proposal_decisions(owner_id, proposal_id);
      create index proposal_decisions_owner_time_request_idx
        on proposal_decisions(owner_id, time_request_id);

      create trigger proposal_decisions_before_update
      before update on proposal_decisions begin
        select raise(abort, 'proposal decisions are immutable');
      end;

      create trigger proposal_decisions_before_delete
      before delete on proposal_decisions begin
        select raise(abort, 'proposal decisions are immutable');
      end;
    `,
  },
  {
    version: 16,
    name: 'add_daily_plan_automatic_run_guard',
    sql: `
      create unique index daily_plan_runs_owner_automatic_date_idx
        on daily_plan_runs(owner_id, local_date)
        where trigger in ('SCHEDULED_0700', 'FIRST_VISIT_RECOVERY');
      `,
  },
  {
    version: 17,
    name: 'add_scheduling_lifecycle',
    sql: `
      alter table tasks add column scheduling_duration_minutes integer
        check (scheduling_duration_minutes is null or scheduling_duration_minutes between 5 and 960);
      alter table tasks add column scheduling_earliest_start_local_time text
        check (
          scheduling_earliest_start_local_time is null
          or (
            scheduling_earliest_start_local_time glob '[0-2][0-9]:[0-5][0-9]'
            and scheduling_earliest_start_local_time <= '23:59'
          )
        );
      alter table tasks add column scheduling_latest_end_local_time text
        check (
          scheduling_latest_end_local_time is null
          or (
            scheduling_latest_end_local_time glob '[0-2][0-9]:[0-5][0-9]'
            and scheduling_latest_end_local_time <= '23:59'
          )
        );
      alter table tasks add column scheduling_is_fixed integer
        check (scheduling_is_fixed is null or scheduling_is_fixed in (0, 1));

      alter table time_requests add column origin_kind text
        check (origin_kind is null or origin_kind in (
          'TASK', 'ACTION', 'LEARNING_PLAN', 'WORKOUT', 'PROJECT_BRIEF'
        ));
      alter table time_requests add column origin_id text;
      alter table time_requests add column origin_version integer
        check (origin_version is null or origin_version >= 1);
      alter table time_requests add column lifecycle_status text not null default 'ACTIVE'
        check (lifecycle_status in ('ACTIVE', 'CLOSED'));
      alter table time_requests add column closed_at text;
      alter table time_requests add column closed_reason text
        check (closed_reason is null or closed_reason in ('COMPLETED', 'CANCELLED', 'SUPERSEDED'));

      create trigger time_requests_v17_validate_before_insert
      before insert on time_requests
      when
        ((new.origin_kind is null) != (new.origin_id is null))
        or ((new.origin_kind is null) != (new.origin_version is null))
        or (
          new.lifecycle_status = 'ACTIVE'
          and (new.closed_at is not null or new.closed_reason is not null)
        )
        or (
          new.lifecycle_status = 'CLOSED'
          and (new.closed_at is null or new.closed_reason is null)
        )
      begin
        select raise(abort, 'invalid TimeRequest origin or lifecycle state');
      end;

      create trigger time_requests_v17_validate_before_update
      before update on time_requests
      when
        ((new.origin_kind is null) != (new.origin_id is null))
        or ((new.origin_kind is null) != (new.origin_version is null))
        or (
          new.lifecycle_status = 'ACTIVE'
          and (new.closed_at is not null or new.closed_reason is not null)
        )
        or (
          new.lifecycle_status = 'CLOSED'
          and (new.closed_at is null or new.closed_reason is null)
        )
      begin
        select raise(abort, 'invalid TimeRequest origin or lifecycle state');
      end;

      create unique index time_requests_owner_active_origin_uidx
        on time_requests(owner_id, origin_kind, origin_id)
        where origin_id is not null and lifecycle_status = 'ACTIVE';

      create table daily_plan_preflights (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        run_id text not null,
        contract_version text not null check (contract_version = 'DAILY_PLAN_PREFLIGHT_V1'),
        local_date text not null,
        status text not null check (status in (
          'AWAITING_APPROVAL', 'APPROVED', 'CLAIMED', 'CONSUMED', 'STALE'
        )),
        base_schedule_version integer not null check (base_schedule_version >= 1),
        items_json text not null check (json_valid(items_json)),
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        approved_at text,
        claimed_at text,
        consumed_at text,
        foreign key (run_id, owner_id)
          references daily_plan_runs(id, owner_id) on delete cascade,
        unique (run_id)
      );

      create index daily_plan_preflights_owner_date_status_idx
        on daily_plan_preflights(owner_id, local_date, status, created_at desc);

      create trigger daily_plan_preflights_v17_validate_before_insert
      before insert on daily_plan_preflights
      when
        not (
          (new.status = 'AWAITING_APPROVAL'
            and new.approved_at is null
            and new.claimed_at is null
            and new.consumed_at is null)
          or (new.status = 'APPROVED'
            and new.approved_at is not null
            and new.claimed_at is null
            and new.consumed_at is null)
          or (new.status = 'CLAIMED'
            and new.approved_at is not null
            and new.claimed_at is not null
            and new.consumed_at is null)
          or (new.status = 'CONSUMED'
            and new.approved_at is not null
            and new.claimed_at is not null
            and new.consumed_at is not null)
          or (new.status = 'STALE'
            and new.consumed_at is null
            and (new.claimed_at is null or new.approved_at is not null))
        )
        or julianday(new.created_at) is null
        or julianday(new.updated_at) is null
        or (new.approved_at is not null and julianday(new.approved_at) is null)
        or (new.claimed_at is not null and julianday(new.claimed_at) is null)
        or (new.consumed_at is not null and julianday(new.consumed_at) is null)
        or julianday(new.updated_at) < julianday(new.created_at)
        or (
          new.approved_at is not null
          and julianday(new.approved_at) < julianday(new.created_at)
        )
        or (
          new.claimed_at is not null
          and (
            new.approved_at is null
            or julianday(new.claimed_at) < julianday(new.approved_at)
          )
        )
        or (
          new.consumed_at is not null
          and (
            new.claimed_at is null
            or julianday(new.consumed_at) < julianday(new.claimed_at)
          )
        )
      begin
        select raise(abort, 'invalid daily plan preflight lifecycle state');
      end;

      create trigger daily_plan_preflights_v17_validate_before_update
      before update on daily_plan_preflights
      when
        not (
          (new.status = 'AWAITING_APPROVAL'
            and new.approved_at is null
            and new.claimed_at is null
            and new.consumed_at is null)
          or (new.status = 'APPROVED'
            and new.approved_at is not null
            and new.claimed_at is null
            and new.consumed_at is null)
          or (new.status = 'CLAIMED'
            and new.approved_at is not null
            and new.claimed_at is not null
            and new.consumed_at is null)
          or (new.status = 'CONSUMED'
            and new.approved_at is not null
            and new.claimed_at is not null
            and new.consumed_at is not null)
          or (new.status = 'STALE'
            and new.consumed_at is null
            and (new.claimed_at is null or new.approved_at is not null))
        )
        or julianday(new.created_at) is null
        or julianday(new.updated_at) is null
        or (new.approved_at is not null and julianday(new.approved_at) is null)
        or (new.claimed_at is not null and julianday(new.claimed_at) is null)
        or (new.consumed_at is not null and julianday(new.consumed_at) is null)
        or julianday(new.updated_at) < julianday(new.created_at)
        or (
          new.approved_at is not null
          and julianday(new.approved_at) < julianday(new.created_at)
        )
        or (
          new.claimed_at is not null
          and (
            new.approved_at is null
            or julianday(new.claimed_at) < julianday(new.approved_at)
          )
        )
        or (
          new.consumed_at is not null
          and (
            new.claimed_at is null
            or julianday(new.consumed_at) < julianday(new.claimed_at)
          )
        )
        or (old.status = 'CONSUMED' and new.status = 'STALE')
      begin
        select raise(abort, 'invalid daily plan preflight lifecycle state');
      end;
    `,
  },
  {
    version: 18,
    name: 'add_provider_reliability',
    sql: `
      create table idempotency_records (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        idempotency_key text not null check (length(idempotency_key) between 16 and 128),
        operation text not null check (operation in (
          'daily_plan.generate', 'daily_plan.proposal.decision', 'proposal.decision'
        )),
        resource_id text,
        request_hash text not null check (length(request_hash) = 64),
        state text not null check (state in ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
        lease_token text,
        lease_expires_at text,
        attempt_count integer not null default 0 check (attempt_count between 0 and 2),
        response_status integer,
        response_json text check (response_json is null or json_valid(response_json)),
        failure_code text,
        created_at text not null,
        updated_at text not null,
        unique (owner_id, idempotency_key),
        check (
          (state = 'IN_PROGRESS'
            and lease_token is not null
            and lease_expires_at is not null
            and response_status is null
            and response_json is null)
          or (state in ('COMPLETED', 'FAILED')
            and lease_token is null
            and lease_expires_at is null
            and response_status is not null
            and response_json is not null)
        )
      );
      create index idempotency_records_owner_operation_state_idx
        on idempotency_records(owner_id, operation, state, updated_at desc);
      create index idempotency_records_owner_lease_idx
        on idempotency_records(owner_id, lease_expires_at)
        where state = 'IN_PROGRESS';

      create table provider_call_logs (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        run_id text,
        idempotency_record_id text references idempotency_records(id) on delete set null,
        provider text not null check (provider = 'DEEPSEEK'),
        operation text not null check (operation = 'daily_plan.generate'),
        model text not null check (model in ('deepseek-v4-flash', 'deepseek-v4-pro')),
        attempt_no integer not null check (attempt_no between 1 and 2),
        status text not null check (status in ('STARTED', 'SUCCEEDED', 'FAILED', 'REJECTED')),
        failure_code text,
        finish_reason text check (finish_reason is null or finish_reason in (
          'stop', 'length', 'content_filter', 'tool_calls', 'insufficient_system_resource', 'unknown'
        )),
        prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
        completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
        total_tokens integer check (total_tokens is null or total_tokens >= 0),
        input_chars integer not null check (input_chars between 0 and 20000),
        output_chars integer check (output_chars is null or output_chars between 0 and 20000),
        policy_version text not null check (policy_version = 'PROVIDER_POLICY_V1'),
        contract_version text not null check (contract_version = 'DAILY_PLAN_V1'),
        app_version text not null check (
          length(app_version) between 5 and 64
          and app_version glob '[0-9]*.[0-9]*.[0-9]*'
          and app_version not glob '*[^0-9A-Za-z.+-]*'
        ),
        local_date text not null,
        started_at text not null,
        finished_at text,
        duration_ms integer check (duration_ms is null or duration_ms >= 0),
        foreign key (run_id, owner_id)
          references daily_plan_runs(id, owner_id) on delete set null
      );
      create index provider_call_logs_owner_date_started_idx
        on provider_call_logs(owner_id, local_date, started_at desc, id);
      create index provider_call_logs_run_idx on provider_call_logs(run_id, attempt_no);

      alter table daily_plan_runs add column attempt_count integer not null default 0
        check (attempt_count between 0 and 2);
      alter table daily_plan_runs add column lease_token text;
      alter table daily_plan_runs add column lease_expires_at text;
      alter table daily_plan_runs add column deadline_at text;
      alter table daily_plan_runs add column terminal_reason text;
      alter table daily_plan_runs add column app_version text check (
        app_version is null or (
          length(app_version) between 5 and 64
          and app_version glob '[0-9]*.[0-9]*.[0-9]*'
          and app_version not glob '*[^0-9A-Za-z.+-]*'
        )
      );
      alter table daily_plan_runs add column idempotency_record_id text;
      create index daily_plan_runs_owner_lease_idx
        on daily_plan_runs(owner_id, lease_expires_at)
        where status = 'GENERATING';
    `,
  },
  {
    version: 19,
    name: 'add_v06_learning_schedule_loop',
    sql: `
      create table local_artifacts (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        kind text not null check (kind = 'COURSE_SCHEDULE_IMAGE'),
        storage_key text not null check (length(storage_key) between 1 and 512 and storage_key not like '/%' and storage_key not like '%..%'),
        media_type text not null check (media_type in ('image/png', 'image/jpeg', 'image/webp')),
        byte_size integer not null check (byte_size between 1 and 5000000),
        width integer not null check (width between 1 and 12000),
        height integer not null check (height between 1 and 12000),
        pixel_count integer not null check (pixel_count between 1 and 40000000),
        sha256 text not null check (length(sha256) = 64),
        state text not null check (state in ('ACTIVE', 'DELETE_PENDING', 'DELETED')),
        created_at text not null,
        delete_requested_at text,
        deleted_at text,
        version integer not null check (version >= 1)
      );
      create index local_artifacts_owner_sha256_idx on local_artifacts(owner_id, sha256);

      create table external_capability_runs (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        capability text not null check (capability in ('COURSE_SCHEDULE_VISION', 'PUBLIC_LEARNING_SEARCH', 'LEARNING_TEXT_ANALYSIS')),
        operation text not null check (operation in ('COURSE_IMPORT_EXTRACT', 'COURSE_RESOURCE_SEARCH', 'LEARNING_ADVICE_GENERATE')),
        resource_id text not null,
        provider_id text,
        provider_label text,
        adapter_kind text not null check (adapter_kind in ('NONE', 'TEST_FAKE', 'PRODUCTION_ADAPTER')),
        evidence_kind text not null check (evidence_kind in ('NONE', 'AUTOMATED_FAKE', 'REAL_PROVIDER')),
        disclosure_json text not null check (json_valid(disclosure_json)),
        disclosure_version text not null check (disclosure_version = 'CAPABILITY_DISCLOSURE_V1'),
        idempotency_key text,
        request_hash text check (request_hash is null or length(request_hash) = 64),
        status text not null check (status in ('BLOCKED_PROVIDER', 'AWAITING_DISCLOSURE', 'RUNNING', 'SUCCEEDED', 'FAILED')),
        lease_token text,
        lease_expires_at text,
        deadline_at text,
        policy_version text not null check (policy_version = 'CAPABILITY_POLICY_V1'),
        local_date text not null,
        reserved_calls integer not null default 0 check (reserved_calls between 0 and 20),
        actual_calls integer not null default 0 check (actual_calls between 0 and 20),
        input_chars integer not null default 0 check (input_chars between 0 and 20000),
        output_chars integer not null default 0 check (output_chars between 0 and 100000),
        failure_code text,
        app_version text not null check (length(app_version) between 5 and 64),
        created_at text not null,
        updated_at text not null,
        version integer not null check (version >= 1)
      );
      create unique index external_capability_runs_owner_idempotency_idx
        on external_capability_runs(owner_id, idempotency_key) where idempotency_key is not null;
      create index external_capability_runs_owner_date_capability_idx
        on external_capability_runs(owner_id, local_date, capability, status, created_at);

      create table course_imports_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        term_id text not null references terms(id) on delete cascade,
        artifact_id text not null references local_artifacts(id) on delete restrict,
        capability_run_id text not null references external_capability_runs(id) on delete restrict,
        status text not null check (status in ('BLOCKED_PROVIDER', 'AWAITING_DISCLOSURE', 'EXTRACTING', 'REVIEW_REQUIRED', 'SCHEDULE_PROPOSAL_PENDING', 'CONFIRMED', 'SCHEDULE_REJECTED', 'FAILED')),
        current_revision_id text,
        schedule_proposal_id text references proposals(id) on delete set null,
        confirm_idempotency_key text,
        confirm_request_hash text check (confirm_request_hash is null or length(confirm_request_hash) = 64),
        failure_code text,
        created_at text not null,
        updated_at text not null,
        version integer not null check (version >= 1)
      );
      create index course_imports_v2_owner_created_idx on course_imports_v2(owner_id, created_at desc, id);

      create table course_import_revisions (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        import_id text not null references course_imports_v2(id) on delete cascade,
        parent_revision_id text references course_import_revisions(id) on delete restrict,
        revision_no integer not null check (revision_no >= 1),
        candidates_json text not null check (json_valid(candidates_json)),
        content_hash text not null check (length(content_hash) = 64),
        created_by text not null check (created_by in ('VISION', 'OWNER')),
        created_at text not null,
        unique(import_id, revision_no)
      );
      create trigger course_import_revisions_immutable_update before update on course_import_revisions begin select raise(abort, 'course import revisions are immutable'); end;
      create trigger course_import_revisions_immutable_delete before delete on course_import_revisions begin select raise(abort, 'course import revisions are immutable'); end;

      create table course_import_entities (
        owner_id text not null references owners(id) on delete cascade,
        import_id text not null references course_imports_v2(id) on delete cascade,
        candidate_id text not null,
        course_id text not null references courses(id) on delete restrict,
        calendar_rule_id text not null references calendar_rules(id) on delete restrict,
        created_at text not null,
        primary key(import_id, candidate_id),
        unique(calendar_rule_id)
      );

      create table course_learning_contexts (
        owner_id text not null references owners(id) on delete cascade,
        course_id text not null references courses(id) on delete cascade,
        stage text not null check (stage in ('NOT_STARTED', 'PREPARING', 'IN_PROGRESS', 'REVIEWING', 'COMPLETE')),
        progress_note text not null default '' check (length(progress_note) <= 2000),
        created_at text not null,
        updated_at text not null,
        version integer not null check (version >= 1),
        primary key(owner_id, course_id)
      );

      create table course_resource_search_runs (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        course_id text not null references courses(id) on delete cascade,
        capability_run_id text not null references external_capability_runs(id) on delete restrict,
        query text not null check (length(query) between 1 and 300),
        status text not null check (status in ('BLOCKED_PROVIDER', 'AWAITING_DISCLOSURE', 'SEARCHING', 'SUCCEEDED', 'FAILED')),
        citation_count integer not null default 0 check (citation_count between 0 and 5),
        rejected_count integer not null default 0 check (rejected_count between 0 and 5),
        failure_code text,
        created_at text not null,
        updated_at text not null,
        version integer not null check (version >= 1)
      );

      create table course_resource_citations (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        course_id text not null references courses(id) on delete cascade,
        course_resource_id text not null references course_resources(id) on delete restrict,
        search_run_id text not null references course_resource_search_runs(id) on delete restrict,
        title text not null,
        url text not null check (url like 'https://%'),
        publisher text not null,
        retrieved_at text not null,
        content_hash text not null check (length(content_hash) = 64),
        media_type text not null check (media_type in ('text/html', 'text/plain')),
        created_at text not null
      );
      create trigger course_resource_citations_immutable_update before update on course_resource_citations begin select raise(abort, 'course resource citations are immutable'); end;
      create trigger course_resource_citations_immutable_delete before delete on course_resource_citations begin select raise(abort, 'course resource citations are immutable'); end;

      create table learning_runs (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        course_id text not null references courses(id) on delete cascade,
        search_run_id text not null references course_resource_search_runs(id) on delete restrict,
        capability_run_id text not null references external_capability_runs(id) on delete restrict,
        citation_ids_json text not null check (json_valid(citation_ids_json)),
        status text not null check (status in ('BLOCKED_PROVIDER', 'AWAITING_DISCLOSURE', 'GENERATING', 'PROPOSAL_PENDING', 'ACCEPTED', 'REJECTED', 'FAILED')),
        proposal_id text references proposals(id) on delete set null,
        failure_code text,
        created_at text not null,
        updated_at text not null,
        version integer not null check (version >= 1)
      );
      create table learning_actions (
        owner_id text not null references owners(id) on delete cascade,
        action_id text primary key references actions(id) on delete cascade,
        course_id text not null references courses(id) on delete restrict,
        learning_run_id text not null references learning_runs(id) on delete restrict,
        created_at text not null
      );
      create table learning_action_citations (
        owner_id text not null references owners(id) on delete cascade,
        action_id text not null references actions(id) on delete cascade,
        citation_id text not null references course_resource_citations(id) on delete restrict,
        created_at text not null,
        primary key(action_id, citation_id)
      );
      create table audit_events (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        event_type text not null check (event_type in ('ARTIFACT_UPLOADED', 'ARTIFACT_DELETE_REQUESTED', 'ARTIFACT_DELETED', 'DISCLOSURE_ACCEPTED', 'IMPORT_REVISION_SAVED', 'COURSE_IMPORT_CONFIRMED', 'COURSE_CONTEXT_UPDATED', 'RESOURCE_SEARCH_COMPLETED', 'LEARNING_PROPOSAL_CREATED', 'LEARNING_PROPOSAL_MATERIALIZED')),
        entity_type text not null,
        entity_id text not null,
        metadata_json text not null check (json_valid(metadata_json)),
        created_at text not null
      );
      create trigger audit_events_immutable_update before update on audit_events begin select raise(abort, 'audit events are immutable'); end;
      create trigger audit_events_immutable_delete before delete on audit_events begin select raise(abort, 'audit events are immutable'); end;
    `,
  },
  {
    version: 20,
    name: 'add_v07_fitness_nutrition_loop',
    sql: `
      create table fitness_check_ins_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        local_date text not null,
        sleep_minutes integer not null check (sleep_minutes between 0 and 1440),
        energy_level integer not null check (energy_level between 1 and 5),
        discomfort_level integer not null check (discomfort_level between 0 and 5),
        has_pain integer not null check (has_pain in (0, 1)),
        acute_risk integer not null check (acute_risk in (0, 1)),
        signal_id text not null references signals(id),
        recovery_json text not null check (json_valid(recovery_json)),
        safety_json text not null check (json_valid(safety_json)),
        policy_version text not null check (policy_version = 'WORKOUT_SAFETY_V1'),
        version integer not null check (version = 1),
        created_at text not null,
        unique (owner_id, signal_id)
      );
      create index fitness_check_ins_v2_owner_date_idx on fitness_check_ins_v2(owner_id, local_date desc, created_at desc, id);
      create index fitness_check_ins_v2_owner_safety_idx on fitness_check_ins_v2(owner_id, has_pain, acute_risk, id);

      create table workouts_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        check_in_id text not null references fitness_check_ins_v2(id),
        signal_id text not null references signals(id),
        generation_mode text not null check (generation_mode in ('MANUAL', 'ASSISTED')),
        state text not null check (state in ('DRAFT', 'PROPOSAL_PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'SKIPPED')),
        current_revision_id text,
        proposal_id text references proposals(id),
        action_id text references actions(id),
        time_request_id text references time_requests(id),
        feedback_id text,
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        check (
          (state = 'DRAFT' and proposal_id is null and action_id is null and time_request_id is null and feedback_id is null)
          or (state = 'PROPOSAL_PENDING' and proposal_id is not null and action_id is null and time_request_id is null and feedback_id is null)
          or (state = 'ACCEPTED' and proposal_id is not null and action_id is not null and time_request_id is not null and feedback_id is null)
          or (state = 'REJECTED' and proposal_id is not null and action_id is null and time_request_id is null and feedback_id is null)
          or (state in ('COMPLETED', 'SKIPPED') and proposal_id is not null and action_id is not null and time_request_id is not null and feedback_id is not null)
        )
      );
      create index workouts_v2_owner_updated_idx on workouts_v2(owner_id, updated_at desc, id);
      create index workouts_v2_owner_state_idx on workouts_v2(owner_id, state, updated_at desc, id);
      create index workouts_v2_owner_check_in_idx on workouts_v2(owner_id, check_in_id, id);

      create table workout_revisions_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        workout_id text not null references workouts_v2(id) on delete cascade,
        parent_revision_id text references workout_revisions_v2(id) on delete restrict,
        revision_no integer not null check (revision_no >= 1),
        title text not null check (length(trim(title)) between 1 and 200),
        rationale text not null check (length(trim(rationale)) between 1 and 1000),
        plan_json text not null check (json_valid(plan_json)),
        catalog_id text not null check (length(catalog_id) between 1 and 120),
        catalog_version text not null check (length(catalog_version) between 1 and 120),
        catalog_hash text not null check (length(catalog_hash) = 64),
        content_hash text not null check (length(content_hash) = 64),
        created_by text not null check (created_by in ('RULES', 'OWNER', 'MODEL')),
        capability_run_id text,
        created_at text not null,
        unique (workout_id, revision_no)
      );
      create index workout_revisions_v2_owner_workout_idx on workout_revisions_v2(owner_id, workout_id, revision_no desc, id);

      create table workout_revision_citations_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        revision_id text not null references workout_revisions_v2(id) on delete cascade,
        citation_id text not null check (length(citation_id) = 64),
        position integer not null check (position >= 0),
        catalog_id text not null check (length(catalog_id) between 1 and 120),
        catalog_version text not null check (length(catalog_version) between 1 and 120),
        catalog_hash text not null check (length(catalog_hash) = 64),
        exercise_id text not null check (length(exercise_id) between 1 and 120),
        item_hash text not null check (length(item_hash) = 64),
        source_kind text not null check (source_kind = 'FIRST_PARTY_INTERNAL'),
        redistribution integer not null check (redistribution = 0),
        created_at text not null,
        unique (revision_id, citation_id),
        unique (revision_id, position)
      );
      create index workout_revision_citations_v2_owner_revision_idx on workout_revision_citations_v2(owner_id, revision_id, position);

      create table workout_actions_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        workout_id text not null references workouts_v2(id) on delete cascade,
        revision_id text not null references workout_revisions_v2(id) on delete restrict,
        action_id text not null references actions(id) on delete restrict,
        created_at text not null,
        unique (workout_id),
        unique (action_id)
      );
      create index workout_actions_v2_owner_workout_idx on workout_actions_v2(owner_id, workout_id);

      create table workout_feedback_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        workout_id text not null references workouts_v2(id) on delete cascade,
        action_id text not null references actions(id) on delete restrict,
        outcome text not null check (outcome in ('COMPLETED', 'SKIPPED')),
        perceived_effort integer check (perceived_effort is null or perceived_effort between 1 and 10),
        had_pain integer not null check (had_pain in (0, 1)),
        note text check (note is null or length(note) <= 500),
        started_at text,
        ended_at text,
        activity_session_id text references activity_sessions(id) on delete restrict,
        created_at text not null,
        check (
          (outcome = 'COMPLETED' and started_at is not null and ended_at is not null and ended_at > started_at and activity_session_id is not null)
          or (outcome = 'SKIPPED' and started_at is null and ended_at is null and perceived_effort is null and activity_session_id is null)
        ),
        unique (workout_id)
      );
      create index workout_feedback_v2_owner_created_idx on workout_feedback_v2(owner_id, created_at desc, id);

      create table meal_drafts_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        local_date text not null,
        mode text not null check (mode in ('MANUAL', 'PARSE_TEXT')),
        original_text text check (original_text is null or length(original_text) between 1 and 1000),
        state text not null check (state in ('CANDIDATES_READY', 'MATCHES_READY', 'CONFIRMED')),
        current_revision_id text,
        confirmed_meal_id text,
        version integer not null check (version >= 1),
        created_at text not null,
        updated_at text not null,
        check ((state = 'CONFIRMED' and confirmed_meal_id is not null) or (state != 'CONFIRMED' and confirmed_meal_id is null))
      );
      create index meal_drafts_v2_owner_updated_idx on meal_drafts_v2(owner_id, updated_at desc, id);
      create index meal_drafts_v2_owner_state_idx on meal_drafts_v2(owner_id, state, updated_at desc, id);
      create index meal_drafts_v2_owner_date_idx on meal_drafts_v2(owner_id, local_date desc, id);

      create table meal_revisions_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        draft_id text not null references meal_drafts_v2(id) on delete cascade,
        parent_revision_id text references meal_revisions_v2(id) on delete restrict,
        revision_no integer not null check (revision_no >= 1),
        candidates_json text not null check (json_valid(candidates_json)),
        content_hash text not null check (length(content_hash) = 64),
        created_by text not null check (created_by in ('PARSER', 'OWNER', 'DATA_PROVIDER')),
        capability_run_id text,
        created_at text not null,
        unique (draft_id, revision_no)
      );
      create index meal_revisions_v2_owner_draft_idx on meal_revisions_v2(owner_id, draft_id, revision_no desc, id);

      create table nutrition_source_snapshots_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        source_kind text not null check (source_kind in ('TEST_FIXTURE', 'APPROVED_LOCAL_DATASET', 'REMOTE_API')),
        source_id text not null check (length(source_id) between 1 and 120),
        source_version text not null check (length(source_version) between 1 and 120),
        dataset_hash text not null check (length(dataset_hash) = 64),
        redistribution integer not null check (redistribution in (0, 1)),
        license_decision_id text,
        adapter_kind text not null check (adapter_kind in ('TEST_FIXTURE', 'APPROVED_LOCAL_DATASET', 'PRODUCTION_ADAPTER')),
        evidence_kind text not null check (evidence_kind in ('AUTOMATED_TEST_FIXTURE', 'APPROVED_LOCAL_DATASET', 'REAL_PROVIDER')),
        created_at text not null,
        check ((source_kind = 'TEST_FIXTURE' and redistribution = 0 and license_decision_id is null) or (source_kind != 'TEST_FIXTURE' and license_decision_id is not null)),
        unique (owner_id, source_kind, source_id, source_version, dataset_hash)
      );
      create index nutrition_source_snapshots_v2_owner_created_idx on nutrition_source_snapshots_v2(owner_id, created_at desc, id);

      create table nutrition_food_snapshots_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        draft_id text not null references meal_drafts_v2(id) on delete cascade,
        candidate_id text not null,
        source_snapshot_id text not null references nutrition_source_snapshots_v2(id) on delete restrict,
        record_id text not null check (length(record_id) between 1 and 200),
        record_hash text not null check (length(record_hash) = 64),
        display_name text not null check (length(trim(display_name)) between 1 and 120),
        serving_quantity_decimal text not null check (typeof(serving_quantity_decimal) = 'text' and length(serving_quantity_decimal) between 1 and 13 and serving_quantity_decimal not glob '*[^0-9.]*' and serving_quantity_decimal not like '%..%'),
        serving_unit text not null check (serving_unit in ('GRAM', 'MILLILITER', 'ITEM')),
        energy_kcal_decimal text not null check (typeof(energy_kcal_decimal) = 'text' and length(energy_kcal_decimal) between 1 and 13 and energy_kcal_decimal not glob '*[^0-9.]*'),
        protein_grams_decimal text not null check (typeof(protein_grams_decimal) = 'text' and length(protein_grams_decimal) between 1 and 13 and protein_grams_decimal not glob '*[^0-9.]*'),
        carbohydrate_grams_decimal text not null check (typeof(carbohydrate_grams_decimal) = 'text' and length(carbohydrate_grams_decimal) between 1 and 13 and carbohydrate_grams_decimal not glob '*[^0-9.]*'),
        fat_grams_decimal text not null check (typeof(fat_grams_decimal) = 'text' and length(fat_grams_decimal) between 1 and 13 and fat_grams_decimal not glob '*[^0-9.]*'),
        capability_run_id text,
        created_at text not null,
        unique (owner_id, draft_id, candidate_id, source_snapshot_id, record_id, record_hash)
      );
      create index nutrition_food_snapshots_v2_owner_draft_candidate_idx on nutrition_food_snapshots_v2(owner_id, draft_id, candidate_id, id);

      create table meals_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        draft_id text not null references meal_drafts_v2(id) on delete restrict,
        local_date text not null,
        energy_kcal_decimal text not null check (typeof(energy_kcal_decimal) = 'text' and length(energy_kcal_decimal) between 1 and 13 and energy_kcal_decimal not glob '*[^0-9.]*'),
        protein_grams_decimal text not null check (typeof(protein_grams_decimal) = 'text' and length(protein_grams_decimal) between 1 and 13 and protein_grams_decimal not glob '*[^0-9.]*'),
        carbohydrate_grams_decimal text not null check (typeof(carbohydrate_grams_decimal) = 'text' and length(carbohydrate_grams_decimal) between 1 and 13 and carbohydrate_grams_decimal not glob '*[^0-9.]*'),
        fat_grams_decimal text not null check (typeof(fat_grams_decimal) = 'text' and length(fat_grams_decimal) between 1 and 13 and fat_grams_decimal not glob '*[^0-9.]*'),
        calculation_version text not null check (calculation_version = 'DECIMAL_MICRO_V1'),
        version integer not null check (version = 1),
        created_at text not null,
        unique (draft_id)
      );
      create index meals_v2_owner_date_idx on meals_v2(owner_id, local_date desc, created_at desc, id);

      create table meal_entries_v2 (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        meal_id text not null references meals_v2(id) on delete cascade,
        meal_revision_id text not null references meal_revisions_v2(id) on delete restrict,
        candidate_id text not null,
        food_snapshot_id text not null references nutrition_food_snapshots_v2(id) on delete restrict,
        display_name text not null check (length(trim(display_name)) between 1 and 120),
        quantity_decimal text not null check (typeof(quantity_decimal) = 'text' and length(quantity_decimal) between 1 and 13 and quantity_decimal not glob '*[^0-9.]*'),
        unit text not null check (unit in ('GRAM', 'MILLILITER', 'ITEM')),
        energy_kcal_decimal text not null check (typeof(energy_kcal_decimal) = 'text' and length(energy_kcal_decimal) between 1 and 13 and energy_kcal_decimal not glob '*[^0-9.]*'),
        protein_grams_decimal text not null check (typeof(protein_grams_decimal) = 'text' and length(protein_grams_decimal) between 1 and 13 and protein_grams_decimal not glob '*[^0-9.]*'),
        carbohydrate_grams_decimal text not null check (typeof(carbohydrate_grams_decimal) = 'text' and length(carbohydrate_grams_decimal) between 1 and 13 and carbohydrate_grams_decimal not glob '*[^0-9.]*'),
        fat_grams_decimal text not null check (typeof(fat_grams_decimal) = 'text' and length(fat_grams_decimal) between 1 and 13 and fat_grams_decimal not glob '*[^0-9.]*'),
        created_at text not null,
        unique (meal_id, candidate_id)
      );
      create index meal_entries_v2_owner_meal_idx on meal_entries_v2(owner_id, meal_id, id);

      create table v07_idempotency_records (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        idempotency_key text not null,
        operation text not null check (operation in (
          'fitness.check_in.create', 'fitness.workout.create', 'fitness.workout.revise',
          'fitness.workout.propose', 'fitness.workout.feedback', 'nutrition.meal_draft.create',
          'nutrition.meal_draft.revise', 'nutrition.meal_draft.match', 'nutrition.meal.confirm'
        )),
        resource_id text not null,
        request_hash text not null check (length(request_hash) = 64),
        state text not null check (state in ('CLAIMED', 'SUCCEEDED', 'FAILED')),
        lease_token text,
        lease_expires_at text,
        response_status integer check (response_status is null or response_status between 200 and 599),
        response_json text check (response_json is null or json_valid(response_json)),
        created_at text not null,
        updated_at text not null,
        unique (owner_id, idempotency_key)
      );
      create index v07_idempotency_records_owner_state_idx on v07_idempotency_records(owner_id, state, updated_at desc, id);

      create table v07_capability_runs (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        capability text not null check (capability in ('WORKOUT_TEXT_SELECTION', 'MEAL_CANDIDATE_PARSE', 'NUTRITION_DATA_LOOKUP')),
        operation text not null check (length(operation) between 1 and 120),
        resource_id text not null,
        provider_id text,
        provider_label text not null check (length(provider_label) between 1 and 120),
        adapter_kind text not null check (adapter_kind in ('NONE', 'TEST_FIXTURE', 'APPROVED_LOCAL_DATASET', 'PRODUCTION_ADAPTER')),
        evidence_kind text not null check (evidence_kind in ('NONE', 'AUTOMATED_TEST_FIXTURE', 'APPROVED_LOCAL_DATASET', 'REAL_PROVIDER')),
        disclosure_json text not null check (json_valid(disclosure_json)),
        disclosure_version text not null check (disclosure_version = 'HEALTH_DISCLOSURE_V1'),
        idempotency_key text,
        request_hash text check (request_hash is null or length(request_hash) = 64),
        state text not null check (state in ('BLOCKED_PROVIDER', 'AWAITING_DISCLOSURE', 'RUNNING', 'SUCCEEDED', 'FAILED')),
        lease_token text,
        lease_expires_at text,
        deadline_at text,
        policy_version text not null check (policy_version = 'HEALTH_CAPABILITY_POLICY_V1'),
        local_date text not null,
        reserved_calls integer not null default 0 check (reserved_calls between 0 and 5),
        actual_calls integer not null default 0 check (actual_calls between 0 and 5),
        input_bytes integer not null default 0 check (input_bytes between 0 and 24000),
        output_bytes integer not null default 0 check (output_bytes between 0 and 12000),
        failure_code text,
        nutrition_source_version text,
        nutrition_dataset_hash text check (nutrition_dataset_hash is null or length(nutrition_dataset_hash) = 64),
        app_version text not null check (length(app_version) between 5 and 64),
        created_at text not null,
        updated_at text not null,
        version integer not null check (version >= 1)
      );
      create unique index v07_capability_runs_owner_idempotency_idx on v07_capability_runs(owner_id, idempotency_key) where idempotency_key is not null;
      create index v07_capability_runs_owner_date_capability_idx on v07_capability_runs(owner_id, local_date, capability, state, created_at);

      create table v07_audit_events (
        id text primary key,
        owner_id text not null references owners(id) on delete cascade,
        event_type text not null check (length(event_type) between 1 and 120),
        entity_type text not null check (length(entity_type) between 1 and 120),
        entity_id text not null,
        entity_version integer not null check (entity_version >= 1),
        metadata_json text not null check (json_valid(metadata_json)),
        created_at text not null
      );
      create index v07_audit_events_owner_entity_idx on v07_audit_events(owner_id, entity_type, entity_id, created_at desc, id);

      create trigger fitness_check_ins_v2_immutable_update before update on fitness_check_ins_v2 begin select raise(abort, 'fitness check-ins are immutable'); end;
      create trigger fitness_check_ins_v2_immutable_delete before delete on fitness_check_ins_v2 begin select raise(abort, 'fitness check-ins are immutable'); end;
      create trigger workout_revisions_v2_immutable_update before update on workout_revisions_v2 begin select raise(abort, 'workout revisions are immutable'); end;
      create trigger workout_revisions_v2_immutable_delete before delete on workout_revisions_v2 begin select raise(abort, 'workout revisions are immutable'); end;
      create trigger workout_revision_citations_v2_immutable_update before update on workout_revision_citations_v2 begin select raise(abort, 'workout citations are immutable'); end;
      create trigger workout_revision_citations_v2_immutable_delete before delete on workout_revision_citations_v2 begin select raise(abort, 'workout citations are immutable'); end;
      create trigger workout_actions_v2_immutable_update before update on workout_actions_v2 begin select raise(abort, 'workout action links are immutable'); end;
      create trigger workout_actions_v2_immutable_delete before delete on workout_actions_v2 begin select raise(abort, 'workout action links are immutable'); end;
      create trigger workout_feedback_v2_immutable_update before update on workout_feedback_v2 begin select raise(abort, 'workout feedback is immutable'); end;
      create trigger workout_feedback_v2_immutable_delete before delete on workout_feedback_v2 begin select raise(abort, 'workout feedback is immutable'); end;
      create trigger meal_revisions_v2_immutable_update before update on meal_revisions_v2 begin select raise(abort, 'meal revisions are immutable'); end;
      create trigger meal_revisions_v2_immutable_delete before delete on meal_revisions_v2 begin select raise(abort, 'meal revisions are immutable'); end;
      create trigger nutrition_source_snapshots_v2_immutable_update before update on nutrition_source_snapshots_v2 begin select raise(abort, 'nutrition sources are immutable'); end;
      create trigger nutrition_source_snapshots_v2_immutable_delete before delete on nutrition_source_snapshots_v2 begin select raise(abort, 'nutrition sources are immutable'); end;
      create trigger nutrition_food_snapshots_v2_immutable_update before update on nutrition_food_snapshots_v2 begin select raise(abort, 'nutrition food snapshots are immutable'); end;
      create trigger nutrition_food_snapshots_v2_immutable_delete before delete on nutrition_food_snapshots_v2 begin select raise(abort, 'nutrition food snapshots are immutable'); end;
      create trigger meals_v2_immutable_update before update on meals_v2 begin select raise(abort, 'meals are immutable'); end;
      create trigger meals_v2_immutable_delete before delete on meals_v2 begin select raise(abort, 'meals are immutable'); end;
      create trigger meal_entries_v2_immutable_update before update on meal_entries_v2 begin select raise(abort, 'meal entries are immutable'); end;
      create trigger meal_entries_v2_immutable_delete before delete on meal_entries_v2 begin select raise(abort, 'meal entries are immutable'); end;
      create trigger v07_audit_events_immutable_update before update on v07_audit_events begin select raise(abort, 'v07 audit events are immutable'); end;
      create trigger v07_audit_events_immutable_delete before delete on v07_audit_events begin select raise(abort, 'v07 audit events are immutable'); end;
    `,
  },
  {
    version: 21,
    name: 'enforce_v07_owner_lineage',
    sql: `
      -- SQLite cannot add composite foreign keys to existing v20 tables without
      -- rebuilding them. Keep v20 byte-for-byte compatible and enforce the same
      -- owner-correlated parent relation for all new writes with additive indexes
      -- and triggers.
      create unique index signals_v21_id_owner_uidx on signals(id, owner_id);
      create unique index fitness_check_ins_v2_v21_id_owner_uidx on fitness_check_ins_v2(id, owner_id);
      create unique index workouts_v2_v21_id_owner_uidx on workouts_v2(id, owner_id);
      create unique index workout_revisions_v2_v21_id_owner_uidx on workout_revisions_v2(id, owner_id);
      create unique index proposals_v21_id_owner_uidx on proposals(id, owner_id);
      create unique index actions_v21_id_owner_uidx on actions(id, owner_id);
      create unique index time_requests_v21_id_owner_uidx on time_requests(id, owner_id);
      create unique index activity_sessions_v21_id_owner_uidx on activity_sessions(id, owner_id);
      create unique index workout_feedback_v2_v21_id_owner_uidx on workout_feedback_v2(id, owner_id);
      create unique index meal_drafts_v2_v21_id_owner_uidx on meal_drafts_v2(id, owner_id);
      create unique index meal_revisions_v2_v21_id_owner_uidx on meal_revisions_v2(id, owner_id);
      create unique index nutrition_source_snapshots_v2_v21_id_owner_uidx on nutrition_source_snapshots_v2(id, owner_id);
      create unique index nutrition_food_snapshots_v2_v21_id_owner_uidx on nutrition_food_snapshots_v2(id, owner_id);
      create unique index meals_v2_v21_id_owner_uidx on meals_v2(id, owner_id);
      create unique index v07_capability_runs_v21_id_owner_uidx on v07_capability_runs(id, owner_id);

      create trigger fitness_check_ins_v2_v21_owner_insert
      before insert on fitness_check_ins_v2
      begin
        select case when not exists (
          select 1 from signals where id = new.signal_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger workouts_v2_v21_owner_insert
      before insert on workouts_v2
      begin
        select case when not exists (
          select 1 from fitness_check_ins_v2 where id = new.check_in_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from signals where id = new.signal_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.current_revision_id is not null and not exists (
          select 1 from workout_revisions_v2
          where id = new.current_revision_id and owner_id = new.owner_id and workout_id = new.id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.proposal_id is not null and not exists (
          select 1 from proposals where id = new.proposal_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.action_id is not null and not exists (
          select 1 from actions where id = new.action_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.time_request_id is not null and not exists (
          select 1 from time_requests where id = new.time_request_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.feedback_id is not null and not exists (
          select 1 from workout_feedback_v2
          where id = new.feedback_id and owner_id = new.owner_id and workout_id = new.id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger workouts_v2_v21_owner_update
      before update of owner_id, check_in_id, signal_id, current_revision_id, proposal_id, action_id, time_request_id, feedback_id on workouts_v2
      begin
        select case when new.owner_id <> old.owner_id
          then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from fitness_check_ins_v2 where id = new.check_in_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from signals where id = new.signal_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.current_revision_id is not null and not exists (
          select 1 from workout_revisions_v2
          where id = new.current_revision_id and owner_id = new.owner_id and workout_id = new.id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.proposal_id is not null and not exists (
          select 1 from proposals where id = new.proposal_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.action_id is not null and not exists (
          select 1 from actions where id = new.action_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.time_request_id is not null and not exists (
          select 1 from time_requests where id = new.time_request_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.feedback_id is not null and not exists (
          select 1 from workout_feedback_v2
          where id = new.feedback_id and owner_id = new.owner_id and workout_id = new.id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger workout_revisions_v2_v21_owner_insert
      before insert on workout_revisions_v2
      begin
        select case when not exists (
          select 1 from workouts_v2 where id = new.workout_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.parent_revision_id is not null and not exists (
          select 1 from workout_revisions_v2
          where id = new.parent_revision_id and owner_id = new.owner_id and workout_id = new.workout_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.capability_run_id is not null and not exists (
          select 1 from v07_capability_runs where id = new.capability_run_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger workout_revision_citations_v2_v21_owner_insert
      before insert on workout_revision_citations_v2
      begin
        select case when not exists (
          select 1 from workout_revisions_v2 where id = new.revision_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger workout_actions_v2_v21_owner_insert
      before insert on workout_actions_v2
      begin
        select case when not exists (
          select 1 from workouts_v2 where id = new.workout_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from workout_revisions_v2
          where id = new.revision_id and owner_id = new.owner_id and workout_id = new.workout_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from actions where id = new.action_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger workout_feedback_v2_v21_owner_insert
      before insert on workout_feedback_v2
      begin
        select case when not exists (
          select 1 from workouts_v2 where id = new.workout_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from actions where id = new.action_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.activity_session_id is not null and not exists (
          select 1 from activity_sessions
          where id = new.activity_session_id and owner_id = new.owner_id and action_id = new.action_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger meal_drafts_v2_v21_owner_insert
      before insert on meal_drafts_v2
      begin
        select case when new.current_revision_id is not null and not exists (
          select 1 from meal_revisions_v2
          where id = new.current_revision_id and owner_id = new.owner_id and draft_id = new.id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.confirmed_meal_id is not null and not exists (
          select 1 from meals_v2
          where id = new.confirmed_meal_id and owner_id = new.owner_id and draft_id = new.id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger meal_drafts_v2_v21_owner_update
      before update of owner_id, current_revision_id, confirmed_meal_id on meal_drafts_v2
      begin
        select case when new.owner_id <> old.owner_id
          then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.current_revision_id is not null and not exists (
          select 1 from meal_revisions_v2
          where id = new.current_revision_id and owner_id = new.owner_id and draft_id = new.id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.confirmed_meal_id is not null and not exists (
          select 1 from meals_v2
          where id = new.confirmed_meal_id and owner_id = new.owner_id and draft_id = new.id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger meal_revisions_v2_v21_owner_insert
      before insert on meal_revisions_v2
      begin
        select case when not exists (
          select 1 from meal_drafts_v2 where id = new.draft_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.parent_revision_id is not null and not exists (
          select 1 from meal_revisions_v2
          where id = new.parent_revision_id and owner_id = new.owner_id and draft_id = new.draft_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.capability_run_id is not null and not exists (
          select 1 from v07_capability_runs where id = new.capability_run_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger nutrition_food_snapshots_v2_v21_owner_insert
      before insert on nutrition_food_snapshots_v2
      begin
        select case when not exists (
          select 1 from meal_drafts_v2 where id = new.draft_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from nutrition_source_snapshots_v2
          where id = new.source_snapshot_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when new.capability_run_id is not null and not exists (
          select 1 from v07_capability_runs where id = new.capability_run_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger meals_v2_v21_owner_insert
      before insert on meals_v2
      begin
        select case when not exists (
          select 1 from meal_drafts_v2 where id = new.draft_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger meal_entries_v2_v21_owner_insert
      before insert on meal_entries_v2
      begin
        select case when not exists (
          select 1 from meals_v2 where id = new.meal_id and owner_id = new.owner_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from meal_revisions_v2
          join meals_v2 on meals_v2.id = new.meal_id
          where meal_revisions_v2.id = new.meal_revision_id
            and meal_revisions_v2.owner_id = new.owner_id
            and meal_revisions_v2.draft_id = meals_v2.draft_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
        select case when not exists (
          select 1 from nutrition_food_snapshots_v2
          join meals_v2 on meals_v2.id = new.meal_id
          where nutrition_food_snapshots_v2.id = new.food_snapshot_id
            and nutrition_food_snapshots_v2.owner_id = new.owner_id
            and nutrition_food_snapshots_v2.draft_id = meals_v2.draft_id
        ) then raise(abort, 'v0.7 owner lineage violation') end;
      end;

      create trigger v07_idempotency_records_v21_owner_immutable
      before update of owner_id on v07_idempotency_records
      when new.owner_id <> old.owner_id
      begin
        select raise(abort, 'v0.7 owner lineage violation');
      end;

      create trigger v07_capability_runs_v21_owner_immutable
      before update of owner_id on v07_capability_runs
      when new.owner_id <> old.owner_id
      begin
        select raise(abort, 'v0.7 owner lineage violation');
      end;
    `,
  },
];

export function runMigrations(
  database: Database.Database,
  targetVersion?: number,
): void {
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
    if (targetVersion !== undefined && migration.version > targetVersion) {
      continue;
    }

    if (!applied.has(migration.version)) {
      applyMigration(migration);
    }
  }
}
