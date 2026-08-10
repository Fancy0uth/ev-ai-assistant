import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDirectory, '../../..');
const e2eRunsDirectory = resolve(workspaceRoot, 'data/e2e-runs');

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
  return (await import('../playwright.config')) as PlaywrightConfigModule;
}

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
    expect(web.command).toBe('npm run dev --workspace @ev/web -- --hostname 127.0.0.1 --port 3217');
    expect(core.env.EV_CORE_HOST).toBe('127.0.0.1');
    expect(core.env.EV_CORE_PORT).toBe('4327');
    expect(web.env.EV_CORE_URL).toBe('http://127.0.0.1:4327');
    expect(core.reuseExistingServer).toBe(false);
    expect(web.reuseExistingServer).toBe(false);
  });

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
  });
});
