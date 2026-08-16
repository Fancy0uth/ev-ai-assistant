import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coreUrl = 'http://127.0.0.1:4327/v1/health/ready';
const webUrl = 'http://127.0.0.1:3217/setup';
const runDirectoryRoot = join(root, 'data', 'e2e-runs');
await mkdir(runDirectoryRoot, { recursive: true });
const dataDirectory = mkdtempSync(join(runDirectoryRoot, 'managed-run-'));

function start(command, args, environment, cwd = root) {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    windowsHide: true,
  });
}

function waitForExit(process) {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) return resolve();
    process.once('exit', () => resolve());
  });
}

async function stop(process) {
  if (!process || !process.pid || process.exitCode !== null || process.signalCode !== null) return;
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill', ['/pid', String(process.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await waitForExit(taskkill);
    return;
  }
  process.kill('SIGTERM');
  await waitForExit(process);
}

async function waitForReady(url) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

function runPlaywright() {
  return new Promise((resolve) => {
    const child = start(process.execPath, [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'], {
      EV_E2E_MANAGED: '1',
    }, join(root, 'apps', 'web'));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

const core = start(process.execPath, ['--import', 'tsx', join(root, 'apps', 'core', 'src', 'server.ts')], {
  EV_CORE_HOST: '127.0.0.1',
  EV_CORE_PORT: '4327',
  EV_DATA_DIR: dataDirectory,
  EV_SECURE_COOKIES: 'false',
  NODE_ENV: 'test',
});

let web;
try {
  await waitForReady(coreUrl);
  web = start(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', join(root, 'apps', 'web'), '--hostname', '127.0.0.1', '--port', '3217'], {
    EV_CORE_URL: 'http://127.0.0.1:4327',
  });
  await waitForReady(webUrl);
  process.exitCode = await runPlaywright();
} finally {
  await stop(web);
  await stop(core);
}
