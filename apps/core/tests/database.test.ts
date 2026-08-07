import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/database';

describe('SQLite lifecycle', () => {
  let testDirectory: string;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-db-'));
  });

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true });
  });

  it('applies the initial schema once and persists data across reopen', () => {
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
    expect(migrations).toEqual({ count: 1 });
    second.close();
  });

  it('enables WAL, foreign keys and a five-second busy timeout', () => {
    const database = openDatabase(join(testDirectory, 'app.sqlite'));

    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);

    database.close();
  });
});
