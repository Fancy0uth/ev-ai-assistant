import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createV07HealthTestAdapters } from '../e2e/v0.7-health-test-adapters';
import { buildApp, type AppOptions } from '../src/app';

const openApps: FastifyInstance[] = [];
const tempDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

function fixtureOptions(runnerRoot: string, overrides: Partial<AppOptions> = {}): AppOptions {
  const databasePath = join(runnerRoot, 'data', 'app.sqlite');
  mkdirSync(dirname(databasePath), { recursive: true });
  return {
    databasePath,
    artifactRoot: join(runnerRoot, 'artifacts'),
    logger: false,
    ...createV07HealthTestAdapters(),
    v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: runnerRoot },
    ...overrides,
  };
}

async function expectFixtureGateRejected(options: AppOptions): Promise<void> {
  let app: FastifyInstance | undefined;
  let failure: unknown;
  try {
    app = await buildApp(options);
  } catch (error) {
    failure = error;
  } finally {
    if (app) await app.close();
  }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe('V07_TEST_FIXTURE_GATE_REJECTED');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  while (openApps.length > 0) await openApps.pop()?.close();
  while (tempDirectories.length > 0) rmSync(tempDirectories.pop()!, { recursive: true, force: true });
});

describe('v0.7 health capability composition', () => {
  it('requires the existing Owner session before disclosing capability descriptors', async () => {
    const app = await buildApp({ logger: false });
    openApps.push(app);

    const unauthorized = await app.inject({ method: 'GET', url: '/v1/health-capabilities' });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' } });

    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: 'v07-owner', password: 'correct horse battery staple' },
    });
    const authorized = await app.inject({
      method: 'GET',
      url: '/v1/health-capabilities',
      cookies: { ev_session: readSessionToken(setup.headers['set-cookie']) },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().data.map((entry: { availability: string }) => entry.availability))
      .toEqual(['NOT_CONFIGURED', 'NOT_CONFIGURED', 'NOT_CONFIGURED']);
  });

  it('rejects fixture adapters when runtime mode is not test', async () => {
    const runnerRoot = temporaryDirectory('ev-v07-runtime-gate-');
    vi.stubEnv('NODE_ENV', 'production');
    await expectFixtureGateRejected(fixtureOptions(runnerRoot));
  });

  it('rejects fixture adapters when the explicit runner flag gate is disabled', async () => {
    const runnerRoot = temporaryDirectory('ev-v07-flag-gate-');
    await expectFixtureGateRejected(fixtureOptions(runnerRoot, {
      v07TestAdapterGate: { nodeEnv: 'test', enabled: false, runnerDataRoot: runnerRoot } as never,
    }));
  });

  it('rejects an in-memory fixture database outside the dedicated runner factory', async () => {
    const runnerRoot = temporaryDirectory('ev-v07-memory-gate-');
    await expectFixtureGateRejected(fixtureOptions(runnerRoot, { databasePath: ':memory:' }));
  });

  it('rejects a sibling traversal database path', async () => {
    const parent = temporaryDirectory('ev-v07-sibling-gate-');
    const runnerRoot = join(parent, 'runner');
    mkdirSync(runnerRoot);
    await expectFixtureGateRejected(fixtureOptions(runnerRoot, {
      databasePath: join(runnerRoot, '..', 'sibling', 'app.sqlite'),
    }));
  });

  it('rejects an artifact root outside the runner root', async () => {
    const parent = temporaryDirectory('ev-v07-artifact-gate-');
    const runnerRoot = join(parent, 'runner');
    const outsideRoot = join(parent, 'outside-artifacts');
    mkdirSync(runnerRoot);
    mkdirSync(outsideRoot);
    await expectFixtureGateRejected(fixtureOptions(runnerRoot, { artifactRoot: outsideRoot }));
  });

  it('rejects an existing junction that resolves outside the runner root', async () => {
    const parent = temporaryDirectory('ev-v07-realpath-gate-');
    const runnerRoot = join(parent, 'runner');
    const outsideRoot = join(parent, 'outside-artifacts');
    const linkedArtifactRoot = join(runnerRoot, 'artifact-link');
    mkdirSync(runnerRoot);
    mkdirSync(outsideRoot);
    symlinkSync(outsideRoot, linkedArtifactRoot, 'junction');
    await expectFixtureGateRejected(fixtureOptions(runnerRoot, { artifactRoot: linkedArtifactRoot }));
  });

  it('rejects a Windows cross-volume artifact path without touching that volume', async () => {
    const runnerRoot = temporaryDirectory('ev-v07-cross-volume-gate-');
    const runnerVolume = win32.parse(runnerRoot).root.toUpperCase();
    const outsideVolume = runnerVolume === 'C:\\' ? 'D:\\' : 'C:\\';
    await expectFixtureGateRejected(fixtureOptions(runnerRoot, {
      artifactRoot: win32.join(outsideVolume, 'ev-v07-outside', 'artifacts'),
    }));
  });
});
