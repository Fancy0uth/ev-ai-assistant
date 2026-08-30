import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDirectory, '../../..');
const e2eRunsDirectory = resolve(workspaceRoot, 'data/e2e-runs');
const allocatedRunDirectories = new Set<string>();

type PlaywrightServer = {
  command: string;
  env: Record<string, string | undefined>;
  name: string;
  reuseExistingServer: boolean;
  url: string;
};

type PlaywrightConfig = {
  use?: { baseURL?: string };
  webServer?: unknown;
};

type PlaywrightConfigModule = {
  default: PlaywrightConfig;
  playwrightConfig: PlaywrightConfig;
};

async function loadPlaywrightConfig(): Promise<PlaywrightConfigModule> {
  vi.resetModules();
  const configModule = (await import('../playwright.config')) as PlaywrightConfigModule;
  const webServer = configModule.playwrightConfig.webServer;
  if (Array.isArray(webServer)) {
    const core = webServer.find((candidate) => (candidate as PlaywrightServer).name === 'Core') as PlaywrightServer | undefined;
    if (core?.env.EV_DATA_DIR) allocatedRunDirectories.add(core.env.EV_DATA_DIR);
  }
  return configModule;
}

afterEach(() => {
  for (const directory of allocatedRunDirectories) rmSync(directory, { recursive: true, force: true });
  allocatedRunDirectories.clear();
});

function configuredServer(config: PlaywrightConfig, name: string): PlaywrightServer {
  expect(Array.isArray(config.webServer)).toBe(true);
  const server = (config.webServer as PlaywrightServer[]).find((candidate) => candidate.name === name);
  expect(server).toBeDefined();
  return server as PlaywrightServer;
}

function coreDataDirectory(config: PlaywrightConfig): string {
  const dataDirectory = configuredServer(config, 'Core').env.EV_DATA_DIR;
  expect(typeof dataDirectory).toBe('string');
  return dataDirectory as string;
}

describe('Playwright server isolation', () => {
  it('exports a resolved configuration with aligned isolated server endpoints', async () => {
    const configModule = await loadPlaywrightConfig();
    const config = configModule.playwrightConfig;

    expect(config).toBe(configModule.default);

    const core = configuredServer(config, 'Core');
    const web = configuredServer(config, 'Web');

    expect(config.use?.baseURL).toBe('http://127.0.0.1:3217');
    expect(core.url).toBe('http://127.0.0.1:4327/v1/health/ready');
    expect(web.url).toBe('http://127.0.0.1:3217/setup');
    expect(core.command).toBe('node --import tsx apps/core/src/server.ts');
    expect(web.command).toBe('node node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3217');
    expect(core.env.EV_CORE_HOST).toBe('127.0.0.1');
    expect(core.env.EV_CORE_PORT).toBe('4327');
    expect(web.env.EV_CORE_URL).toBe('http://127.0.0.1:4327');
    expect(web.env.EV_NEXT_DIST_DIR).toMatch(/^\.\.[\\/]\.\.[\\/]data[\\/]e2e-runs[\\/]run-[^\\/]+[\\/]next$/);
    expect(core.reuseExistingServer).toBe(false);
    expect(web.reuseExistingServer).toBe(false);
  }, 15_000);

  it('allocates a unique run-prefixed Core data directory for each configuration process', async () => {
    const firstConfigModule = await loadPlaywrightConfig();
    const secondConfigModule = await loadPlaywrightConfig();

    expect(firstConfigModule.playwrightConfig).toBe(firstConfigModule.default);
    expect(secondConfigModule.playwrightConfig).toBe(secondConfigModule.default);

    const firstConfig = firstConfigModule.playwrightConfig;
    const secondConfig = secondConfigModule.playwrightConfig;
    const firstDataDirectory = coreDataDirectory(firstConfig);
    const secondDataDirectory = coreDataDirectory(secondConfig);
    const resolvedRunsDirectory = realpathSync(e2eRunsDirectory);

    expect(firstDataDirectory).not.toBe(secondDataDirectory);
    expect(existsSync(firstDataDirectory)).toBe(true);
    expect(existsSync(secondDataDirectory)).toBe(true);
    expect(dirname(realpathSync(firstDataDirectory))).toBe(resolvedRunsDirectory);
    expect(dirname(realpathSync(secondDataDirectory))).toBe(resolvedRunsDirectory);
    expect(basename(firstDataDirectory)).toMatch(/^run-/);
    expect(basename(secondDataDirectory)).toMatch(/^run-/);
  }, 15_000);

  it('uses the runner-owned directory instead of allocating a second one in managed mode', async () => {
    const managedDirectory = resolve(e2eRunsDirectory, 'managed-run-playwright-test');
    rmSync(managedDirectory, { recursive: true, force: true });
    mkdirSync(managedDirectory, { recursive: true });
    process.env.EV_E2E_MANAGED = '1';
    process.env.EV_E2E_RUN_DIR = managedDirectory;

    try {
      const configModule = await loadPlaywrightConfig();
      expect(configModule.playwrightConfig.webServer).toBeUndefined();
    } finally {
      delete process.env.EV_E2E_MANAGED;
      delete process.env.EV_E2E_RUN_DIR;
      rmSync(managedDirectory, { recursive: true, force: true });
    }
  }, 15_000);
});
