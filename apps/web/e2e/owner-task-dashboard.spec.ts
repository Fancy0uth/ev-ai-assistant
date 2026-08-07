import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('owner setup, persistent task lifecycle and logout form one real local loop', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  const ownerPassword = randomUUID();
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: '建立本地身份' })).toBeVisible();
  const usernameInput = page.getByLabel('用户名');
  const passwordInput = page.getByLabel('密码');
  const setupButton = page.getByRole('button', { name: '创建本地账号' });
  await page.keyboard.press('Tab');
  await expect(usernameInput).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(passwordInput).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(setupButton).toBeFocused();
  await usernameInput.fill('e2e-owner');
  await passwordInput.fill(ownerPassword);
  await setupButton.click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByRole('heading', { name: '今天，从最重要的事开始。' }),
  ).toBeVisible();
  await expect(page.getByText('今天还没有任务')).toBeVisible();
  const agentPanel = page.getByRole('complementary', { name: 'Agent 状态' });
  await expect(agentPanel.getByText('DeepSeek', { exact: true })).toBeVisible();
  await expect(agentPanel.getByText('未配置', { exact: true }).first()).toBeVisible();

  const taskTitle = '完成 Dashboard 真实闭环';
  const taskInput = page.getByLabel('新任务');
  const areaSelect = page.getByLabel('领域');
  const prioritySelect = page.getByLabel('优先级');
  const addTaskButton = page.getByRole('button', { name: '添加到今天' });
  await taskInput.focus();
  await page.keyboard.press('Tab');
  await expect(areaSelect).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(prioritySelect).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(addTaskButton).toBeFocused();
  await taskInput.fill(taskTitle);
  await areaSelect.selectOption('WORK');
  await prioritySelect.selectOption('HIGH');
  await addTaskButton.click();

  const taskList = page.getByRole('region', { name: '今天的任务' });
  await expect(taskList.getByText(taskTitle)).toBeVisible();
  await expect(page.getByText('仍有 1 个高优先级任务')).toBeVisible();

  await page.reload();
  await expect(taskList.getByText(taskTitle)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `完成任务：${taskTitle}` })).toBeVisible();

  await page.getByRole('checkbox', { name: `完成任务：${taskTitle}` }).click();
  await expect(page.getByText('已完成 1/1 个任务')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `重新打开任务：${taskTitle}` })).toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '移动端主导航' })).toBeVisible();
  const mobileMetrics = await page.evaluate(() => {
    const root = document.documentElement;
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    return {
      hasHorizontalOverflow: root.scrollWidth > root.clientWidth,
      checkTarget: rect('.task-check-target')?.height,
      composerInput: rect('.task-composer input')?.height,
      composerSelect: rect('.task-composer select')?.height,
      composerSubmit: rect('.composer-submit')?.height,
      secondaryAction: rect('.task-secondary-action')?.height,
    };
  });
  expect(mobileMetrics.hasHorizontalOverflow).toBe(false);
  expect(mobileMetrics.checkTarget).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.composerInput).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.composerSelect).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.composerSubmit).toBeGreaterThanOrEqual(44);
  expect(mobileMetrics.secondaryAction).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('complementary', { name: 'Agent 状态' })).toBeVisible();

  const authenticatedResponse = await page.context().request.get('/api/core/tasks');
  expect(authenticatedResponse.status()).toBe(200);

  await page.locator('.nav-rail').getByRole('button', { name: '退出' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '返回你的控制台' })).toBeVisible();

  const unauthorizedResponse = await page.context().request.get('/api/core/tasks');
  expect(unauthorizedResponse.status()).toBe(401);
  expect(browserErrors).toEqual([]);
});
