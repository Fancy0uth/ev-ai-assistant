import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const gateTestFilePath = fileURLToPath(import.meta.url);
const ownerTaskDashboardSpecPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../e2e/owner-task-dashboard.spec.ts',
);

test('owner Task E2E keeps every console diagnostic collector active across the full lifecycle', async () => {
  const source = await readFile(ownerTaskDashboardSpecPath, 'utf8');
  const gateSource = await readFile(gateTestFilePath, 'utf8');
  const normalizedSource = source.replace(/\s+/g, '');
  const firstNavigation = "await page.goto('/');";
  const consoleListener = "page.on('console', onConsole);";
  const pageErrorListener = "page.on('pageerror', onPageError);";
  const normalizedConsoleListener = "page.on('console',onConsole);";
  const normalizedPageErrorListener = "page.on('pageerror',onPageError);";
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
  expect(normalizedSource.split(normalizedConsoleListener)).toHaveLength(2);
  expect(normalizedSource.split(normalizedPageErrorListener)).toHaveLength(2);

  const firstNavigationIndex = source.indexOf(firstNavigation);
  const consoleListenerIndex = source.indexOf(consoleListener);
  const pageErrorListenerIndex = source.indexOf(pageErrorListener);
  expect(consoleListenerIndex).toBeGreaterThan(-1);
  expect(consoleListenerIndex).toBeLessThan(firstNavigationIndex);
  expect(pageErrorListenerIndex).toBeGreaterThan(-1);
  expect(pageErrorListenerIndex).toBeLessThan(firstNavigationIndex);

  for (const marker of lifecycleMarkers) {
    expect(source).toContain(marker);
    expect(source.indexOf(marker)).toBeGreaterThan(consoleListenerIndex);
    expect(source.indexOf(marker)).toBeGreaterThan(pageErrorListenerIndex);
  }

  expect(source).toContain(finalUnauthorizedAssertion);
  const finalUnauthorizedIndex = source.indexOf(finalUnauthorizedAssertion);
  const logoutIndex = source.indexOf(lifecycleMarkers[7]);
  expect(finalUnauthorizedIndex).toBeGreaterThan(logoutIndex);
  const finalDiagnosticIndexes = finalDiagnosticAssertions.map((assertion) => {
    expect(source).toContain(assertion);
    return source.indexOf(assertion);
  });
  expect(Math.min(...finalDiagnosticIndexes)).toBeGreaterThan(finalUnauthorizedIndex);
  expect(normalizedSource).not.toContain('page.off(');
  expect(normalizedSource).not.toContain('removeAllListeners(');
  expect(normalizedSource).not.toContain('removeListener(');

  for (const diagnosticArray of [
    'consoleWarnings',
    'consoleErrors',
    'pageErrors',
  ]) {
    const normalizedInitialization = `const${diagnosticArray}:string[]=[];`;
    expect(normalizedSource.split(normalizedInitialization)).toHaveLength(2);
    const sourceWithoutInitialization = normalizedSource.replace(
      normalizedInitialization,
      '',
    );
    expect(sourceWithoutInitialization).not.toMatch(
      new RegExp(`\\b${diagnosticArray}=(?!=)`),
    );
    expect(sourceWithoutInitialization).not.toContain(`${diagnosticArray}.length=0`);
    expect(sourceWithoutInitialization).not.toContain(`${diagnosticArray}.splice(`);
    expect(sourceWithoutInitialization).not.toContain(`${diagnosticArray}.pop(`);
    expect(sourceWithoutInitialization).not.toContain(`${diagnosticArray}.shift(`);
  }

  expect(gateSource).not.toMatch(
    /ownerTaskDashboardSpecPath\s*=\s*resolve\(\s*process\.cwd\(\)/,
  );
  expect(gateSource).toMatch(
    /ownerTaskDashboardSpecPath\s*=\s*resolve\(\s*dirname\(fileURLToPath\(import\.meta\.url\)\)/,
  );
});
