import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDirectory, '..');
const expectedVersion = '0.9.0';
const workspacePackages = [
  ['package.json', 'ev-ai-assistant'],
  ['apps/core/package.json', '@ev/core'],
  ['apps/web/package.json', '@ev/web'],
  ['packages/contracts/package.json', '@ev/contracts'],
  ['packages/domain/package.json', '@ev/domain'],
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(workspaceRoot, relativePath), 'utf8'));
}

test('V9 release metadata, internal workspace dependencies, lockfile, and runtime APP_VERSION agree on 0.9.0', async () => {
  const packageLock = await readJson('package-lock.json');

  for (const [relativePath, expectedName] of workspacePackages) {
    const manifest = await readJson(relativePath);
    assert.equal(manifest.name, expectedName, `${relativePath} must retain its workspace name`);
    assert.equal(manifest.version, expectedVersion, `${relativePath} must use ${expectedVersion}`);

    const lockfilePath = relativePath === 'package.json' ? '' : dirname(relativePath).replaceAll('\\', '/');
    const locked = packageLock.packages[lockfilePath];
    assert.ok(locked, `package-lock.json must include ${relativePath}`);
    assert.equal(locked.name, expectedName, `lockfile name for ${relativePath} must match`);
    assert.equal(locked.version, expectedVersion, `lockfile version for ${relativePath} must use ${expectedVersion}`);

    for (const dependency of ['@ev/contracts', '@ev/domain']) {
      if (manifest.dependencies?.[dependency] !== undefined) {
        assert.equal(manifest.dependencies[dependency], expectedVersion, `${relativePath} must use ${dependency}@${expectedVersion}`);
        assert.equal(locked.dependencies?.[dependency], expectedVersion, `lockfile ${relativePath} must use ${dependency}@${expectedVersion}`);
      }
    }
  }

  assert.equal(packageLock.version, expectedVersion, 'lockfile root version must use the release version');
  const reliabilitySource = await readFile(resolve(workspaceRoot, 'packages/contracts/src/reliability.ts'), 'utf8');
  const appVersion = reliabilitySource.match(/export const APP_VERSION = '([^']+)' as const;/)?.[1];
  assert.equal(appVersion, expectedVersion, 'APP_VERSION must remain the single runtime version source');
});
