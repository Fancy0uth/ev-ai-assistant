import { lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BackupServiceError,
  createSqliteOnlyBackup,
  restoreSqliteOnlyBackup,
  verifySqliteOnlyBackup,
} from '../storage/backup-service';
import { resolveUnlinkedExistingDirectory, samePhysicalPath } from '../filesystem/path-containment';

type BackupCommand = 'create' | 'verify' | 'restore';
type BackupOption = 'data-dir' | 'backup-dir' | 'restore-dir';

interface CreateCommand {
  command: 'create';
  dataDir: string;
  backupDir: string;
}

interface VerifyCommand {
  command: 'verify';
  backupDir: string;
}

interface RestoreCommand {
  command: 'restore';
  dataDir: string;
  backupDir: string;
  restoreDir: string;
}

type ParsedCommand = CreateCommand | VerifyCommand | RestoreCommand;

export const backupCliErrorCodes = [
  'SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID',
  'SQLITE_ONLY_BACKUP_DATA_DIRECTORY_INVALID',
  'SQLITE_ONLY_BACKUP_ACTIVE_DATABASE_REQUIRED',
  'SQLITE_ONLY_BACKUP_FAILED',
] as const;

export type BackupCliErrorCode = (typeof backupCliErrorCodes)[number];
export type BackupCliSuccessCode =
  | 'SQLITE_ONLY_BACKUP_CREATED'
  | 'SQLITE_ONLY_BACKUP_VERIFIED'
  | 'SQLITE_ONLY_BACKUP_RESTORED';

export class BackupCliError extends Error {
  readonly code: BackupCliErrorCode;

  constructor(code: BackupCliErrorCode) {
    super(code);
    this.name = 'BackupCliError';
    this.code = code;
  }
}

function fail(code: BackupCliErrorCode): never {
  throw new BackupCliError(code);
}

function parseAbsoluteLocalPath(value: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
  }
  if (
    process.platform === 'win32'
    && (value.startsWith('\\\\') || value.startsWith('//') || !/^[A-Za-z]:[\\/]/.test(value))
  ) {
    fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
  }
  return resolve(value);
}

function parseCommand(argv: readonly string[]): ParsedCommand {
  const command = argv[0] as BackupCommand | undefined;
  if (command !== 'create' && command !== 'verify' && command !== 'restore') {
    fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
  }

  const values: Partial<Record<BackupOption, string>> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith('--')) {
      fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
    }
    const option = token.slice(2) as BackupOption;
    if (
      (option !== 'data-dir' && option !== 'backup-dir' && option !== 'restore-dir')
      || values[option] !== undefined
    ) {
      fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
    }
    values[option] = parseAbsoluteLocalPath(value);
    index += 1;
  }

  if (command === 'create') {
    if (!values['data-dir'] || !values['backup-dir'] || values['restore-dir']) {
      fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
    }
    return { command, dataDir: values['data-dir'], backupDir: values['backup-dir'] };
  }
  if (command === 'verify') {
    if (!values['backup-dir'] || values['data-dir'] || values['restore-dir']) {
      fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
    }
    return { command, backupDir: values['backup-dir'] };
  }
  if (!values['data-dir'] || !values['backup-dir'] || !values['restore-dir']) {
    fail('SQLITE_ONLY_BACKUP_ARGUMENTS_INVALID');
  }
  return {
    command,
    dataDir: values['data-dir'],
    backupDir: values['backup-dir'],
    restoreDir: values['restore-dir'],
  };
}

function resolveExistingDataDirectory(dataDir: string): string {
  try {
    const physicalPath = resolveUnlinkedExistingDirectory(dataDir);
    if (!samePhysicalPath(physicalPath, dataDir)) {
      fail('SQLITE_ONLY_BACKUP_DATA_DIRECTORY_INVALID');
    }
    return dataDir;
  } catch (error) {
    if (error instanceof BackupCliError) throw error;
    fail('SQLITE_ONLY_BACKUP_DATA_DIRECTORY_INVALID');
  }
}

function resolveExistingActiveDatabase(dataDir: string): string {
  const databasePath = join(resolveExistingDataDirectory(dataDir), 'app.sqlite');
  try {
    const entry = lstatSync(databasePath);
    if (entry.isSymbolicLink() || !entry.isFile() || !statSync(databasePath).isFile()) {
      fail('SQLITE_ONLY_BACKUP_ACTIVE_DATABASE_REQUIRED');
    }
    if (!samePhysicalPath(realpathSync.native(databasePath), databasePath)) {
      fail('SQLITE_ONLY_BACKUP_ACTIVE_DATABASE_REQUIRED');
    }
    return databasePath;
  } catch (error) {
    if (error instanceof BackupCliError) throw error;
    fail('SQLITE_ONLY_BACKUP_ACTIVE_DATABASE_REQUIRED');
  }
}

export async function runBackupCli(
  argv: readonly string[],
): Promise<{ code: BackupCliSuccessCode }> {
  const command = parseCommand(argv);
  if (command.command === 'create') {
    await createSqliteOnlyBackup({
      activeDatabasePath: resolveExistingActiveDatabase(command.dataDir),
      backupDirectory: command.backupDir,
    });
    return { code: 'SQLITE_ONLY_BACKUP_CREATED' };
  }
  if (command.command === 'verify') {
    await verifySqliteOnlyBackup({ backupDirectory: command.backupDir });
    return { code: 'SQLITE_ONLY_BACKUP_VERIFIED' };
  }
  await restoreSqliteOnlyBackup({
    activeDatabasePath: resolveExistingActiveDatabase(command.dataDir),
    backupDirectory: command.backupDir,
    restoreDirectory: command.restoreDir,
  });
  return { code: 'SQLITE_ONLY_BACKUP_RESTORED' };
}

function controlledErrorCode(error: unknown): string {
  if (error instanceof BackupCliError || error instanceof BackupServiceError) {
    return error.code;
  }
  return 'SQLITE_ONLY_BACKUP_FAILED';
}

async function main(): Promise<void> {
  try {
    const result = await runBackupCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: controlledErrorCode(error) })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
