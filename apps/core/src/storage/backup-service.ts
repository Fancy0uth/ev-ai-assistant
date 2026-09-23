import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { APP_VERSION } from '@ev/contracts';
import Database from 'better-sqlite3';
import {
  assertPrivateDirectory,
  createPrivateDirectory,
  PrivateDirectoryError,
  type PrivateDirectoryErrorCode,
} from '../filesystem/private-directory';
import {
  isPathInsideRoot,
  resolveUnlinkedExistingDirectory,
  samePhysicalPath,
} from '../filesystem/path-containment';
import { latestSchemaVersion } from './migrations';

export const SQLITE_BACKUP_DATABASE_FILE = 'app.sqlite' as const;
export const SQLITE_BACKUP_MANIFEST_FILE = 'manifest.json' as const;
export const SQLITE_BACKUP_SCOPE = 'SQLITE_ONLY' as const;
export const SQLITE_BACKUP_INCLUDES = ['sqlite'] as const;
export const SQLITE_BACKUP_EXCLUDES = [
  'artifacts',
  'memory-projections',
  'runtime-logs',
  'dpapi-user-context',
  'external-project-files',
] as const;

const COUNTED_TABLES = ['owners', 'tasks', 'agent_runs'] as const;
const MAX_MANIFEST_BYTES = 8 * 1024;
const MAX_APP_VERSION_LENGTH = 64;
const UTC_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const APP_VERSION_VALUE = /^[0-9]+(?:\.[0-9]+){2}(?:[-+][0-9A-Za-z.-]+)?$/;
const SQLITE_FILE_HEADER = Buffer.from('SQLite format 3\u0000', 'ascii');

export interface SqliteBackupCounts {
  owners: number;
  tasks: number;
  agent_runs: number;
}

export interface SqliteOnlyBackupManifest {
  formatVersion: 1;
  scope: typeof SQLITE_BACKUP_SCOPE;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  database: {
    file: typeof SQLITE_BACKUP_DATABASE_FILE;
    bytes: number;
    sha256: string;
  };
  ownerCount: number;
  counts: SqliteBackupCounts;
  quickCheck: 'ok';
  includes: readonly ['sqlite'];
  excludes: typeof SQLITE_BACKUP_EXCLUDES;
}

export interface CreateSqliteOnlyBackupInput {
  activeDatabasePath: string;
  backupDirectory: string;
}

export interface VerifySqliteOnlyBackupInput {
  backupDirectory: string;
}

export interface RestoreSqliteOnlyBackupInput {
  activeDatabasePath: string;
  backupDirectory: string;
  restoreDirectory: string;
}

export interface CreatedSqliteOnlyBackup {
  status: 'created';
  manifest: SqliteOnlyBackupManifest;
}

export interface VerifiedSqliteOnlyBackup {
  status: 'verified';
  manifest: SqliteOnlyBackupManifest;
}

export interface RestoredSqliteOnlyBackup {
  status: 'restored';
  manifest: SqliteOnlyBackupManifest;
}

export const backupServiceErrorCodes = [
  'BACKUP_PATH_INVALID',
  'BACKUP_SOURCE_INVALID',
  'BACKUP_DIRECTORY_INVALID',
  'BACKUP_TARGET_EXISTS',
  'BACKUP_TARGET_INVALID',
  'BACKUP_PATH_OVERLAP',
  'BACKUP_SNAPSHOT_FAILED',
  'BACKUP_SNAPSHOT_INVALID',
  'BACKUP_LAYOUT_INVALID',
  'BACKUP_MANIFEST_TOO_LARGE',
  'BACKUP_MANIFEST_INVALID',
  'BACKUP_MANIFEST_WRITE_FAILED',
  'BACKUP_SCHEMA_UNSUPPORTED',
  'BACKUP_INTEGRITY_MISMATCH',
  'BACKUP_RESTORE_COPY_FAILED',
] as const;

export type BackupServiceErrorCode =
  | (typeof backupServiceErrorCodes)[number]
  | PrivateDirectoryErrorCode;

export class BackupServiceError extends Error {
  readonly code: BackupServiceErrorCode;

  constructor(code: BackupServiceErrorCode) {
    super(code);
    this.name = 'BackupServiceError';
    this.code = code;
  }
}

interface FileInspection {
  bytes: number;
}

interface SnapshotFacts {
  schemaVersion: number;
  ownerCount: number;
  counts: SqliteBackupCounts;
  quickCheck: 'ok';
}

interface SnapshotInspection extends SnapshotFacts {
  bytes: number;
  sha256: string;
}

function fail(code: BackupServiceErrorCode): never {
  throw new BackupServiceError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function normalizeAbsoluteLocalPath(value: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    fail('BACKUP_PATH_INVALID');
  }
  if (
    process.platform === 'win32'
    && (value.startsWith('\\\\') || value.startsWith('//') || !/^[A-Za-z]:[\\/]/.test(value))
  ) {
    fail('BACKUP_PATH_INVALID');
  }

  const normalized = resolve(value);
  if (samePhysicalPath(normalized, parse(normalized).root)) {
    fail('BACKUP_PATH_INVALID');
  }
  return normalized;
}

function resolveExistingUnlinkedDirectory(path: string, code: BackupServiceErrorCode): string {
  const normalized = normalizeAbsoluteLocalPath(path);
  try {
    const physicalPath = resolveUnlinkedExistingDirectory(normalized);
    if (!samePhysicalPath(physicalPath, normalized)) {
      fail(code);
    }
    return normalized;
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    fail(code);
  }
}

function inspectRegularFile(path: string, code: BackupServiceErrorCode): FileInspection {
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) fail(code);
    const details = statSync(path);
    if (!details.isFile() || details.nlink !== 1 || !Number.isSafeInteger(details.size) || details.size <= 0) {
      fail(code);
    }
    if (!samePhysicalPath(realpathSync.native(path), path)) {
      fail(code);
    }
    return { bytes: details.size };
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    fail(code);
  }
}

function resolveActiveDatabase(path: string): string {
  const normalized = normalizeAbsoluteLocalPath(path);
  resolveExistingUnlinkedDirectory(dirname(normalized), 'BACKUP_SOURCE_INVALID');
  inspectRegularFile(normalized, 'BACKUP_SOURCE_INVALID');
  return normalized;
}

function pathsOverlap(left: string, right: string): boolean {
  return samePhysicalPath(left, right)
    || isPathInsideRoot(left, right)
    || isPathInsideRoot(right, left);
}

function resolveNewIsolatedDirectory(path: string, protectedPaths: readonly string[]): string {
  const normalized = normalizeAbsoluteLocalPath(path);
  if (existsSync(normalized)) {
    fail('BACKUP_TARGET_EXISTS');
  }
  resolveExistingUnlinkedDirectory(dirname(normalized), 'BACKUP_TARGET_INVALID');
  if (protectedPaths.some((protectedPath) => pathsOverlap(normalized, protectedPath))) {
    fail('BACKUP_PATH_OVERLAP');
  }
  return normalized;
}

function assertPrivateBackupDirectory(path: string): string {
  const directory = resolveExistingUnlinkedDirectory(path, 'BACKUP_DIRECTORY_INVALID');
  try {
    assertPrivateDirectory(directory);
  } catch (error) {
    if (error instanceof PrivateDirectoryError) {
      throw new BackupServiceError(error.code);
    }
    fail('BACKUP_DIRECTORY_INVALID');
  }
  return directory;
}

function createPrivateBackupDirectory(path: string): void {
  try {
    createPrivateDirectory(path);
  } catch (error) {
    if (error instanceof PrivateDirectoryError) {
      throw new BackupServiceError(error.code);
    }
    fail('BACKUP_TARGET_INVALID');
  }
}

function assertExactDirectoryEntries(directory: string, expectedEntries: readonly string[]): void {
  try {
    const actual = readdirSync(directory).sort();
    const expected = [...expectedEntries].sort();
    if (
      actual.length !== expected.length
      || actual.some((entry, index) => entry !== expected[index])
    ) {
      fail('BACKUP_LAYOUT_INVALID');
    }
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    fail('BACKUP_LAYOUT_INVALID');
  }
}

function parseBoundedCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  return value;
}

function parseManifest(value: unknown): SqliteOnlyBackupManifest {
  if (!isRecord(value) || !hasExactKeys(value, [
    'formatVersion',
    'scope',
    'createdAt',
    'appVersion',
    'schemaVersion',
    'database',
    'ownerCount',
    'counts',
    'quickCheck',
    'includes',
    'excludes',
  ])) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  if (value.formatVersion !== 1 || value.scope !== SQLITE_BACKUP_SCOPE || value.quickCheck !== 'ok') {
    fail('BACKUP_MANIFEST_INVALID');
  }
  if (
    typeof value.createdAt !== 'string'
    || !UTC_ISO_INSTANT.test(value.createdAt)
    || Number.isNaN(Date.parse(value.createdAt))
    || new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  if (
    typeof value.appVersion !== 'string'
    || value.appVersion.length === 0
    || value.appVersion.length > MAX_APP_VERSION_LENGTH
    || !APP_VERSION_VALUE.test(value.appVersion)
  ) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  if (
    typeof value.schemaVersion !== 'number'
    || !Number.isSafeInteger(value.schemaVersion)
    || value.schemaVersion < 1
    || value.schemaVersion > latestSchemaVersion()
  ) {
    fail('BACKUP_SCHEMA_UNSUPPORTED');
  }
  if (!isRecord(value.database) || !hasExactKeys(value.database, ['file', 'bytes', 'sha256'])) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  if (
    value.database.file !== SQLITE_BACKUP_DATABASE_FILE
    || typeof value.database.bytes !== 'number'
    || !Number.isSafeInteger(value.database.bytes)
    || value.database.bytes <= 0
    || typeof value.database.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.database.sha256)
  ) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  if (!isRecord(value.counts) || !hasExactKeys(value.counts, COUNTED_TABLES)) {
    fail('BACKUP_MANIFEST_INVALID');
  }

  const counts: SqliteBackupCounts = {
    owners: parseBoundedCount(value.counts.owners),
    tasks: parseBoundedCount(value.counts.tasks),
    agent_runs: parseBoundedCount(value.counts.agent_runs),
  };
  const ownerCount = parseBoundedCount(value.ownerCount);
  if (ownerCount !== counts.owners) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  const includes = value.includes;
  const excludes = value.excludes;
  if (!Array.isArray(includes) || !Array.isArray(excludes)) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  if (
    includes.length !== SQLITE_BACKUP_INCLUDES.length
    || !SQLITE_BACKUP_INCLUDES.every((entry, index) => includes[index] === entry)
    || excludes.length !== SQLITE_BACKUP_EXCLUDES.length
    || !SQLITE_BACKUP_EXCLUDES.every((entry, index) => excludes[index] === entry)
  ) {
    fail('BACKUP_MANIFEST_INVALID');
  }

  return {
    formatVersion: 1,
    scope: SQLITE_BACKUP_SCOPE,
    createdAt: value.createdAt,
    appVersion: value.appVersion,
    schemaVersion: value.schemaVersion,
    database: {
      file: SQLITE_BACKUP_DATABASE_FILE,
      bytes: value.database.bytes,
      sha256: value.database.sha256,
    },
    ownerCount,
    counts,
    quickCheck: 'ok',
    includes: SQLITE_BACKUP_INCLUDES,
    excludes: SQLITE_BACKUP_EXCLUDES,
  };
}

function readManifest(directory: string): SqliteOnlyBackupManifest {
  const manifestPath = join(directory, SQLITE_BACKUP_MANIFEST_FILE);
  const manifestFile = inspectRegularFile(manifestPath, 'BACKUP_MANIFEST_INVALID');
  if (manifestFile.bytes > MAX_MANIFEST_BYTES) {
    fail('BACKUP_MANIFEST_TOO_LARGE');
  }
  try {
    return parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    fail('BACKUP_MANIFEST_INVALID');
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.once('error', rejectHash);
    stream.once('end', () => resolveHash(hash.digest('hex')));
  });
}

function readSnapshotFacts(snapshotPath: string): SnapshotFacts {
  let database: Database.Database | undefined;
  try {
    database = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    const migrationRows = database.prepare('select version from schema_migrations order by version asc').all() as Array<{
      version: unknown;
    }>;
    let expectedVersion = 1;
    for (const row of migrationRows) {
      if (!Number.isSafeInteger(row.version) || row.version !== expectedVersion) {
        fail('BACKUP_SNAPSHOT_INVALID');
      }
      expectedVersion += 1;
    }
    const schemaVersion = expectedVersion - 1;
    if (schemaVersion < 1 || schemaVersion > latestSchemaVersion()) {
      fail('BACKUP_SCHEMA_UNSUPPORTED');
    }

    const counts = {} as SqliteBackupCounts;
    for (const table of COUNTED_TABLES) {
      const row = database.prepare(`select count(*) as count from ${table}`).get() as { count: unknown } | undefined;
      const count = row?.count;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        fail('BACKUP_SNAPSHOT_INVALID');
      }
      counts[table] = count;
    }
    const quickCheckRows = database.prepare('pragma quick_check').all() as Array<{ quick_check: unknown }>;
    if (quickCheckRows.length !== 1 || quickCheckRows[0]?.quick_check !== 'ok') {
      fail('BACKUP_SNAPSHOT_INVALID');
    }

    return {
      schemaVersion,
      ownerCount: counts.owners,
      counts,
      quickCheck: 'ok',
    };
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    return fail('BACKUP_SNAPSHOT_INVALID');
  } finally {
    database?.close();
  }
}

function assertSelfContainedSnapshotHeader(snapshotPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(snapshotPath, 'r');
    const header = Buffer.alloc(20);
    const bytesRead = readSync(descriptor, header, 0, header.byteLength, 0);
    if (
      bytesRead !== header.byteLength
      || !header.subarray(0, SQLITE_FILE_HEADER.byteLength).equals(SQLITE_FILE_HEADER)
      || header[18] !== 1
      || header[19] !== 1
    ) {
      fail('BACKUP_SNAPSHOT_INVALID');
    }
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    fail('BACKUP_SNAPSHOT_INVALID');
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function finalizeSnapshotJournalMode(snapshotPath: string): void {
  let database: Database.Database | undefined;
  try {
    database = new Database(snapshotPath, { fileMustExist: true });
    if (database.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') {
      fail('BACKUP_SNAPSHOT_INVALID');
    }
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    fail('BACKUP_SNAPSHOT_FAILED');
  } finally {
    database?.close();
  }
  assertSelfContainedSnapshotHeader(snapshotPath);
}

async function inspectSnapshot(snapshotPath: string): Promise<SnapshotInspection> {
  assertSelfContainedSnapshotHeader(snapshotPath);
  const before = inspectRegularFile(snapshotPath, 'BACKUP_SNAPSHOT_INVALID');
  let initialSha256: string;
  try {
    initialSha256 = await sha256File(snapshotPath);
  } catch {
    fail('BACKUP_SNAPSHOT_INVALID');
  }
  const facts = readSnapshotFacts(snapshotPath);
  const afterFacts = inspectRegularFile(snapshotPath, 'BACKUP_SNAPSHOT_INVALID');
  let finalSha256: string;
  try {
    finalSha256 = await sha256File(snapshotPath);
  } catch {
    fail('BACKUP_SNAPSHOT_INVALID');
  }
  const after = inspectRegularFile(snapshotPath, 'BACKUP_SNAPSHOT_INVALID');
  assertSelfContainedSnapshotHeader(snapshotPath);
  if (before.bytes !== afterFacts.bytes || before.bytes !== after.bytes || initialSha256 !== finalSha256) {
    fail('BACKUP_INTEGRITY_MISMATCH');
  }
  return { ...facts, bytes: after.bytes, sha256: finalSha256 };
}

function assertManifestMatchesSnapshot(
  manifest: SqliteOnlyBackupManifest,
  snapshot: SnapshotInspection,
): void {
  if (
    manifest.database.bytes !== snapshot.bytes
    || manifest.database.sha256 !== snapshot.sha256
    || manifest.schemaVersion !== snapshot.schemaVersion
    || manifest.ownerCount !== snapshot.ownerCount
    || manifest.quickCheck !== snapshot.quickCheck
  ) {
    fail('BACKUP_INTEGRITY_MISMATCH');
  }
  for (const table of COUNTED_TABLES) {
    if (manifest.counts[table] !== snapshot.counts[table]) {
      fail('BACKUP_INTEGRITY_MISMATCH');
    }
  }
}

function writeManifestAtomically(directory: string, manifest: SqliteOnlyBackupManifest): void {
  const manifestPath = join(directory, SQLITE_BACKUP_MANIFEST_FILE);
  const temporaryPath = join(directory, `.${SQLITE_BACKUP_MANIFEST_FILE}.${randomUUID()}.tmp`);
  try {
    const serialized = JSON.stringify(manifest);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_MANIFEST_BYTES) {
      fail('BACKUP_MANIFEST_TOO_LARGE');
    }
    writeFileSync(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const descriptor = openSync(temporaryPath, 'r+');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (existsSync(manifestPath)) {
      fail('BACKUP_LAYOUT_INVALID');
    }
    renameSync(temporaryPath, manifestPath);
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    fail('BACKUP_MANIFEST_WRITE_FAILED');
  }
}

async function createSnapshotFromActiveDatabase(activeDatabasePath: string, snapshotPath: string): Promise<void> {
  let database: Database.Database | undefined;
  try {
    database = new Database(activeDatabasePath, { readonly: true, fileMustExist: true });
    await database.backup(snapshotPath);
  } catch {
    fail('BACKUP_SNAPSHOT_FAILED');
  } finally {
    database?.close();
  }
}

export async function verifySqliteOnlyBackup(
  input: VerifySqliteOnlyBackupInput,
): Promise<VerifiedSqliteOnlyBackup> {
  const backupDirectory = assertPrivateBackupDirectory(input.backupDirectory);
  assertExactDirectoryEntries(backupDirectory, [SQLITE_BACKUP_DATABASE_FILE, SQLITE_BACKUP_MANIFEST_FILE]);
  const manifest = readManifest(backupDirectory);
  const snapshotPath = join(backupDirectory, SQLITE_BACKUP_DATABASE_FILE);
  const snapshot = await inspectSnapshot(snapshotPath);
  assertManifestMatchesSnapshot(manifest, snapshot);
  assertExactDirectoryEntries(backupDirectory, [SQLITE_BACKUP_DATABASE_FILE, SQLITE_BACKUP_MANIFEST_FILE]);
  return { status: 'verified', manifest };
}

export async function createSqliteOnlyBackup(
  input: CreateSqliteOnlyBackupInput,
): Promise<CreatedSqliteOnlyBackup> {
  const activeDatabasePath = resolveActiveDatabase(input.activeDatabasePath);
  const backupDirectory = resolveNewIsolatedDirectory(input.backupDirectory, [
    activeDatabasePath,
    dirname(activeDatabasePath),
  ]);
  createPrivateBackupDirectory(backupDirectory);
  assertExactDirectoryEntries(backupDirectory, []);

  const snapshotPath = join(backupDirectory, SQLITE_BACKUP_DATABASE_FILE);
  await createSnapshotFromActiveDatabase(activeDatabasePath, snapshotPath);
  finalizeSnapshotJournalMode(snapshotPath);
  assertExactDirectoryEntries(backupDirectory, [SQLITE_BACKUP_DATABASE_FILE]);
  const snapshot = await inspectSnapshot(snapshotPath);
  const manifest: SqliteOnlyBackupManifest = {
    formatVersion: 1,
    scope: SQLITE_BACKUP_SCOPE,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    schemaVersion: snapshot.schemaVersion,
    database: {
      file: SQLITE_BACKUP_DATABASE_FILE,
      bytes: snapshot.bytes,
      sha256: snapshot.sha256,
    },
    ownerCount: snapshot.ownerCount,
    counts: snapshot.counts,
    quickCheck: 'ok',
    includes: SQLITE_BACKUP_INCLUDES,
    excludes: SQLITE_BACKUP_EXCLUDES,
  };
  writeManifestAtomically(backupDirectory, manifest);
  assertExactDirectoryEntries(backupDirectory, [SQLITE_BACKUP_DATABASE_FILE, SQLITE_BACKUP_MANIFEST_FILE]);
  return { status: 'created', manifest };
}

export async function restoreSqliteOnlyBackup(
  input: RestoreSqliteOnlyBackupInput,
): Promise<RestoredSqliteOnlyBackup> {
  const backupDirectory = resolveExistingUnlinkedDirectory(input.backupDirectory, 'BACKUP_DIRECTORY_INVALID');
  const verified = await verifySqliteOnlyBackup({ backupDirectory });
  const activeDatabasePath = resolveActiveDatabase(input.activeDatabasePath);
  const restoreDirectory = resolveNewIsolatedDirectory(input.restoreDirectory, [
    activeDatabasePath,
    dirname(activeDatabasePath),
    backupDirectory,
  ]);
  createPrivateBackupDirectory(restoreDirectory);

  const sourceSnapshotPath = join(backupDirectory, SQLITE_BACKUP_DATABASE_FILE);
  const restoredSnapshotPath = join(restoreDirectory, SQLITE_BACKUP_DATABASE_FILE);
  try {
    copyFileSync(sourceSnapshotPath, restoredSnapshotPath, constants.COPYFILE_EXCL);
  } catch {
    fail('BACKUP_RESTORE_COPY_FAILED');
  }
  assertExactDirectoryEntries(restoreDirectory, [SQLITE_BACKUP_DATABASE_FILE]);
  const restoredSnapshot = await inspectSnapshot(restoredSnapshotPath);
  assertManifestMatchesSnapshot(verified.manifest, restoredSnapshot);
  assertExactDirectoryEntries(restoreDirectory, [SQLITE_BACKUP_DATABASE_FILE]);
  return { status: 'restored', manifest: verified.manifest };
}
