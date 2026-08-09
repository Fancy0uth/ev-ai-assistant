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
        title text not null check (length(trim(title)) between 1 and 80),
        created_at text not null,
        updated_at text not null
      );

      create index agent_sessions_owner_updated_at_idx on agent_sessions(owner_id, updated_at);

      create table agent_messages (
        id text not null primary key,
        session_id text not null references agent_sessions(id) on delete cascade,
        role text not null check (role in ('USER', 'ASSISTANT')),
        content text not null check (length(trim(content)) between 1 and 8000),
        created_at text not null
      );

      create index agent_messages_session_created_at_id_idx
        on agent_messages(session_id, created_at, id);
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
