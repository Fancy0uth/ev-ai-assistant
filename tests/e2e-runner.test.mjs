import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('managed E2E runner owns isolated servers and always tears them down', async () => {
  const source = await readFile(new URL('../scripts/run-e2e.mjs', import.meta.url), 'utf8');

  assert.match(source, /EV_E2E_MANAGED/);
  assert.match(source, /EV_DATA_DIR/);
  assert.match(source, /finally/);
  assert.match(source, /taskkill/);
  assert.match(source, /if \(!process \|\| !process\.pid/);
});
