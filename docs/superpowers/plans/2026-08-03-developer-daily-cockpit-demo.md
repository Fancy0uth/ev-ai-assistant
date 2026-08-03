# Developer Daily Cockpit Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, interactive Chinese dashboard demo for a developer's work-and-life daily execution state.

**Architecture:** A dependency-free HTML page imports one CSS stylesheet and one ES module. The module owns Demo state, derives a status score and advice from that state, and re-renders only the dynamic dashboard regions after button actions.

**Tech Stack:** HTML5, CSS3, browser ES modules, Node built-in test runner.

## Global Constraints

- Use no runtime package dependencies or build step.
- Keep all UI text in Simplified Chinese.
- Use only deterministic browser-local Demo data; no external APIs.
- Support both 1280px desktop and 390px mobile widths without horizontal overflow.

---

### Task 1: State derivation and interaction module

**Files:**
- Create: `src/dashboard.js`
- Create: `tests/dashboard.test.mjs`

**Interfaces:**
- Produces: `calculateStatus(tasks)`, `getAdvice(tasks)`, `applyAction(tasks, action, id)` exported from `src/dashboard.js`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStatus, applyAction } from '../src/dashboard.js';

test('completed core task improves execution status', () => {
  const tasks = [{ id: 'a', core: true, state: 'open' }];
  const before = calculateStatus(tasks);
  const after = calculateStatus(applyAction(tasks, 'complete', 'a'));
  assert.ok(after.score > before.score);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dashboard.test.mjs`
Expected: FAIL because `src/dashboard.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
export function calculateStatus(tasks) {
  const complete = tasks.filter((task) => task.state === 'done').length;
  return { score: 64 + complete * 8 };
}

export function applyAction(tasks, action, id) {
  return tasks.map((task) => task.id === id && action === 'complete'
    ? { ...task, state: 'done' }
    : task);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/dashboard.test.mjs`
Expected: PASS.

### Task 2: Dashboard document and visual system

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Modify: `src/dashboard.js`

**Interfaces:**
- Consumes: exported state functions from Task 1.
- Produces: an accessible dashboard with regions `#status-card`, `#task-list`, `#ai-advice` and `#toast`.

- [ ] **Step 1: Write a failing structure test**

```js
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('dashboard provides its four key regions', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['status-card', 'task-list', 'ai-advice', 'toast']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dashboard.test.mjs`
Expected: FAIL because `index.html` does not exist.

- [ ] **Step 3: Implement the static dashboard**

Create semantic header, navigation, status summary, task list, schedule, progress and lifestyle cards. Use CSS grid, custom properties, responsive media queries, visible focus states, and no external font dependency.

- [ ] **Step 4: Wire interactions**

Render task controls through `src/dashboard.js`; bind complete, defer, prioritize, focus and compact-plan actions; recompute status and advice after every action.

- [ ] **Step 5: Run tests**

Run: `node --test tests/dashboard.test.mjs`
Expected: PASS.

### Task 3: Browser verification

**Files:**
- Modify if visual issues are found: `index.html`, `styles.css`, `src/dashboard.js`

**Interfaces:**
- Consumes: fully implemented static page from Task 2.

- [ ] **Step 1: Serve the page locally**

Run: `python -m http.server 4173`

- [ ] **Step 2: Inspect desktop rendering**

Open `http://localhost:4173` at 1280px width and verify the status card, three core tasks, schedule and AI advice are visible.

- [ ] **Step 3: Inspect mobile rendering**

Open at 390px width and verify no horizontal scroll occurs.

- [ ] **Step 4: Exercise interaction controls**

Complete a task, defer a task and click compact plan; verify a toast appears and status/advice data changes.

- [ ] **Step 5: Run final tests**

Run: `node --test tests/dashboard.test.mjs`
Expected: PASS.
