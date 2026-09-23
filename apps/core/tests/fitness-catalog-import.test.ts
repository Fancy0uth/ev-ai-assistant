import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import {
  importFitnessCatalog,
  runFitnessCatalogImportCli,
} from '../src/cli/fitness-catalog';
import { runMigrations } from '../src/storage/migrations';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('imports two synthetic text records into a v28 database, replays through the CLI, and rejects changed content for the same revision without partial rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ev-fitness-catalog-import-'));
  directories.push(directory);
  const dataDir = join(directory, 'catalog-data');
  const databasePath = join(dataDir, 'app.sqlite');
  const jsonFile = join(directory, 'synthetic-exercises.json');
  const revision = '0123456789abcdef0123456789abcdef01234567';
  const records = [
    {
      id: '0001',
      name: 'Synthetic push-up',
      body_part: 'chest',
      equipment: 'body weight',
      target: 'pectorals',
      secondary_muscles: ['triceps'],
      instructions: { en: 'Start in a high plank.', zh: '从高平板支撑开始。' },
      video: 'synthetic-media-reference-not-read',
    },
    {
      id: '0002',
      name: 'Synthetic squat',
      body_part: 'upper legs',
      equipment: 'body weight',
      target: 'quadriceps',
      secondary_muscles: ['glutes'],
      instructions: { en: 'Stand and lower with control.', zh: '站立后控制下蹲。' },
      video: 'synthetic-media-reference-not-read',
    },
  ];

  mkdirSync(dataDir);
  const migrated = new Database(databasePath);
  try {
    migrated.pragma('foreign_keys = ON');
    runMigrations(migrated, 28);
  } finally {
    migrated.close();
  }
  writeFileSync(jsonFile, JSON.stringify(records), 'utf8');

  const first = importFitnessCatalog({ dataDir, jsonFile, revision });
  expect(first).toMatchObject({
    code: 'FITNESS_CATALOG_IMPORTED',
    revision,
    itemCount: 2,
    catalogHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });

  const cliPath = fileURLToPath(new URL('../src/cli/fitness-catalog.ts', import.meta.url));
  const argumentsForImport = [
    'import',
    '--data-dir', dataDir,
    '--json-file', jsonFile,
    '--revision', revision,
  ];
  const replay = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...argumentsForImport], {
    encoding: 'utf8',
  });
  expect(replay.error).toBeUndefined();
  expect(replay.status).toBe(0);
  expect(replay.stderr).toBe('');
  expect(JSON.parse(replay.stdout)).toEqual({
    code: 'FITNESS_CATALOG_REPLAYED',
    revision,
    itemCount: 2,
    catalogHash: first.catalogHash,
  });
  expect(replay.stdout).not.toContain(directory);

  writeFileSync(jsonFile, JSON.stringify([
    { ...records[0], name: 'Synthetic push-up changed' },
    records[1],
  ]), 'utf8');
  let conflict: unknown;
  try {
    runFitnessCatalogImportCli(argumentsForImport);
  } catch (error) {
    conflict = error;
  }
  expect(conflict).toMatchObject({
    code: 'FITNESS_CATALOG_IMPORT_REVISION_CONFLICT',
    statusCode: 409,
  });

  const rejected = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...argumentsForImport], {
    encoding: 'utf8',
  });
  expect(rejected.error).toBeUndefined();
  expect(rejected.status).toBe(1);
  expect(rejected.stdout).toBe('');
  expect(JSON.parse(rejected.stderr)).toEqual({ code: 'FITNESS_CATALOG_IMPORT_REVISION_CONFLICT' });
  expect(rejected.stderr).not.toContain(directory);
  expect(rejected.stderr).not.toContain('Synthetic push-up changed');

  const inspected = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    expect(inspected.prepare(`select source_id as sourceId, revision, license_id as licenseId,
      notice_ref as noticeRef, item_count as itemCount, catalog_hash as catalogHash
      from fitness_catalog_snapshots`).all()).toEqual([{
      sourceId: 'hasaneyldrm/exercises-dataset',
      revision,
      licenseId: 'MIT',
      noticeRef: 'UPSTREAM_NOTICE_MEDIA_NOT_IMPORTED',
      itemCount: 2,
      catalogHash: first.catalogHash,
    }]);
    expect(inspected.prepare(`select upstream_id as upstreamId, name, safety_review as safetyReview
      from fitness_catalog_items order by upstream_id`).all()).toEqual([
      { upstreamId: '0001', name: 'Synthetic push-up', safetyReview: 'UNREVIEWED' },
      { upstreamId: '0002', name: 'Synthetic squat', safetyReview: 'UNREVIEWED' },
    ]);
    expect(inspected.prepare('select count(*) as count from fitness_catalog_reviews').get()).toEqual({ count: 0 });
    expect(inspected.prepare('select version from schema_migrations where version = 28').get()).toEqual({ version: 28 });
  } finally {
    inspected.close();
  }
});
