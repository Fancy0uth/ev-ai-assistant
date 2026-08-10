import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const ownerTaskDashboardSpecPath = resolve(
  process.cwd(),
  'e2e/owner-task-dashboard.spec.ts',
);

test('owner Task E2E collects every console diagnostic across the full lifecycle', async () => {
  const source = await readFile(ownerTaskDashboardSpecPath, 'utf8');
  const firstNavigation = "await page.goto('/');";
  const consoleListener = "page.on('console', onConsole);";
  const pageErrorListener = "page.on('pageerror', onPageError);";
  const finalUnauthorizedAssertion = 'expect(unauthorizedResponse.status()).toBe(401);';
  const finalDiagnosticAssertions = [
    'expect(consoleWarnings).toEqual([]);',
    'expect(consoleErrors).toEqual([]);',
    'expect(pageErrors).toEqual([]);',
  ];
  const lifecycleMarkers = [
    'await submitButton.click();',
    'await addTaskButton.click();',
    "await page.getByRole('button', { name: `编辑任务：${taskTitle}` }).click();",
    'expect(conflictResponse.status()).toBe(409);',
    "await page.getByRole('button', { name: `完成任务：${editedTitle}` }).click();",
    "await page.getByRole('button', { name: `延期任务：${lifecycleTitle}` }).click();",
    "await page.getByRole('button', { name: `取消任务：${lifecycleTitle}` }).click();",
    "await page.locator('.nav-rail').getByRole('button', { name: '退出' }).click();",
    finalUnauthorizedAssertion,
  ];

  expect(source).toContain(
    "if (message.type() === 'warning') consoleWarnings.push(message.text());",
  );
  expect(source).toContain(
    "if (message.type() === 'error') consoleErrors.push(message.text());",
  );
  expect(source).toContain(
    'const onPageError = (error: Error) => pageErrors.push(error.message);',
  );
  expect(source).toContain(consoleListener);
  expect(source).toContain(pageErrorListener);
  expect(source).toContain(firstNavigation);

  const firstListener = Math.min(
    source.indexOf(consoleListener),
    source.indexOf(pageErrorListener),
  );
  expect(firstListener).toBeGreaterThan(-1);
  expect(firstListener).toBeLessThan(source.indexOf(firstNavigation));

  for (const marker of lifecycleMarkers) {
    expect(source).toContain(marker);
    expect(source.indexOf(marker)).toBeGreaterThan(firstListener);
  }

  expect(source).toContain(finalUnauthorizedAssertion);
  const finalUnauthorizedIndex = source.indexOf(finalUnauthorizedAssertion);
  const finalDiagnosticIndexes = finalDiagnosticAssertions.map((assertion) => {
    expect(source).toContain(assertion);
    return source.indexOf(assertion);
  });
  expect(Math.min(...finalDiagnosticIndexes)).toBeGreaterThan(finalUnauthorizedIndex);
  expect(
    source.indexOf("page.off('console', onConsole);"),
  ).toBeGreaterThan(Math.max(...finalDiagnosticIndexes));
  expect(
    source.indexOf("page.off('pageerror', onPageError);"),
  ).toBeGreaterThan(Math.max(...finalDiagnosticIndexes));
});
