import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

// Preloaded only by the exact fitness runner's Web child. Restrict server-side
// TCP (including fetch/HTTP/TLS) to the two owned loopback ports.
if (process.env.EV_E2E_FITNESS_WEB_NETWORK_GUARD === '1') {
  if (!process.env.EV_E2E_RUN_DIR) throw new Error('FIT04C_WEB_RUN_DIRECTORY_REQUIRED');
  const runRoot = process.env.EV_E2E_RUN_DIR;
  // Next dev checks package freshness from getVersionInfo, independently of
  // telemetry. Disable only that identified optional lookup before transport.
  // Never manufacture a successful response or allow the destination through.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const stack = new Error().stack ?? '';
    if (url === 'https://registry.npmjs.org/-/package/next/dist-tags'
      && method === 'GET'
      && /getVersionInfo.*hot-reloader-shared-utils\.js/.test(stack)) {
      appendFileSync(join(runRoot, 'fitness-planning-web-network-events.jsonl'), JSON.stringify({
        pid: process.pid, role: 'NEXT_DEV', event: 'OPTIONAL_VERSION_CHECK_DISABLED', transportStarted: false,
      }) + '\n');
      return Promise.reject(new Error('FIT04C_OPTIONAL_VERSION_CHECK_DISABLED'));
    }
    return Reflect.apply(originalFetch, this, [input, init]);
  };
  const originalConnect = Socket.prototype.connect;
  let deniedCount = 0;
  Socket.prototype.connect = function (...args) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof values[0] === 'object' && values[0] !== null ? values[0] : null;
    const host = options ? options.host : values[1];
    const port = Number(options ? options.port : values[0]);
    if (host !== '127.0.0.1' || ![3217, 4327].includes(port)) {
      const evidence = { denied: true, pid: process.pid, role: 'NEXT_DEV', deniedCount: ++deniedCount,
        argumentShape: options ? 'OPTIONS' : 'POSITIONAL',
        hostClass: host === '127.0.0.1' ? 'OWNED_LOOPBACK' : host === undefined ? 'MISSING' : 'OTHER',
        portClass: [3217, 4327].includes(port) ? 'OWNED' : Number.isInteger(port) ? 'OTHER' : 'MISSING_OR_INVALID',
        reason: host !== '127.0.0.1' ? 'HOST_NOT_ALLOWED' : 'PORT_NOT_ALLOWED' };
      writeFileSync(join(runRoot, 'fitness-planning-web-network-denied.json'), JSON.stringify(evidence));
      appendFileSync(join(runRoot, 'fitness-planning-web-network-events.jsonl'), JSON.stringify(evidence) + '\n');
      throw new Error('FIT04C_WEB_OUTBOUND_NETWORK_DENIED');
    }
    return Reflect.apply(originalConnect, this, args);
  };
  syncBuiltinESMExports();
}

export const FITNESS_PLANNING_FAKE_EVIDENCE_FILE = 'fitness-planning-fake-evidence.json';
export const FITNESS_PLANNING_BROWSER_EVIDENCE_FILE = 'fitness-planning-browser-evidence.json';
export const FITNESS_PLANNING_EVIDENCE_FILE = 'fitness-planning-evidence.json';

const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fakeDescriptor = {
  providerId: 'v07-test-fixture',
  providerLabel: 'FIT04c isolated workout-planning FAKE',
  adapterKind: 'TEST_FIXTURE',
  evidenceKind: 'AUTOMATED_TEST_FIXTURE',
};

function fail(code) {
  throw new Error(code);
}

function isExactObject(value, keys) {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isBoundedInteger(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}

function hasUniqueUuidValues(values) {
  return values.every((value) => typeof value === 'string' && uuidPattern.test(value))
    && new Set(values).size === values.length;
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validateDescriptor(value) {
  if (!isExactObject(value, ['providerId', 'providerLabel', 'adapterKind', 'evidenceKind'])
    || value.providerId !== fakeDescriptor.providerId
    || value.providerLabel !== fakeDescriptor.providerLabel
    || value.adapterKind !== fakeDescriptor.adapterKind
    || value.evidenceKind !== fakeDescriptor.evidenceKind) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
  }
}

function validatePreview(value, { requireFeedback, includesFakeGeneration = false }) {
  const keys = includesFakeGeneration
    ? ['fakeGenerationObserved', 'feedbackCount', 'feedbackIds', 'memoryCount']
    : ['feedbackCount', 'feedbackIds', 'memoryCount'];
  if (!isExactObject(value, keys)
    || !isBoundedInteger(value.feedbackCount, 5)
    || !isBoundedInteger(value.memoryCount, 2)
    || !Array.isArray(value.feedbackIds)
    || value.feedbackIds.length !== value.feedbackCount
    || !hasUniqueUuidValues(value.feedbackIds)
    || (requireFeedback && (value.feedbackCount < 1 || value.memoryCount < 1))) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
  }
}

function validateFactCounts(value, expected) {
  if (!isExactObject(value, ['actions', 'events', 'timeRequests'])
    || value.actions !== expected.actions
    || value.timeRequests !== expected.timeRequests
    || value.events !== expected.events) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
  }
}

export function validateFitnessPlanningFakeEvidence(value) {
  if (!isExactObject(value, ['calls', 'descriptor', 'schemaVersion'])
    || value.schemaVersion !== 'FITNESS_PLANNING_FAKE_EVIDENCE_V1'
    || !Array.isArray(value.calls)
    || value.calls.length !== 2) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INCOMPLETE');
  }
  validateDescriptor(value.descriptor);

  for (const [index, call] of value.calls.entries()) {
    if (!isExactObject(call, ['candidateHash', 'call', 'feedbackCount', 'feedbackIds', 'memoryCount'])
      || call.call !== index + 1
      || typeof call.candidateHash !== 'string'
      || !sha256Pattern.test(call.candidateHash)) {
      fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
    }
    validatePreview({ feedbackCount: call.feedbackCount, feedbackIds: call.feedbackIds, memoryCount: call.memoryCount }, { requireFeedback: false });
  }
  return value;
}

export function validateFitnessPlanningBrowserEvidence(value) {
  if (!isExactObject(value, [
    'afterScheduleConfirmation',
    'afterSecondGeneration',
    'afterTrainingConfirmation',
    'beforeTrainingConfirmation',
    'diagnostics',
    'firstPreview',
    'providerCallCount',
    'schemaVersion',
    'secondPreview',
  ]) || value.schemaVersion !== 'FITNESS_PLANNING_BROWSER_EVIDENCE_V1'
    || value.providerCallCount !== 2) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INCOMPLETE');
  }

  validatePreview(value.firstPreview, { requireFeedback: false });
  if (value.firstPreview.feedbackCount !== 0
    || value.firstPreview.memoryCount !== 0
    || value.firstPreview.feedbackIds.length !== 0) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
  }
  validatePreview(value.secondPreview, { requireFeedback: true, includesFakeGeneration: true });
  if (value.secondPreview.fakeGenerationObserved !== true
    || value.secondPreview.feedbackCount !== 1
    || value.secondPreview.memoryCount !== 1) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
  }
  validateFactCounts(value.beforeTrainingConfirmation, { actions: 0, timeRequests: 0, events: 0 });
  validateFactCounts(value.afterTrainingConfirmation, { actions: 1, timeRequests: 1, events: 0 });
  validateFactCounts(value.afterScheduleConfirmation, { actions: 1, timeRequests: 1, events: 1 });
  validateFactCounts(value.afterSecondGeneration, { actions: 1, timeRequests: 1, events: 1 });
  if (!isExactObject(value.diagnostics, [
    'apiFailures',
    'consoleProblems',
    'externalRequests',
    'failedRequests',
    'pageErrors',
    'schedulingMode',
  ])
    || value.diagnostics.apiFailures !== 0
    || value.diagnostics.consoleProblems !== 0
    || value.diagnostics.externalRequests !== 0
    || value.diagnostics.failedRequests !== 0
    || value.diagnostics.pageErrors !== 0
    || value.diagnostics.schedulingMode !== 'LOCAL_RULES') {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
  }
  return value;
}

export async function preserveFitnessPlanningEvidence(fakeSourcePath, browserSourcePath, destinationPath, networkSourcePath) {
  const network = JSON.parse(await readFile(networkSourcePath, 'utf8'));
  if (!isExactObject(network, ['blockedNetworkRequests']) || network.blockedNetworkRequests !== 0) {
    fail('FITNESS_PLANNING_E2E_NETWORK_EVIDENCE_INVALID');
  }
  const fakeEvidence = validateFitnessPlanningFakeEvidence(JSON.parse(await readFile(fakeSourcePath, 'utf8')));
  const browserEvidence = validateFitnessPlanningBrowserEvidence(JSON.parse(await readFile(browserSourcePath, 'utf8')));
  const [firstCall] = fakeEvidence.calls;
  const lastCall = fakeEvidence.calls.at(-1);
  if (!firstCall || !lastCall
    || firstCall.feedbackCount !== 0
    || firstCall.memoryCount !== 0
    || firstCall.feedbackIds.length !== 0
    || browserEvidence.providerCallCount !== fakeEvidence.calls.length) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INCOMPLETE');
  }
  if (browserEvidence.secondPreview.fakeGenerationObserved) {
    if (fakeEvidence.calls.length !== 2
      || lastCall.feedbackCount !== browserEvidence.secondPreview.feedbackCount
      || lastCall.memoryCount !== browserEvidence.secondPreview.memoryCount
      || !sameValues(lastCall.feedbackIds, browserEvidence.secondPreview.feedbackIds)) {
      fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
    }
  } else if (fakeEvidence.calls.length !== 1) {
    fail('FITNESS_PLANNING_E2E_EVIDENCE_INVALID');
  }

  const evidence = {
    schemaVersion: 'FITNESS_PLANNING_E2E_EVIDENCE_V1',
    fake: {
      descriptor: fakeEvidence.descriptor,
      calls: fakeEvidence.calls,
    },
    browser: browserEvidence,
    network,
  };
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, JSON.stringify(evidence), 'utf8');
}
