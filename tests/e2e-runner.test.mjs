import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { preserveV07HealthEvidence } from '../scripts/v0.7-health-evidence.mjs';

function assertFocusedPlaywrightArguments(source) {
  assert.match(
    source,
    /\[join\(root, 'node_modules', '@playwright', 'test', 'cli\.js'\), 'test', \.\.\.process\.argv\.slice\(2\)\]/,
    'the runner must pass every npm -- argument to Playwright exactly once after the test command',
  );
}

test('managed E2E runner forwards each focused Playwright argument exactly once', async () => {
  const source = await readFile(new URL('../scripts/run-e2e.mjs', import.meta.url), 'utf8');

  assert.throws(
    () => assertFocusedPlaywrightArguments(source.replace(", 'test', ...process.argv.slice(2)], {", ", 'test'], {")),
    /must pass every npm -- argument/,
    'the guard must reject a runner that drops the focused spec',
  );
  assert.throws(
    () => assertFocusedPlaywrightArguments(source.replace(", 'test', ...process.argv.slice(2)], {", ", 'test', 'test', ...process.argv.slice(2)], {")),
    /must pass every npm -- argument/,
    'the guard must reject a runner that duplicates the Playwright test command',
  );
  assertFocusedPlaywrightArguments(source);
});

test('managed E2E runner owns isolated servers and always tears them down', async () => {
  const source = await readFile(new URL('../scripts/run-e2e.mjs', import.meta.url), 'utf8');

  assert.match(source, /EV_E2E_MANAGED/);
  assert.match(source, /EV_E2E_RUN_DIR/);
  assert.match(source, /EV_E2E_V06_LEARNING_TEST_ADAPTERS/);
  assert.match(source, /EV_E2E_V07_HEALTH_TEST_ADAPTERS/);
  assert.match(source, /EV_DATA_DIR/);
  assert.equal((source.match(/root, 'ignore'\)/g) ?? []).length, 2);
  assert.match(source, /finally/);
  assert.match(source, /taskkill/);
  assert.match(source, /if \(!process \|\| !process\.pid/);
  assert.match(source, /assertPortAvailable/);
  assert.match(source, /waitForReady\(coreUrl, core\)/);
  assert.match(source, /waitForReady\(webUrl, web\)/);
  assert.match(source, /EV_NEXT_DIST_DIR/);
  assert.match(source, /originalNextEnv/);
  assert.match(source, /await writeFile\(nextEnvPath, originalNextEnv, 'utf8'\)/);
  assert.match(source, /await rm\(dataDirectory, \{ recursive: true, force: true \}\)/);
});

test('managed E2E runner validates and preserves redacted v0.7 health evidence before cleanup', async () => {
  const source = await readFile(new URL('../scripts/run-e2e.mjs', import.meta.url), 'utf8');

  assert.match(source, /preserveV07HealthEvidence/);
  assert.match(source, /v0\.7-health-evidence\.json/);
  assert.match(source, /test-results', 'evidence/);
  const preserveAt = source.indexOf('await preserveV07HealthEvidence');
  const cleanupAt = source.indexOf('await rm(dataDirectory');
  assert.ok(preserveAt >= 0 && cleanupAt > preserveAt, 'evidence must be verified and copied before runner cleanup');
});

test('v0.7 evidence preservation rejects extra raw fields and copies an exact redacted artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ev-v07-evidence-runner-'));
  const source = join(directory, 'source.json');
  const destination = join(directory, 'results', 'evidence.json');
  const run = (capabilityKey, suffix) => ({
    capabilityKey,
    runId: `00000000-0000-4000-8000-0000000000${suffix}`,
    adapterKind: 'TEST_FIXTURE',
    evidenceKind: 'AUTOMATED_TEST_FIXTURE',
  });
  const evidence = {
    capabilityRuns: [
      run('WORKOUT_TEXT_SELECTION', '21'),
      run('MEAL_CANDIDATE_PARSE', '22'),
      run('NUTRITION_DATA_LOOKUP', '23'),
    ],
    nutritionHashes: [{ datasetHash: 'a'.repeat(64), recordHash: 'b'.repeat(64) }],
  };
  try {
    const serialized = JSON.stringify(evidence);
    await writeFile(source, serialized, 'utf8');
    await preserveV07HealthEvidence(source, destination);
    assert.equal(await readFile(destination, 'utf8'), serialized);

    await writeFile(source, JSON.stringify({ ...evidence, rawHealthInput: 'must never be copied' }), 'utf8');
    await assert.rejects(
      preserveV07HealthEvidence(source, destination),
      /V07_HEALTH_EVIDENCE_INVALID/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
