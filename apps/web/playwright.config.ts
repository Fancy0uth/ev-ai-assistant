import { defineConfig } from '@playwright/test';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(configDirectory, '../..');
const dataRoot = resolve(workspaceRoot, 'data');
const e2eRunsDirectory = resolve(dataRoot, 'e2e-runs');
const webBaseUrl = 'http://127.0.0.1:3217';
const coreBaseUrl = 'http://127.0.0.1:4327';

if (!e2eRunsDirectory.startsWith(`${dataRoot}${sep}`)) {
  throw new Error('Refusing to create E2E data outside the workspace data directory');
}

mkdirSync(e2eRunsDirectory, { recursive: true });

const resolvedWorkspaceRoot = realpathSync(workspaceRoot);
const resolvedDataRoot = realpathSync(dataRoot);
const resolvedE2eRunsDirectory = realpathSync(e2eRunsDirectory);

if (dirname(resolvedDataRoot) !== resolvedWorkspaceRoot || dirname(resolvedE2eRunsDirectory) !== resolvedDataRoot) {
  throw new Error('Refusing to use an E2E data directory outside the workspace');
}

const e2eRunDirectory = realpathSync(mkdtempSync(join(resolvedE2eRunsDirectory, 'run-')));

if (dirname(e2eRunDirectory) !== resolvedE2eRunsDirectory || !basename(e2eRunDirectory).startsWith('run-')) {
  throw new Error('Refusing to use an unsafe E2E run directory');
}

export const playwrightConfig = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: webBaseUrl,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  ...(process.env.EV_E2E_MANAGED === '1' ? {} : { webServer: [
    {
      name: 'Core',
      command: 'node --import tsx apps/core/src/server.ts',
      cwd: workspaceRoot,
      env: {
        ...process.env,
        EV_CORE_HOST: '127.0.0.1',
        EV_CORE_PORT: '4327',
        EV_DATA_DIR: e2eRunDirectory,
        EV_SECURE_COOKIES: 'false',
        NODE_ENV: 'test',
      },
      url: `${coreBaseUrl}/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
    },
    {
      name: 'Web',
      command: 'node node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3217',
      cwd: workspaceRoot,
      env: {
        ...process.env,
        EV_CORE_URL: coreBaseUrl,
      },
      url: `${webBaseUrl}/setup`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
  ] }),
});

export default playwrightConfig;
