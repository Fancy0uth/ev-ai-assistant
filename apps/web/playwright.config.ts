import { defineConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(configDirectory, '../..');
const dataRoot = resolve(workspaceRoot, 'data');
const e2eDataDirectory = resolve(dataRoot, 'e2e');
const dataPreparedMarker = 'EV_E2E_DATA_PREPARED';

if (!e2eDataDirectory.startsWith(`${dataRoot}${sep}`)) {
  throw new Error('Refusing to reset E2E data outside the workspace data directory');
}
if (process.env[dataPreparedMarker] !== 'true') {
  rmSync(e2eDataDirectory, { recursive: true, force: true });
  process.env[dataPreparedMarker] = 'true';
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      name: 'Core',
      command: 'npm run start --workspace @ev/core',
      cwd: workspaceRoot,
      env: {
        ...process.env,
        EV_CORE_HOST: '127.0.0.1',
        EV_CORE_PORT: '4311',
        EV_DATA_DIR: e2eDataDirectory,
        EV_SECURE_COOKIES: 'false',
        NODE_ENV: 'test',
      },
      url: 'http://127.0.0.1:4311/v1/health/ready',
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
    },
    {
      name: 'Web',
      command: 'npm run dev --workspace @ev/web',
      cwd: workspaceRoot,
      env: {
        ...process.env,
        EV_CORE_URL: 'http://127.0.0.1:4311',
      },
      url: 'http://127.0.0.1:3000/setup',
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
  ],
});
