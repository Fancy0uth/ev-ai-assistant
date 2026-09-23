import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  restoreSqliteOnlyBackup,
  verifySqliteOnlyBackup,
} from '../src/storage/backup-service';
import { runBackupCli } from '../src/cli/backup';
import { openDatabase } from '../src/storage/database';

describe('V9-03 SQLite-only consistent backup and isolated restore', () => {
  let directory: string;
  let activeDatabase: Database.Database | undefined;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v9-backup-'));
  });

  afterEach(() => {
    activeDatabase?.close();
    activeDatabase = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  it('backs up a live WAL snapshot, verifies and restores it in isolation, then rejects tampering and an active overlap without changing the source or backup', async () => {
    const dataDirectory = join(directory, 'active-data');
    const activeDatabasePath = join(dataDirectory, 'app.sqlite');
    const backupDirectory = join(directory, 'sqlite-only-backup');
    const restoreDirectory = join(directory, 'isolated-restore');
    const activeOverlapDirectory = join(dataDirectory, 'must-not-be-created');
    mkdirSync(dataDirectory);

    activeDatabase = openDatabase(activeDatabasePath);
    activeDatabase
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run('v9-owner', 'v9-owner', 'synthetic-password-hash', '2026-09-08T00:00:00.000Z');
    activeDatabase
      .prepare(
        `insert into tasks (
          id, owner_id, title, area, priority, status, target_date, completed_at,
          version, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'v9-task',
        'v9-owner',
        'Preserve WAL task',
        'WORK',
        'HIGH',
        'IN_PROGRESS',
        '2026-09-09',
        null,
        1,
        '2026-09-08T00:00:00.000Z',
        '2026-09-08T00:00:00.000Z',
      );
    activeDatabase
      .prepare(
        `insert into agent_runs (
          id, owner_id, provider_key, capability, status, context_json, output_json,
          failure_code, created_at, updated_at
        ) values (?, ?, 'CODEX_LOCAL', 'LIFE_PLANNING', 'SUCCEEDED', '{}', '{}', null, ?, ?)`,
      )
      .run('v9-agent-run', 'v9-owner', '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z');

    const activeWalPath = `${activeDatabasePath}-wal`;
    expect(existsSync(activeWalPath)).toBe(true);
    expect(readFileSync(activeWalPath).byteLength).toBeGreaterThan(0);
    const sourceDatabaseBefore = readFileSync(activeDatabasePath);
    const sourceWalBefore = readFileSync(activeWalPath);

    const created = await runBackupCli([
      'create',
      '--data-dir',
      dataDirectory,
      '--backup-dir',
      backupDirectory,
    ]);
    expect(created).toEqual({ code: 'SQLITE_ONLY_BACKUP_CREATED' });

    const verified = await verifySqliteOnlyBackup({ backupDirectory });
    expect(verified.status).toBe('verified');
    expect(verified.manifest).toMatchObject({
      formatVersion: 1,
      scope: 'SQLITE_ONLY',
      schemaVersion: 26,
      database: { file: 'app.sqlite' },
      ownerCount: 1,
      counts: { owners: 1, tasks: 1, agent_runs: 1 },
      quickCheck: 'ok',
      includes: ['sqlite'],
      excludes: [
        'artifacts',
        'memory-projections',
        'runtime-logs',
        'dpapi-user-context',
        'external-project-files',
      ],
    });
    expect(verified.manifest.database.bytes).toBeGreaterThan(0);
    expect(verified.manifest.database.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readdirSync(backupDirectory).sort()).toEqual(['app.sqlite', 'manifest.json']);

    const restored = await restoreSqliteOnlyBackup({
      activeDatabasePath,
      backupDirectory,
      restoreDirectory,
    });
    expect(restored).toEqual({ status: 'restored', manifest: verified.manifest });
    expect(readdirSync(restoreDirectory).sort()).toEqual(['app.sqlite']);
    const restoredDatabase = new Database(join(restoreDirectory, 'app.sqlite'), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(restoredDatabase.prepare('select id from owners').all()).toEqual([{ id: 'v9-owner' }]);
      expect(restoredDatabase.prepare('select id from tasks').all()).toEqual([{ id: 'v9-task' }]);
      expect(restoredDatabase.prepare('select id from agent_runs').all()).toEqual([{ id: 'v9-agent-run' }]);
      expect(restoredDatabase.prepare('select count(*) as count from schema_migrations').get()).toEqual({ count: 26 });
    } finally {
      restoredDatabase.close();
    }

    const backupDatabasePath = join(backupDirectory, 'app.sqlite');
    const backupManifestPath = join(backupDirectory, 'manifest.json');
    const backupDatabaseBefore = readFileSync(backupDatabasePath);
    const backupManifestBefore = readFileSync(backupManifestPath);
    await expect(
      restoreSqliteOnlyBackup({
        activeDatabasePath,
        backupDirectory,
        restoreDirectory: activeOverlapDirectory,
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_PATH_OVERLAP' });
    expect(existsSync(activeOverlapDirectory)).toBe(false);
    expect(readFileSync(activeDatabasePath)).toEqual(sourceDatabaseBefore);
    expect(readFileSync(activeWalPath)).toEqual(sourceWalBefore);
    expect(readFileSync(backupDatabasePath)).toEqual(backupDatabaseBefore);
    expect(readFileSync(backupManifestPath)).toEqual(backupManifestBefore);

    const tampered = Buffer.from(backupDatabaseBefore);
    tampered[tampered.byteLength - 1] = tampered[tampered.byteLength - 1]! ^ 0x01;
    writeFileSync(backupDatabasePath, tampered);
    await expect(verifySqliteOnlyBackup({ backupDirectory })).rejects.toMatchObject({
      code: 'BACKUP_INTEGRITY_MISMATCH',
    });
  }, 15_000);
});
