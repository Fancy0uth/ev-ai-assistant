import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preserveV07HealthEvidence } from './v0.7-health-evidence.mjs';
import { preserveFitnessPlanningEvidence } from './fitness-planning-evidence.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coreUrl = 'http://127.0.0.1:4327/v1/health/ready';
const webUrl = 'http://127.0.0.1:3217/setup';
const runDirectoryRoot = join(root, 'data', 'e2e-runs');
await mkdir(runDirectoryRoot, { recursive: true });
const dataDirectory = mkdtempSync(join(runDirectoryRoot, 'managed-run-'));
const webDirectory = join(root, 'apps', 'web');
const webRelativeDistDir = relative(webDirectory, join(dataDirectory, 'next'));
const nextEnvPath = join(webDirectory, 'next-env.d.ts');
const originalNextEnv = await readFile(nextEnvPath, 'utf8');
const v07HealthEvidenceSource = join(dataDirectory, 'v0.7-health-evidence.json');
const v07HealthEvidenceResult = join(webDirectory, 'test-results', 'evidence', 'v0.7-health-evidence.json');
const selectors = process.argv.slice(2);
const isFitnessOnly = selectors.length === 1 && selectors[0] === 'fitness-planning-loop.spec.ts';
const fitnessLogDirectory = join(dataDirectory, 'logs');
const fitnessEvidenceDirectory = join(webDirectory, 'test-results', 'evidence', 'fitness', dataDirectory.split(/[\\/]/).at(-1));
if (isFitnessOnly) {
  const realRoot = realpathSync(root);
  const realDataRoot = realpathSync(join(root, 'data'));
  const realRunsRoot = realpathSync(runDirectoryRoot);
  if (dirname(realDataRoot) !== realRoot || dirname(realRunsRoot) !== realDataRoot
    || dirname(realpathSync(dataDirectory)) !== realRunsRoot) throw new Error('FIT04C_RUN_DIRECTORY_REJECTED');
  await mkdir(fitnessLogDirectory);
}
const isV08Only = selectors.length === 1 && selectors[0] === 'v0.8-project-memory-coordination.spec.ts';
const isV09Only = selectors.length === 1 && selectors[0] === 'v0.9-private-iphone.spec.ts';
const isServerMvpOnly = selectors.length === 1 && selectors[0] === 'server-mvp.spec.ts';
// The two LOCAL_RULES paths do not invoke health fixtures. The server MVP case
// asserts meal-only lineage; it does not exercise the old workout fixture.
const skipsV07HealthEvidence = isV08Only || isV09Only || isServerMvpOnly;

function start(command, args, environment, cwd = root, stdio = 'inherit') {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...environment },
    stdio,
    windowsHide: true,
  });
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => {
      reject(new Error(`E2E test port ${port} is already in use; refusing to contact an existing service.`));
    });
    probe.listen({ host: '127.0.0.1', port }, () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
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
  if ((isFitnessOnly ? globalThis.process.platform : process.platform) === 'win32') {
    const taskkill = spawn('taskkill', ['/pid', String(process.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await waitForExit(taskkill);
    return;
  }
  process.kill('SIGTERM');
  await waitForExit(process);
}

async function waitForReady(url, process) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (process.exitCode !== null || process.signalCode !== null) {
      throw new Error(`Owned process for ${url} exited before becoming ready.`);
    }
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
    const child = start(process.execPath, [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', ...selectors], {
      EV_E2E_MANAGED: '1',
      EV_E2E_RUN_DIR: dataDirectory,
      NEXT_TELEMETRY_DISABLED: '1',
      ...(isFitnessOnly ? { EV_DATA_DIR: dataDirectory, EV_LOG_DIR: fitnessLogDirectory, EV_E2E_FITNESS_PLANNING_TEST_BOOTSTRAP: '1' } : {}),
    }, join(root, 'apps', 'web'));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

await assertPortAvailable(4327);
await assertPortAvailable(3217);

let core;
let web;
try {
  const coreEntryPoint = isFitnessOnly
    ? join(root, 'apps', 'core', 'e2e', 'fitness-planning-test-bootstrap.ts')
    : isV09Only
    ? join(root, 'apps', 'core', 'src', 'server.ts')
    : join(root, 'apps', 'core', 'e2e', 'daily-plan-test-bootstrap.ts');
  const coreEnvironment = {
    EV_CORE_HOST: '127.0.0.1',
    EV_CORE_PORT: '4327',
    EV_DATA_DIR: dataDirectory,
    EV_E2E_RUN_DIR: dataDirectory,
    EV_SECURE_COOKIES: 'false',
    EV_WEB_ORIGIN: 'http://127.0.0.1:3217',
    NEXT_TELEMETRY_DISABLED: '1',
    // The production entry point deliberately does not self-start under NODE_ENV=test.
    // V9 uses that entry point without fixture adapters, while older selectors retain test mode.
    NODE_ENV: isV09Only ? 'e2e' : 'test',
    ...(isFitnessOnly ? {
      EV_E2E_MANAGED: '1',
      EV_E2E_FITNESS_PLANNING_TEST_BOOTSTRAP: '1',
      EV_LOG_DIR: fitnessLogDirectory,
    } : isV09Only ? {} : {
      EV_E2E_DAILY_PLAN_TEST_BOOTSTRAP: '1',
      EV_E2E_V06_LEARNING_TEST_ADAPTERS: '1',
      EV_E2E_V07_HEALTH_TEST_ADAPTERS: '1',
    }),
  };
  core = start(process.execPath, ['--import', 'tsx', coreEntryPoint], coreEnvironment, root);
  await waitForReady(coreUrl, core);
  web = start(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', join(root, 'apps', 'web'), '--hostname', '127.0.0.1', '--port', '3217'], {
    ...(isFitnessOnly || isServerMvpOnly ? {
      EV_LOG_DIR: fitnessLogDirectory,
      EV_E2E_RUN_DIR: dataDirectory,
      EV_E2E_FITNESS_WEB_NETWORK_GUARD: '1',
      NODE_OPTIONS: `--import="${pathToFileURL(join(root, 'scripts', 'fitness-planning-evidence.mjs')).href}"`,
    } : {}),
    EV_CORE_URL: 'http://127.0.0.1:4327',
    EV_WEB_ORIGIN: 'http://127.0.0.1:3217',
    EV_NEXT_DIST_DIR: webRelativeDistDir,
    NEXT_TELEMETRY_DISABLED: '1',
    __NEXT_NODE_NATIVE_TS_LOADER_ENABLED: 'true',
  }, root);
  await waitForReady(webUrl, web);
  process.exitCode = await runPlaywright();
  if (isServerMvpOnly && existsSync(join(dataDirectory, 'fitness-planning-web-network-denied.json'))) {
    throw new Error('SERVER_MVP_WEB_OUTBOUND_NETWORK_DENIED');
  }
} finally {
  await stop(web);
  await stop(core);
  await writeFile(nextEnvPath, originalNextEnv, 'utf8');
  if (process.exitCode === 0) {
    if (isFitnessOnly) {
      if (existsSync(join(dataDirectory, 'fitness-planning-web-network-denied.json'))) throw new Error('FIT04C_WEB_NETWORK_EVIDENCE_REJECTED');
      await preserveFitnessPlanningEvidence(
        join(dataDirectory, 'fitness-planning-fake-evidence.json'),
        join(dataDirectory, 'fitness-planning-browser-evidence.json'),
        join(fitnessEvidenceDirectory, 'fitness-planning-evidence.json'),
        join(dataDirectory, 'fitness-planning-network-evidence.json'),
      );
      await cp(join(dataDirectory, 'fitness-planning-failed-request-facts.json'), join(fitnessEvidenceDirectory, 'fitness-planning-failed-request-facts.json'), { errorOnExist: true, force: false });
      const webNetworkEvents = join(dataDirectory, 'fitness-planning-web-network-events.jsonl');
      if (existsSync(webNetworkEvents)) await cp(webNetworkEvents, join(fitnessEvidenceDirectory, 'fitness-planning-web-network-events.jsonl'), { errorOnExist: true, force: false });
      await cp(fitnessLogDirectory, join(fitnessEvidenceDirectory, 'logs'), { recursive: true, errorOnExist: true, force: false });
    } else if (!skipsV07HealthEvidence) await preserveV07HealthEvidence(v07HealthEvidenceSource, v07HealthEvidenceResult);
    await rm(dataDirectory, { recursive: true, force: true });
  }
}
