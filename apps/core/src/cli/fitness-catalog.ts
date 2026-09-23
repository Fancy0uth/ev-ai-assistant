import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveUnlinkedExistingDirectory, samePhysicalPath } from '../filesystem/path-containment';
import { CatalogRevisionConflictError } from '../modules/fitness/catalog-repository';
import { createFitnessCatalogService } from '../modules/fitness/catalog-service';
import { parseExternalExerciseCatalog } from '../modules/fitness/external-catalog';

const catalogMigrationVersion = 28;
const maxJsonBytes = 32 * 1024 * 1024;
const catalogTables = [
  'fitness_catalog_snapshots',
  'fitness_catalog_items',
  'fitness_catalog_reviews',
] as const;

type ImportOption = 'data-dir' | 'json-file' | 'revision';

export interface FitnessCatalogImportInput {
  dataDir: string;
  jsonFile: string;
  revision: string;
}

export const fitnessCatalogImportCliErrorCodes = [
  'FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID',
  'FITNESS_CATALOG_IMPORT_DATA_DIRECTORY_INVALID',
  'FITNESS_CATALOG_IMPORT_DATABASE_REQUIRED',
  'FITNESS_CATALOG_IMPORT_SCHEMA_REQUIRED',
  'FITNESS_CATALOG_IMPORT_JSON_FILE_INVALID',
  'FITNESS_CATALOG_IMPORT_JSON_FILE_TOO_LARGE',
  'FITNESS_CATALOG_IMPORT_JSON_INVALID',
  'FITNESS_CATALOG_IMPORT_REVISION_CONFLICT',
  'FITNESS_CATALOG_IMPORT_FAILED',
] as const;

export type FitnessCatalogImportCliErrorCode = (typeof fitnessCatalogImportCliErrorCodes)[number];
export type FitnessCatalogImportSuccessCode = 'FITNESS_CATALOG_IMPORTED' | 'FITNESS_CATALOG_REPLAYED';

export interface FitnessCatalogImportResult {
  code: FitnessCatalogImportSuccessCode;
  revision: string;
  itemCount: number;
  catalogHash: string;
}

export class FitnessCatalogImportCliError extends Error {
  readonly code: FitnessCatalogImportCliErrorCode;
  readonly statusCode: number | undefined;

  constructor(code: FitnessCatalogImportCliErrorCode, statusCode?: number) {
    super(code);
    this.name = 'FitnessCatalogImportCliError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code: FitnessCatalogImportCliErrorCode, statusCode?: number): never {
  throw new FitnessCatalogImportCliError(code, statusCode);
}

function parseAbsoluteLocalPath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
  }
  if (
    process.platform === 'win32'
    && (value.startsWith('\\\\') || value.startsWith('//') || !/^[A-Za-z]:[\\/]/.test(value))
  ) {
    fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
  }
  return resolve(value);
}

function parseRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
  }
  return value;
}

function parseImportInput(input: FitnessCatalogImportInput): FitnessCatalogImportInput {
  if (
    input === null
    || typeof input !== 'object'
    || Array.isArray(input)
    || Object.keys(input).length !== 3
    || !Object.hasOwn(input, 'dataDir')
    || !Object.hasOwn(input, 'jsonFile')
    || !Object.hasOwn(input, 'revision')
  ) {
    fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
  }
  return {
    dataDir: parseAbsoluteLocalPath(input.dataDir),
    jsonFile: parseAbsoluteLocalPath(input.jsonFile),
    revision: parseRevision(input.revision),
  };
}

function parseCommand(argv: readonly string[]): FitnessCatalogImportInput {
  if (argv[0] !== 'import') {
    fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
  }

  const values: Partial<Record<ImportOption, string>> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== 'string' || !token.startsWith('--')) {
      fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
    }
    const option = token.slice(2) as ImportOption;
    if (
      (option !== 'data-dir' && option !== 'json-file' && option !== 'revision')
      || values[option] !== undefined
    ) {
      fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
    }
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
    }
    values[option] = value;
    index += 1;
  }

  if (!values['data-dir'] || !values['json-file'] || !values.revision) {
    fail('FITNESS_CATALOG_IMPORT_ARGUMENTS_INVALID');
  }
  return {
    dataDir: values['data-dir'],
    jsonFile: values['json-file'],
    revision: values.revision,
  };
}

function resolveExistingDataDirectory(dataDir: string): string {
  try {
    const physicalPath = resolveUnlinkedExistingDirectory(dataDir);
    if (!samePhysicalPath(physicalPath, dataDir)) {
      fail('FITNESS_CATALOG_IMPORT_DATA_DIRECTORY_INVALID');
    }
    return dataDir;
  } catch (error) {
    if (error instanceof FitnessCatalogImportCliError) throw error;
    fail('FITNESS_CATALOG_IMPORT_DATA_DIRECTORY_INVALID');
  }
}

function resolveExistingRegularFile(
  filePath: string,
  code: 'FITNESS_CATALOG_IMPORT_DATABASE_REQUIRED' | 'FITNESS_CATALOG_IMPORT_JSON_FILE_INVALID',
): string {
  try {
    resolveUnlinkedExistingDirectory(dirname(filePath));
    const entry = lstatSync(filePath);
    if (entry.isSymbolicLink() || !entry.isFile() || !statSync(filePath).isFile()) {
      fail(code);
    }
    if (!samePhysicalPath(realpathSync.native(filePath), filePath)) {
      fail(code);
    }
    return filePath;
  } catch (error) {
    if (error instanceof FitnessCatalogImportCliError) throw error;
    fail(code);
  }
}

function readBoundedJsonRecords(jsonFile: string): unknown {
  let bytes: Buffer;
  try {
    const before = statSync(jsonFile);
    if (!before.isFile() || before.size > maxJsonBytes) {
      fail('FITNESS_CATALOG_IMPORT_JSON_FILE_TOO_LARGE');
    }
    bytes = readFileSync(jsonFile);
    if (bytes.byteLength > maxJsonBytes) {
      fail('FITNESS_CATALOG_IMPORT_JSON_FILE_TOO_LARGE');
    }
    const after = statSync(jsonFile);
    if (!after.isFile() || after.size > maxJsonBytes || after.size !== bytes.byteLength) {
      fail('FITNESS_CATALOG_IMPORT_JSON_FILE_INVALID');
    }
  } catch (error) {
    if (error instanceof FitnessCatalogImportCliError) throw error;
    fail('FITNESS_CATALOG_IMPORT_JSON_FILE_INVALID');
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('FITNESS_CATALOG_IMPORT_JSON_INVALID');
  }
}

function verifyCatalogSchema(database: Database.Database): void {
  try {
    const migration = database
      .prepare('select version from schema_migrations where version = ?')
      .get(catalogMigrationVersion) as { version: number } | undefined;
    const rows = database.prepare(`select name from sqlite_master where type = 'table'
      and name in (${catalogTables.map(() => '?').join(', ')})`).all(...catalogTables) as Array<{ name: string }>;
    if (migration?.version !== catalogMigrationVersion || rows.length !== catalogTables.length) {
      fail('FITNESS_CATALOG_IMPORT_SCHEMA_REQUIRED');
    }
  } catch (error) {
    if (error instanceof FitnessCatalogImportCliError) throw error;
    fail('FITNESS_CATALOG_IMPORT_SCHEMA_REQUIRED');
  }
}

export function importFitnessCatalog(input: FitnessCatalogImportInput): FitnessCatalogImportResult {
  const command = parseImportInput(input);
  const dataDir = resolveExistingDataDirectory(command.dataDir);
  const databasePath = resolveExistingRegularFile(
    join(dataDir, 'app.sqlite'),
    'FITNESS_CATALOG_IMPORT_DATABASE_REQUIRED',
  );
  const jsonFile = resolveExistingRegularFile(command.jsonFile, 'FITNESS_CATALOG_IMPORT_JSON_FILE_INVALID');
  const catalog = (() => {
    try {
      return parseExternalExerciseCatalog({
        records: readBoundedJsonRecords(jsonFile),
        revision: command.revision,
      });
    } catch (error) {
      if (error instanceof FitnessCatalogImportCliError) throw error;
      fail('FITNESS_CATALOG_IMPORT_JSON_INVALID');
    }
  })();

  let database: Database.Database | undefined;
  try {
    database = new Database(databasePath, { fileMustExist: true });
    database.pragma('foreign_keys = ON');
    verifyCatalogSchema(database);
    const imported = createFitnessCatalogService(database).importCatalog(catalog);
    return {
      code: imported.inserted ? 'FITNESS_CATALOG_IMPORTED' : 'FITNESS_CATALOG_REPLAYED',
      revision: catalog.revision,
      itemCount: catalog.items.length,
      catalogHash: imported.catalogHash,
    };
  } catch (error) {
    if (error instanceof FitnessCatalogImportCliError) throw error;
    if (error instanceof CatalogRevisionConflictError) {
      return fail('FITNESS_CATALOG_IMPORT_REVISION_CONFLICT', error.statusCode);
    }
    return fail('FITNESS_CATALOG_IMPORT_FAILED');
  } finally {
    database?.close();
  }
}

export function runFitnessCatalogImportCli(argv: readonly string[]): FitnessCatalogImportResult {
  return importFitnessCatalog(parseCommand(argv));
}

function controlledErrorCode(error: unknown): FitnessCatalogImportCliErrorCode {
  return error instanceof FitnessCatalogImportCliError
    ? error.code
    : 'FITNESS_CATALOG_IMPORT_FAILED';
}

function main(): void {
  try {
    process.stdout.write(`${JSON.stringify(runFitnessCatalogImportCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: controlledErrorCode(error) })}\n`);
    process.exitCode = 1;
  }
}

function isMain(): boolean {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  main();
}
