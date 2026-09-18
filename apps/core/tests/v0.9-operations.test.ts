import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createRuntimeLogger } from '../src/observability/runtime-logger';
import { openDatabase } from '../src/storage/database';

const requestId = '00000000-0000-4000-8000-000000000904';
const runId = '00000000-0000-4000-8000-000000000905';
const proposalId = '00000000-0000-4000-8000-000000000906';
const fileNames = ['current.jsonl', 'runtime.1.jsonl', 'runtime.2.jsonl', 'runtime.3.jsonl'] as const;

function sessionToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const token = value?.match(/(?:^|;\s*)ev_session=([^;]+)/)?.[1];
  if (!token) throw new Error('missing synthetic Owner session');
  return token;
}

function fileDigest(path: string): string | null {
  return existsSync(path)
    ? createHash('sha256').update(readFileSync(path)).digest('hex')
    : null;
}

function databaseSnapshot(databasePath: string): Record<string, string | null> {
  return Object.fromEntries(
    [databasePath, `${databasePath}-wal`].map((path) => [path, fileDigest(path)]),
  );
}

function runtimeLines(runtimeDirectory: string): string[] {
  return fileNames.flatMap((name) => {
    const path = join(runtimeDirectory, name);
    return existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').filter((line) => line.length > 0)
      : [];
  });
}

describe('V9-04 runtime logging and Owner read-only health', () => {
  const directories: string[] = [];
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0).reverse()) {
      await app.close();
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps JSONL structural, rotates and reopens safely, degrades on disk failure, and exposes only Owner read-only health', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-v9-operations-'));
    directories.push(directory);
    const databasePath = join(directory, 'app.sqlite');
    const logRoot = join(directory, 'ordinary-launcher-log-root');
    const runtimeDirectory = join(logRoot, 'runtime');
    mkdirSync(logRoot);

    const initialLogger = createRuntimeLogger({ logRoot, maxFileBytes: 1024 });
    expect(initialLogger.status).toBe('up');
    initialLogger.stream.write(`${JSON.stringify({
      level: 30,
      module: 'daily-planning',
      requestId,
      runId,
      proposalId,
      mode: 'LOCAL_RULES',
      elapsedMs: 1,
      status: 'PENDING_REVIEW',
    })}\n`);
    const sizeBeforeReopen = statSync(join(runtimeDirectory, 'current.jsonl')).size;
    initialLogger.close();

    const reopenedLogger = createRuntimeLogger({ logRoot, maxFileBytes: 1024 });
    expect(reopenedLogger.status).toBe('up');
    reopenedLogger.stream.write(`${JSON.stringify({
      level: 30,
      module: 'daily-planning',
      requestId,
      runId,
      proposalId,
      mode: 'LOCAL_RULES',
      elapsedMs: 2,
      status: 'PENDING_REVIEW',
    })}\n`);
    expect(statSync(join(runtimeDirectory, 'current.jsonl')).size).toBeGreaterThan(sizeBeforeReopen);
    reopenedLogger.close();

    const runtimeLogger = createRuntimeLogger({ logRoot, maxFileBytes: 1024 });
    const app = await buildApp({ databasePath, runtimeLogger });
    apps.push(app);
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: 'v9-owner', password: 'synthetic-v9-password' },
    });
    expect(setup.statusCode).toBe(201);
    const token = sessionToken(setup.headers['set-cookie']);

    const beforeHealth = databaseSnapshot(databasePath);
    const anonymous = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(anonymous.statusCode).toBe(401);
    const ownerHealth = await app.inject({
      method: 'GET',
      url: '/v1/health',
      cookies: { ev_session: token },
    });
    expect(ownerHealth.statusCode).toBe(200);
    expect(ownerHealth.json()).toEqual({
      appVersion: '0.9.0',
      schemaVersion: 26,
      checks: {
        database: 'up',
        migration: 'up',
        backup: 'not_run',
        provider: 'unconfigured',
        scheduler: 'not_run',
        log: 'up',
      },
    });
    expect(databaseSnapshot(databasePath)).toEqual(beforeHealth);

    const noLogApp = await buildApp({
      databasePath: join(directory, 'no-runtime-log.sqlite'),
      logger: false,
    });
    apps.push(noLogApp);
    const noLogSetup = await noLogApp.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: 'v9-no-log-owner', password: 'synthetic-v9-no-log-password' },
    });
    const noLogHealth = await noLogApp.inject({
      method: 'GET',
      url: '/v1/health',
      cookies: { ev_session: sessionToken(noLogSetup.headers['set-cookie']) },
    });
    expect.soft(noLogHealth.statusCode).toBe(200);
    expect.soft((noLogHealth.json() as { checks?: { log?: unknown } }).checks?.log).toBe('unconfigured');

    const control = openDatabase(databasePath);
    try {
      const tokenHash = createHash('sha256').update(token).digest('hex');
      control.prepare('update sessions set expires_at = ? where token_hash = ?')
        .run('2020-01-01T00:00:00.000Z', tokenHash);
      const persistedExpiredSession = control.prepare(
        'select id, owner_id, token_hash, expires_at, created_at from sessions where token_hash = ?',
      ).get(tokenHash);
      expect(persistedExpiredSession).toBeDefined();
      const beforeExpiredHealth = databaseSnapshot(databasePath);
      const expiredHealth = await app.inject({
        method: 'GET',
        url: '/v1/health',
        cookies: { ev_session: token },
      });
      expect.soft(expiredHealth.statusCode).toBe(401);
      expect.soft(control.prepare(
        'select id, owner_id, token_hash, expires_at, created_at from sessions where token_hash = ?',
      ).get(tokenHash)).toEqual(persistedExpiredSession);
      expect.soft(databaseSnapshot(databasePath)).toEqual(beforeExpiredHealth);
    } finally {
      control.close();
    }

    expect((await app.inject({ method: 'GET', url: '/v1/health/live' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/health/ready' })).statusCode).toBe(200);

    writeFileSync(join(runtimeDirectory, 'foreign.jsonl'), 'do-not-delete');
    for (let index = 0; index < 20; index += 1) {
      app.log.info({
        module: 'daily-planning',
        requestId,
        runId,
        proposalId,
        mode: 'LOCAL_RULES',
        elapsedMs: index,
        status: 'PENDING_REVIEW',
        skippedCount: 1,
      }, 'daily plan coordination');
    }
    app.log.warn({
      module: 'daily-planning',
      requestId,
      runId,
      proposalId,
      mode: 'LOCAL_RULES',
      elapsedMs: 21,
      status: 'FAILED',
      err: new Error('canary-error-message-never-persisted'),
      nested: {
        body: 'canary-body-never-persisted',
        authorization: 'canary-authorization-never-persisted',
        cookie: 'canary-cookie-never-persisted',
        path: 'C:\\synthetic\\canary-path-never-persisted',
        req: { url: '/canary-url-never-persisted', body: 'canary-body-never-persisted' },
        res: { body: 'canary-response-never-persisted' },
      },
    }, 'canary-message-never-persisted');

    expect(readFileSync(join(runtimeDirectory, 'foreign.jsonl'), 'utf8')).toBe('do-not-delete');
    expect(readdirSync(runtimeDirectory)).toEqual(expect.arrayContaining([
      'current.jsonl',
      'runtime.1.jsonl',
      'runtime.2.jsonl',
      'runtime.3.jsonl',
      'foreign.jsonl',
    ]));
    for (const name of fileNames) {
      expect(statSync(join(runtimeDirectory, name)).size).toBeLessThanOrEqual(1024);
    }

    const safeKeys = new Set([
      'timestamp', 'level', 'component', 'event', 'requestId', 'runId', 'proposalId',
      'mode', 'elapsedMs', 'status', 'errorCode', 'count', 'appVersion', 'schemaVersion',
    ]);
    const lines = runtimeLines(runtimeDirectory);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(8 * 1024);
      expect(Object.keys(JSON.parse(line) as object).every((key) => safeKeys.has(key))).toBe(true);
    }
    const logText = lines.join('\n');
    expect(logText).toContain(`"requestId":"${requestId}"`);
    for (const privateValue of [
      'synthetic-v9-password', token, 'canary-error-message-never-persisted',
      'canary-body-never-persisted', 'canary-authorization-never-persisted',
      'canary-cookie-never-persisted', 'canary-path-never-persisted',
      'canary-url-never-persisted', 'canary-response-never-persisted',
      'canary-message-never-persisted', '/v1/health', '"msg"',
    ]) {
      expect(logText).not.toContain(privateValue);
    }
    const failingLogRoot = join(directory, 'disk-failure-log-root');
    mkdirSync(failingLogRoot);
    const failingLogger = createRuntimeLogger({
      logRoot: failingLogRoot,
      appendLine: () => {
        throw new Error('C:\\synthetic\\disk-failure-never-persisted');
      },
    });
    const failedApp = await buildApp({
      databasePath: join(directory, 'failure.sqlite'),
      runtimeLogger: failingLogger,
    });
    apps.push(failedApp);
    const failedSetup = await failedApp.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: 'v9-failure-owner', password: 'synthetic-v9-failure-password' },
    });
    const failedHealth = await failedApp.inject({
      method: 'GET',
      url: '/v1/health',
      cookies: { ev_session: sessionToken(failedSetup.headers['set-cookie']) },
    });
    expect(failedHealth.statusCode).toBe(200);
    expect(failedHealth.json().checks.log).toBe('degraded');
    expect(JSON.stringify(failedHealth.json())).not.toContain('disk-failure-never-persisted');

    const harmlessApp = {
      log: { error: () => undefined, info: () => undefined },
      listen: async () => undefined,
      close: async () => undefined,
    };
    const startupNotices: string[] = [];
    const startupExitCodes: number[] = [];
    let failedStartupCloseCount = 0;
    try {
      const { vi } = await import('vitest');
      vi.resetModules();
      vi.doMock('../src/config', () => ({
        loadConfig: () => ({
          host: '127.0.0.1' as const,
          port: 4311,
          dataDir: directory,
          secureCookies: false,
        }),
      }));
      vi.doMock('../src/app', () => ({ buildApp: async () => harmlessApp }));
      const serverModule = await import('../src/server');
      const startCore = (serverModule as unknown as {
        startCore?: (overrides: Record<string, unknown>) => Promise<void>;
      }).startCore;
      expect.soft(typeof startCore).toBe('function');
      if (typeof startCore === 'function') {
        await startCore({
          loadConfig: () => ({
            host: '127.0.0.1',
            port: 4311,
            dataDir: directory,
            secureCookies: false,
          }),
          buildApp: async () => ({
            log: { info: () => undefined },
            listen: async () => {
              throw new Error('C:\\synthetic\\startup-listen-failure-never-emitted');
            },
            close: async () => {
              failedStartupCloseCount += 1;
              throw new Error('C:\\synthetic\\startup-close-failure-never-emitted');
            },
          }),
          writeStderr: (notice: string) => startupNotices.push(notice),
          setExitCode: (code: number) => startupExitCodes.push(code),
          registerSignal: () => undefined,
        });
        expect.soft(failedStartupCloseCount).toBe(1);
        expect.soft(startupNotices).toEqual(['EV_CORE_STARTUP_FAILED\n']);
        expect.soft(startupNotices.join('')).not.toContain('startup-listen-failure-never-emitted');
        expect.soft(startupNotices.join('')).not.toContain('startup-close-failure-never-emitted');
        expect.soft(startupExitCodes).toEqual([1]);
      }
    } finally {
      const { vi } = await import('vitest');
      vi.doUnmock('../src/config');
      vi.doUnmock('../src/app');
      vi.resetModules();
    }
  });
});
