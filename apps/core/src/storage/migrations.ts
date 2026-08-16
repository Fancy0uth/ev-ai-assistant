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
