import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryService } from '../src/modules/memory/service';
import { createProjectSnapshot } from '../src/modules/projects/snapshot';
import { createProjectBrief } from '../src/modules/projects/service';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000401';

describe('local inspectable memory', () => {
  let database: Database.Database;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-memory-'));
    database = openDatabase(join(directory, 'app.sqlite'));
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, '记忆主人', 'not-used', '2026-08-17T00:00:00.000Z');
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps revisions in SQLite and atomically projects the current Memory Markdown', () => {
    const memory = createMemoryService(database, join(directory, 'memory'));
    const first = memory.write(ownerId, 'FITNESS', '当前膝盖无不适，训练偏好为晚间。');
    const second = memory.write(ownerId, 'FITNESS', '本周将下肢训练降低到中等强度。');

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(readFileSync(join(directory, 'memory', 'FITNESS', 'MEMORY.md'), 'utf8')).toContain(
      '本周将下肢训练降低到中等强度。',
    );
    const restored = memory.restore(ownerId, 'FITNESS', 1);
    expect(restored.version).toBe(3);
    expect(memory.read(ownerId, 'FITNESS')?.content).toContain('当前膝盖无不适');
  });
});

describe('read-only project snapshots', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-project-snapshot-'));
    writeFileSync(join(directory, 'PRD.md'), '# My Project\n\nBuild a local assistant.');
    writeFileSync(join(directory, 'TASKS.md'), '# Tasks\n\n- [ ] Build read-only snapshot');
    writeFileSync(join(directory, '.env'), 'REAL_SECRET=must-not-enter-snapshot');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads allowlisted project planning files without mutating the project or exposing .env', () => {
    const before = readFileSync(join(directory, 'PRD.md'), 'utf8');
    const snapshot = createProjectSnapshot(directory);

    expect(snapshot.files).toEqual([
      expect.objectContaining({ relativePath: 'PRD.md', content: before }),
      expect.objectContaining({ relativePath: 'TASKS.md' }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('REAL_SECRET');
    expect(readFileSync(join(directory, 'PRD.md'), 'utf8')).toBe(before);
    expect(createProjectBrief(directory)).toMatchObject({ status: 'PROVIDER_NOT_CONFIGURED' });
  });
});
