import { appendFileSync, existsSync, lstatSync, renameSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { assertPrivateDirectory, createPrivateDirectory } from '../filesystem/private-directory';

export const RUNTIME_LOG_DIRECTORY_NAME = 'runtime';
export const RUNTIME_LOG_FILE_BYTES = 5 * 1024 * 1024;
export const RUNTIME_LOG_EVENT_BYTES = 8 * 1024;

type RuntimeLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type RuntimeLogComponent = 'core' | 'daily_planning' | 'fastify' | 'memory_compaction' | 'project_brief' | 'runtime';
type RuntimeLogEvent =
  | 'core_shutdown'
  | 'core_start_failed'
  | 'course_artifact_recovery_failed'
  | 'daily_plan_automation_failed'
  | 'daily_plan_coordination'
  | 'fastify_request_completed'
  | 'fastify_request_failed'
  | 'fastify_request_received'
  | 'memory_compaction'
  | 'project_brief'
  | 'runtime_event'
  | 'runtime_event_dropped'
  | 'unhandled_request_error';

export type RuntimeLogStatus = 'up' | 'degraded' | 'not_configured';

interface SafeRuntimeLogEvent {
  timestamp: string;
  level: RuntimeLogLevel;
  component: RuntimeLogComponent;
  event: RuntimeLogEvent;
  requestId?: string;
  runId?: string;
  proposalId?: string;
  mode?: 'LOCAL_RULES' | 'EXTERNAL';
  elapsedMs?: number;
  status?: string;
  errorCode?: string;
  count?: number;
  appVersion?: string;
  schemaVersion?: number;
}

export interface RuntimeLogger {
  readonly status: RuntimeLogStatus;
  readonly stream: { write(message: string): void };
  close(): void;
}

export interface RuntimeLoggerOptions {
  /** The launcher-owned ordinary root. Only its fixed runtime child is private. */
  logRoot?: string;
  /** Internal test seam; production always uses the 5 MiB constant. */
  maxFileBytes?: number;
  /** Internal test seam for a disk append failure; it never replaces directory ACL checks. */
  appendLine?: (path: string, line: string) => void;
  now?: () => Date;
}

const managedFileNames = ['current.jsonl', 'runtime.1.jsonl', 'runtime.2.jsonl', 'runtime.3.jsonl'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const statusValues = new Set([
  'ACCEPTED', 'APPLIED', 'AWAITING_CONTEXT_APPROVAL', 'BLOCKED', 'COMPLETED', 'DEGRADED',
  'DOWN', 'EXISTING_RUN', 'FAILED', 'INVALIDATED', 'NOT_DUE', 'NOT_READY', 'NOT_RUN',
  'PENDING', 'PENDING_REVIEW', 'PREPARATION_FAILED', 'PROVIDER_NOT_CONFIGURED', 'READY',
  'REJECTED', 'REPLAYED', 'SKIPPED', 'STALE', 'SUCCEEDED', 'UNCONFIGURED', 'UNKNOWN', 'UP',
]);
const errorCodeValues = new Set([
  'AUTO_COMPACTION_FAILED', 'DAILY_PLAN_CONTEXT_INVALID', 'EVENT_TOO_LARGE', 'INTERNAL_ERROR',
  'LOG_WRITE_FAILED', 'MEMORY_COMPACTION_PROVIDER_UNAVAILABLE', 'NO_EXACT_DUPLICATE_SEGMENTS',
  'PROVIDER_NOT_CONFIGURED', 'UNIQUE_CONTENT_EXCEEDS_BYTE_BUDGET', 'UNKNOWN',
]);

export const safeRuntimeLogSerializers = {
  req: () => ({}),
  res: () => ({}),
  err: () => ({ type: 'Error', message: 'REDACTED', stack: '' }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeUuid(value: unknown): string | undefined {
  const candidate = stringValue(value);
  return candidate && uuidPattern.test(candidate) ? candidate : undefined;
}

function safeStatus(value: unknown): string | undefined {
  const candidate = stringValue(value);
  return candidate && statusValues.has(candidate) ? candidate : undefined;
}

function safeErrorCode(value: unknown): string | undefined {
  const candidate = stringValue(value);
  if (!candidate) return undefined;
  return errorCodeValues.has(candidate) ? candidate : 'UNKNOWN';
}

function safeElapsedMilliseconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 86_400_000
    ? value
    : undefined;
}

function safeCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : undefined;
}

function logLevel(value: unknown): RuntimeLogLevel {
  if (typeof value === 'number') {
    if (value >= 60) return 'fatal';
    if (value >= 50) return 'error';
    if (value >= 40) return 'warn';
    if (value >= 30) return 'info';
    if (value >= 20) return 'debug';
  }
  return 'trace';
}

function componentFor(input: Record<string, unknown>): RuntimeLogComponent {
  switch (input.module) {
    case 'daily-planning': return 'daily_planning';
    case 'memory-compaction': return 'memory_compaction';
    case 'project-brief': return 'project_brief';
    default:
      return typeof input.reqId === 'string' || 'req' in input || 'res' in input
        ? 'fastify'
        : 'core';
  }
}

function eventFor(input: Record<string, unknown>, component: RuntimeLogComponent): RuntimeLogEvent {
  switch (input.msg) {
    case 'incoming request': return 'fastify_request_received';
    case 'request completed': return 'fastify_request_completed';
    case 'request errored': return 'fastify_request_failed';
    case 'Stopping Core service': return 'core_shutdown';
    case 'Core service failed to start': return 'core_start_failed';
    case 'course artifact deletion recovery failed': return 'course_artifact_recovery_failed';
    case 'daily plan automation failed': return 'daily_plan_automation_failed';
    case 'daily plan coordination': return 'daily_plan_coordination';
    case 'memory compaction': return 'memory_compaction';
    case 'project brief': return 'project_brief';
    case 'Unhandled Core request error': return 'unhandled_request_error';
    default:
      break;
  }
  if (input.event === 'daily_plan_automation_failed') return 'daily_plan_automation_failed';
  if (component === 'daily_planning') return 'daily_plan_coordination';
  if (component === 'memory_compaction') return 'memory_compaction';
  if (component === 'project_brief') return 'project_brief';
  return 'runtime_event';
}

function safeEvent(input: unknown, now: () => Date): SafeRuntimeLogEvent | undefined {
  if (!isRecord(input)) return undefined;
  const component = componentFor(input);
  const event: SafeRuntimeLogEvent = {
    timestamp: now().toISOString(),
    level: logLevel(input.level),
    component,
    event: eventFor(input, component),
  };
  const requestId = safeUuid(input.requestId) ?? safeUuid(input.reqId);
  const runId = safeUuid(input.runId);
  const proposalId = safeUuid(input.proposalId);
  const mode = input.mode === 'LOCAL_RULES' || input.mode === 'EXTERNAL' ? input.mode : undefined;
  const elapsedMs = safeElapsedMilliseconds(input.elapsedMs) ?? safeElapsedMilliseconds(input.responseTime);
  const status = safeStatus(input.status);
  const errorCode = safeErrorCode(input.errorCode) ?? safeErrorCode(input.failureCode);
  const count = safeCount(input.count) ?? safeCount(input.skippedCount);
  const appVersion = stringValue(input.appVersion);
  const schemaVersion = safeCount(input.schemaVersion);

  if (requestId) event.requestId = requestId;
  if (runId) event.runId = runId;
  if (proposalId) event.proposalId = proposalId;
  if (mode) event.mode = mode;
  if (elapsedMs !== undefined) event.elapsedMs = elapsedMs;
  if (status) event.status = status;
  if (errorCode) event.errorCode = errorCode;
  if (count !== undefined) event.count = count;
  if (appVersion && appVersion.length <= 64 && semverPattern.test(appVersion)) event.appVersion = appVersion;
  if (schemaVersion !== undefined) event.schemaVersion = schemaVersion;
  return event;
}

function eventLine(event: SafeRuntimeLogEvent, now: () => Date): string {
  const line = `${JSON.stringify(event)}\n`;
  if (Buffer.byteLength(line, 'utf8') <= RUNTIME_LOG_EVENT_BYTES) return line;
  return `${JSON.stringify({
    timestamp: now().toISOString(),
    level: 'warn' as const,
    component: 'runtime' as const,
    event: 'runtime_event_dropped' as const,
    errorCode: 'EVENT_TOO_LARGE',
  } satisfies SafeRuntimeLogEvent)}\n`;
}

function fixedStderrNotice(): void {
  try {
    process.stderr.write('EV_RUNTIME_LOGGER_DEGRADED\n');
  } catch {
    // Logging failures must not recurse into another logger.
  }
}

function fileSize(path: string): number {
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('UNSAFE_RUNTIME_LOG_FILE');
    return entry.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

function assertManagedFile(path: string): boolean {
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('UNSAFE_RUNTIME_LOG_FILE');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function createRuntimeLogger(options: RuntimeLoggerOptions = {}): RuntimeLogger {
  const now = options.now ?? (() => new Date());
  const maximumFileBytes = options.maxFileBytes ?? RUNTIME_LOG_FILE_BYTES;
  const appendLine = options.appendLine ?? ((path: string, line: string) => appendFileSync(path, line, 'utf8'));
  let status: RuntimeLogStatus = 'not_configured';
  let closed = false;
  let currentSize = 0;
  let runtimeDirectory: string | undefined;
  let pending = '';

  function degrade(): void {
    if (status === 'degraded') return;
    status = 'degraded';
    fixedStderrNotice();
  }

  function currentPath(): string {
    if (!runtimeDirectory) throw new Error('RUNTIME_LOGGER_NOT_CONFIGURED');
    return join(runtimeDirectory, managedFileNames[0]);
  }

  function managedPath(name: typeof managedFileNames[number]): string {
    if (!runtimeDirectory) throw new Error('RUNTIME_LOGGER_NOT_CONFIGURED');
    return join(runtimeDirectory, name);
  }

  function rotate(): void {
    const oldest = managedPath(managedFileNames[3]);
    if (assertManagedFile(oldest)) unlinkSync(oldest);
    for (let index = managedFileNames.length - 2; index >= 1; index -= 1) {
      const sourceName = managedFileNames[index];
      const destinationName = managedFileNames[index + 1];
      if (!sourceName || !destinationName) continue;
      const source = managedPath(sourceName);
      if (assertManagedFile(source)) renameSync(source, managedPath(destinationName));
    }
    const current = currentPath();
    if (assertManagedFile(current)) renameSync(current, managedPath(managedFileNames[1]));
    currentSize = 0;
  }

  function writeEvent(event: SafeRuntimeLogEvent): void {
    if (status !== 'up' || closed) return;
    try {
      const line = eventLine(event, now);
      const bytes = Buffer.byteLength(line, 'utf8');
      if (currentSize > 0 && currentSize + bytes > maximumFileBytes) rotate();
      appendLine(currentPath(), line);
      currentSize += bytes;
    } catch {
      degrade();
    }
  }

  function writeFallback(): void {
    writeEvent({
      timestamp: now().toISOString(),
      level: 'warn',
      component: 'runtime',
      event: 'runtime_event_dropped',
      errorCode: 'EVENT_TOO_LARGE',
    });
  }

  function ingest(message: string): void {
    if (status !== 'up' || closed || typeof message !== 'string') return;
    const combined = pending + message;
    if (Buffer.byteLength(combined, 'utf8') > RUNTIME_LOG_EVENT_BYTES * 2) {
      pending = '';
      writeFallback();
      return;
    }
    const lines = combined.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      try {
        const event = safeEvent(JSON.parse(line) as unknown, now);
        if (event) writeEvent(event);
      } catch {
        writeFallback();
      }
    }
  }

  if (options.logRoot !== undefined) {
    if (!isAbsolute(options.logRoot) || !Number.isInteger(maximumFileBytes) || maximumFileBytes < 128) {
      degrade();
    } else {
      try {
        const candidate = join(options.logRoot, RUNTIME_LOG_DIRECTORY_NAME);
        if (existsSync(candidate)) {
          assertPrivateDirectory(candidate);
        } else {
          createPrivateDirectory(candidate);
        }
        runtimeDirectory = candidate;
        currentSize = fileSize(currentPath());
        status = 'up';
      } catch {
        degrade();
      }
    }
  }

  return {
    get status() {
      return status;
    },
    stream: {
      write(message: string): void {
        ingest(message);
      },
    },
    close(): void {
      closed = true;
      pending = '';
    },
  };
}
