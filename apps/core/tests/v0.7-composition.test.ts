import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { HealthTextProvider } from '@ev/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createV07HealthTestAdapters } from '../e2e/v0.7-health-test-adapters';
import { buildApp, type AppOptions } from '../src/app';
import type { NutritionDataProvider } from '../src/modules/nutrition/provider';

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

function fixturePortOptions(
  runnerRoot: string,
  port: 'healthTextProvider' | 'nutritionDataProvider',
  overrides: Partial<AppOptions> = {},
  includeGate = true,
): AppOptions {
  const databasePath = join(runnerRoot, 'data', 'app.sqlite');
  mkdirSync(dirname(databasePath), { recursive: true });
  const adapters = createV07HealthTestAdapters();
  return {
    databasePath,
    artifactRoot: join(runnerRoot, 'artifacts'),
    logger: false,
    [port]: adapters[port],
    ...(includeGate ? { v07TestAdapterGate: { nodeEnv: 'test' as const, enabled: true as const, runnerDataRoot: runnerRoot } } : {}),
    ...overrides,
  };
}

function healthProviderWithDescriptor(descriptor: unknown): HealthTextProvider {
  return { ...createV07HealthTestAdapters().healthTextProvider, descriptor } as unknown as HealthTextProvider;
}

function nutritionProviderWithDescriptor(descriptor: unknown): NutritionDataProvider {
  return { ...createV07HealthTestAdapters().nutritionDataProvider, descriptor } as unknown as NutritionDataProvider;
}

const fixtureSource = createV07HealthTestAdapters().nutritionDataProvider.descriptor.source;
const productionSource = {
  sourceKind: 'REMOTE_API',
  sourceId: 'controlled-production-source',
  sourceVersion: '1',
  datasetHash: 'a'.repeat(64),
  redistribution: false,
  licenseDecisionId: 'approved-production-source',
} as const;
const approvedLocalSource = {
  sourceKind: 'APPROVED_LOCAL_DATASET',
  sourceId: 'controlled-local-source',
  sourceVersion: '1',
  datasetHash: 'b'.repeat(64),
  redistribution: false,
  licenseDecisionId: 'approved-local-source',
} as const;

const healthFixtureMarkerContradictions = [false, true].flatMap((providerFixture) =>
  [false, true].flatMap((adapterFixture) =>
    [false, true].map((evidenceFixture) => ({ providerFixture, adapterFixture, evidenceFixture }))))
  .filter(({ providerFixture, adapterFixture, evidenceFixture }) => {
    const fixtureMarkers = Number(providerFixture) + Number(adapterFixture) + Number(evidenceFixture);
    return fixtureMarkers > 0 && fixtureMarkers < 3;
  })
  .map(({ providerFixture, adapterFixture, evidenceFixture }) => [
    `provider=${providerFixture ? 'fixture' : 'production'},adapter=${adapterFixture ? 'fixture' : 'production'},evidence=${evidenceFixture ? 'fixture' : 'production'}`,
    {
      providerId: providerFixture ? 'v07-test-fixture' : 'deepseek',
      providerLabel: 'Controlled descriptor invariant test',
      adapterKind: adapterFixture ? 'TEST_FIXTURE' : 'PRODUCTION_ADAPTER',
      evidenceKind: evidenceFixture ? 'AUTOMATED_TEST_FIXTURE' : 'REAL_PROVIDER',
    },
  ] as const);

const nutritionFixtureMarkerContradictions = [false, true].flatMap((providerFixture) =>
  [false, true].flatMap((adapterFixture) =>
    [false, true].flatMap((evidenceFixture) =>
      [false, true].map((sourceFixture) => ({ providerFixture, adapterFixture, evidenceFixture, sourceFixture })))))
  .filter(({ providerFixture, adapterFixture, evidenceFixture, sourceFixture }) => {
    const fixtureMarkers = Number(providerFixture) + Number(adapterFixture) + Number(evidenceFixture) + Number(sourceFixture);
    return fixtureMarkers > 0 && fixtureMarkers < 4;
  })
  .map(({ providerFixture, adapterFixture, evidenceFixture, sourceFixture }) => [
    `provider=${providerFixture ? 'fixture' : 'production'},adapter=${adapterFixture ? 'fixture' : 'production'},evidence=${evidenceFixture ? 'fixture' : 'production'},source=${sourceFixture ? 'fixture' : 'production'}`,
    {
      providerId: providerFixture ? 'v07-test-fixture' : 'controlled-production-nutrition',
      providerLabel: 'Controlled descriptor invariant test',
      adapterKind: adapterFixture ? 'TEST_FIXTURE' : 'PRODUCTION_ADAPTER',
      evidenceKind: evidenceFixture ? 'AUTOMATED_TEST_FIXTURE' : 'REAL_PROVIDER',
      source: sourceFixture ? fixtureSource : productionSource,
    },
  ] as const);

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

async function expectDescriptorRejected(options: AppOptions, databasePath: string): Promise<void> {
  vi.stubEnv('NODE_ENV', 'production');
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
  expect((failure as Error).message).toBe('V07_PROVIDER_DESCRIPTOR_REJECTED');
  expect(existsSync(databasePath)).toBe(false);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  while (openApps.length > 0) await openApps.pop()?.close();
  while (tempDirectories.length > 0) rmSync(tempDirectories.pop()!, { recursive: true, force: true });
});

describe('v0.7 health capability composition', () => {
  it.each(healthFixtureMarkerContradictions)(
    'rejects contradictory HealthTextProvider fixture markers before DB side effects: %s',
    async (_label, descriptor) => {
      const runnerRoot = temporaryDirectory('ev-v07-health-descriptor-');
      const databasePath = join(runnerRoot, 'app.sqlite');
      await expectDescriptorRejected({ databasePath, logger: false, healthTextProvider: healthProviderWithDescriptor(descriptor) }, databasePath);
    },
  );

  it.each(nutritionFixtureMarkerContradictions)(
    'rejects contradictory NutritionDataProvider fixture markers before DB side effects: %s',
    async (_label, descriptor) => {
      const runnerRoot = temporaryDirectory('ev-v07-nutrition-descriptor-');
      const databasePath = join(runnerRoot, 'app.sqlite');
      await expectDescriptorRejected({ databasePath, logger: false, nutritionDataProvider: nutritionProviderWithDescriptor(descriptor) }, databasePath);
    },
  );

  it.each([
    ['local adapter with real evidence', { providerId: 'controlled-local', providerLabel: 'Controlled local', adapterKind: 'APPROVED_LOCAL_DATASET', evidenceKind: 'REAL_PROVIDER', source: approvedLocalSource }],
    ['local adapter with remote source', { providerId: 'controlled-local', providerLabel: 'Controlled local', adapterKind: 'APPROVED_LOCAL_DATASET', evidenceKind: 'APPROVED_LOCAL_DATASET', source: productionSource }],
    ['production adapter with local evidence/source', { providerId: 'controlled-local', providerLabel: 'Controlled local', adapterKind: 'PRODUCTION_ADAPTER', evidenceKind: 'APPROVED_LOCAL_DATASET', source: approvedLocalSource }],
  ] as const)('rejects contradictory approved-local descriptor: %s', async (_label, descriptor) => {
    const runnerRoot = temporaryDirectory('ev-v07-local-descriptor-');
    const databasePath = join(runnerRoot, 'app.sqlite');
    await expectDescriptorRejected({ databasePath, logger: false, nutritionDataProvider: nutritionProviderWithDescriptor(descriptor) }, databasePath);
  });

  it.each([
    ['HealthTextProvider', { ...createV07HealthTestAdapters().healthTextProvider.descriptor, unexpected: true }, 'healthTextProvider'],
    ['NutritionDataProvider', { ...createV07HealthTestAdapters().nutritionDataProvider.descriptor, unexpected: true }, 'nutritionDataProvider'],
  ] as const)('strictly rejects extra %s descriptor fields', async (_label, descriptor, port) => {
    const runnerRoot = temporaryDirectory('ev-v07-strict-descriptor-');
    const databasePath = join(runnerRoot, 'app.sqlite');
    const provider = port === 'healthTextProvider'
      ? healthProviderWithDescriptor(descriptor)
      : nutritionProviderWithDescriptor(descriptor);
    await expectDescriptorRejected({ databasePath, logger: false, [port]: provider }, databasePath);
  });

  it('accepts consistent production descriptors without the test gate in production mode', async () => {
    const runnerRoot = temporaryDirectory('ev-v07-production-descriptor-');
    vi.stubEnv('NODE_ENV', 'production');
    const app = await buildApp({
      databasePath: join(runnerRoot, 'app.sqlite'),
      logger: false,
      healthTextProvider: healthProviderWithDescriptor({ providerId: 'deepseek', providerLabel: 'Controlled production', adapterKind: 'PRODUCTION_ADAPTER', evidenceKind: 'REAL_PROVIDER' }),
      nutritionDataProvider: nutritionProviderWithDescriptor({ providerId: 'controlled-production-nutrition', providerLabel: 'Controlled production', adapterKind: 'PRODUCTION_ADAPTER', evidenceKind: 'REAL_PROVIDER', source: productionSource }),
    });
    await app.close();
  });

  it('accepts a consistent approved-local nutrition descriptor without the fixture gate', async () => {
    const runnerRoot = temporaryDirectory('ev-v07-local-descriptor-valid-');
    const app = await buildApp({
      databasePath: join(runnerRoot, 'app.sqlite'),
      logger: false,
      nutritionDataProvider: nutritionProviderWithDescriptor({ providerId: 'controlled-local', providerLabel: 'Controlled local', adapterKind: 'APPROVED_LOCAL_DATASET', evidenceKind: 'APPROVED_LOCAL_DATASET', source: approvedLocalSource }),
    });
    await app.close();
  });

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

  it.each(['healthTextProvider', 'nutritionDataProvider'] as const)(
    'rejects a valid %s fixture in production even with an otherwise valid gate',
    async (port) => {
      const runnerRoot = temporaryDirectory(`ev-v07-${port}-runtime-gate-`);
      vi.stubEnv('NODE_ENV', 'production');
      await expectFixtureGateRejected(fixturePortOptions(runnerRoot, port));
    },
  );

  it.each(['healthTextProvider', 'nutritionDataProvider'] as const)(
    'rejects a valid %s fixture when no explicit gate is supplied',
    async (port) => {
      const runnerRoot = temporaryDirectory(`ev-v07-${port}-missing-gate-`);
      await expectFixtureGateRejected(fixturePortOptions(runnerRoot, port, {}, false));
    },
  );

  it.each(['healthTextProvider', 'nutritionDataProvider'] as const)(
    'rejects a valid %s fixture when an artifact path escapes the runner root',
    async (port) => {
      const parent = temporaryDirectory(`ev-v07-${port}-path-gate-`);
      const runnerRoot = join(parent, 'runner');
      mkdirSync(runnerRoot);
      await expectFixtureGateRejected(fixturePortOptions(runnerRoot, port, {
        artifactRoot: join(parent, 'outside-artifacts'),
      }));
    },
  );

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
