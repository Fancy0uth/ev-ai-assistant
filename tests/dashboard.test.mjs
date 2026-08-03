import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateStatus, applyAction, getAdvice } from '../src/dashboard.js';

test('completed core task improves execution status', () => {
  const tasks = [{ id: 'review', core: true, state: 'open' }];

  const before = calculateStatus(tasks);
  const after = calculateStatus(applyAction(tasks, 'complete', 'review'));

  assert.ok(after.score > before.score);
});

test('deferred task produces a recovery-focused recommendation', () => {
  const tasks = [{ id: 'study', core: false, state: 'deferred' }];

  assert.match(getAdvice(tasks).title, /收缩|恢复/);
});

test('dashboard provides its four key regions', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  for (const id of ['status-card', 'task-list', 'ai-advice', 'toast']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
