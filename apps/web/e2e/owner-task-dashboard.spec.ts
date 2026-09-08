import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('owner setup, persistent task lifecycle and logout form one real local loop', async ({
  page,
}) => {
  const consoleWarnings: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const ownerPassword = 'task16-e2e-password';
  const ownerUsername = 'task16-e2e-owner';
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'warning') consoleWarnings.push(message.text());
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = (error: Error) => pageErrors.push(error.message);

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  await page.goto('/');
  const setupHeading = page.getByRole('heading', { name: '建立本地身份' });
  const loginHeading = page.getByRole('heading', { name: '返回你的控制台' });
  await expect(setupHeading.or(loginHeading)).toBeVisible();
  const usernameInput = page.getByLabel('用户名');
  const passwordInput = page.getByLabel('密码');
  const submitButton = page.getByRole('button', {
    name: (await setupHeading.isVisible()) ? '创建本地账号' : '登录',
  });
  await page.keyboard.press('Tab');
  await expect(usernameInput).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(passwordInput).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(submitButton).toBeFocused();
  await usernameInput.fill(ownerUsername);
  await passwordInput.fill(ownerPassword);
  await submitButton.click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByRole('heading', { name: '今天的控制台' }),
  ).toBeVisible();
  const taskTitlePrefix = `task${randomUUID().replaceAll('-', '')}`;
  const taskTitle = `${taskTitlePrefix}${'x'.repeat(200 - taskTitlePrefix.length)}`;
  expect(taskTitle).toHaveLength(200);
  expect(taskTitle).not.toMatch(/\s/);
  const taskInput = page.getByLabel('新任务');
  const areaSelect = page.getByLabel('领域', { exact: true });
  const prioritySelect = page.getByLabel('优先级');
  const includeInDailyPlanCheckbox = page.getByRole('checkbox', { name: '加入每日计划' });
  const addTaskButton = page.getByRole('button', { name: '添加到今天' });
  await taskInput.focus();
  await page.keyboard.press('Tab');
  await expect(areaSelect).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(prioritySelect).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(includeInDailyPlanCheckbox).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(addTaskButton).toBeFocused();
  await taskInput.fill(taskTitle);
  await areaSelect.selectOption('WORK');
  await prioritySelect.selectOption('HIGH');
  await addTaskButton.click();

  const taskList = page.getByRole('region', { name: '今天的任务' });
  await expect(taskList.getByText(taskTitle)).toBeVisible();
  await expect(page.getByText('仍有 1 个高优先级任务')).toBeVisible();

  const lifecycleTitle = `lifecycle${randomUUID().replaceAll('-', '')}`;
  await taskInput.fill(lifecycleTitle);
  await addTaskButton.click();
  await expect(taskList.getByText(lifecycleTitle)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '移动端主导航' })).toBeVisible();
  const mobileMetrics = await page.evaluate(() => {
    const root = document.documentElement;
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const fontSize = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : undefined;
    };
    return {
      hasHorizontalOverflow: root.scrollWidth > root.clientWidth,
      overflowSources: Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((element) => element.scrollWidth > root.clientWidth)
        .map((element) => ({
          tagName: element.tagName,
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))
        .slice(0, 10),
      checkTarget: rect('.task-check-target')?.height,
      composerInput: rect('.task-composer input')?.height,
      composerSelect: rect('.task-composer select')?.height,
      composerSubmit: rect('.composer-submit')?.height,
      secondaryAction: rect('.task-secondary-action')?.height,
      composerInputFontSize: fontSize('.task-composer input'),
      composerSelectFontSize: fontSize('.task-composer select'),
      composerSubmitFontSize: fontSize('.composer-submit'),
    };
  });
  if (mobileMetrics.hasHorizontalOverflow) {
    throw new Error(`Mobile horizontal overflow: ${JSON.stringify(mobileMetrics.overflowSources)}`);
  }
  expect(mobileMetrics.checkTarget).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.composerInput).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.composerSelect).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.composerSubmit).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.secondaryAction).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.composerInputFontSize).toBeGreaterThanOrEqual(16);
  expect(mobileMetrics.composerSelectFontSize).toBeGreaterThanOrEqual(16);
  expect(mobileMetrics.composerSubmitFontSize).toBeGreaterThanOrEqual(16);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: '任务工作台' })).toBeVisible();

  await page.getByRole('button', { name: `编辑任务：${taskTitle}` }).click();
  const editedTitle = `${taskTitle.slice(0, 199)}e`;
  await page.getByLabel('编辑任务标题').fill(editedTitle);
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('button', { name: `编辑任务：${editedTitle}` })).toBeVisible();

  const authenticatedResponse = await page.context().request.get('/api/core/tasks');
  expect(authenticatedResponse.status()).toBe(200);
  const latestTasks = await authenticatedResponse.json() as {
    data: { items: Array<{ id: string; title: string; version: number }> };
  };
  const latestTask = latestTasks.data.items.find((task) => task.title === editedTitle);
  expect(latestTask).toBeDefined();
  const conflictResponse = await page.context().request.patch(`/api/core/tasks/${latestTask?.id}`, {
    data: { title: `${editedTitle.slice(0, 199)}x`, version: (latestTask?.version ?? 1) - 1 },
  });
  expect(conflictResponse.status()).toBe(409);
  const afterConflictResponse = await page.context().request.get('/api/core/tasks');
  expect(afterConflictResponse.status()).toBe(200);
  expect(JSON.stringify(await afterConflictResponse.json())).toContain(editedTitle);

  await page.getByRole('button', { name: `完成任务：${editedTitle}` }).click();
  const taskWorkspace = page.getByLabel('任务列表');
  await expect(taskWorkspace.getByText('已完成', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: `延期任务：${lifecycleTitle}` }).click();
  await page.getByLabel('延期目标日期').fill('2026-08-11');
  await page.getByRole('button', { name: '确认延期' }).click();
  await expect(taskWorkspace.getByText('已延期', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `取消任务：${lifecycleTitle}` }).click();
  await expect(taskWorkspace.getByText('已取消', { exact: true })).toBeVisible();

  await page.locator('.nav-rail').getByRole('button', { name: '退出' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '返回你的控制台' })).toBeVisible();

  const unauthorizedResponse = await page.context().request.get('/api/core/tasks');
  expect(unauthorizedResponse.status()).toBe(401);
  expect(consoleWarnings).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
