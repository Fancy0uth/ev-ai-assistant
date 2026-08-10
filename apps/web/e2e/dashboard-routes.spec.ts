import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const viewports = [
  { name: 'desktop-wide', width: 1440, height: 900, hasTouch: false },
  { name: 'desktop-compact', width: 1024, height: 768, hasTouch: false },
  { name: 'touch-large', width: 390, height: 844, hasTouch: true },
  { name: 'touch-small', width: 320, height: 800, hasTouch: true },
] as const;

const owner = {
  username: 'task16-e2e-owner',
  password: 'task16-e2e-password',
};

function collectBrowserProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      problems.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));
  return problems;
}

async function attachBrowserProblems(testInfo: TestInfo, name: string, problems: string[]) {
  await testInfo.attach(`browser-${name}`, {
    body: Buffer.from(problems.join('\n') || 'No browser warnings or errors captured.'),
    contentType: 'text/plain',
  });
}

async function authenticate(
  page: Page,
  owner: { username: string; password: string },
): Promise<void> {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: '建立本地身份' });
  const login = page.getByRole('heading', { name: '返回你的控制台' });
  await expect(setup.or(login)).toBeVisible();

  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill(owner.password);
  await page.getByRole('button', { name: (await setup.isVisible()) ? '创建本地账号' : '登录' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

test('four isolated contexts for one owner cover dashboard links, direct routes, reload, history and responsive layouts', async ({ browser }, testInfo) => {
  const contextIds = new Set<object>();
  const usernames = new Set<string>();

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.hasTouch,
    });
    contextIds.add(context);
    const page = await context.newPage();

    try {
      await authenticate(page, owner);
      usernames.add(owner.username);
      const browserProblems = collectBrowserProblems(page);

      const navigation = page.getByRole('navigation', {
        name: viewport.hasTouch ? '移动端主导航' : '主导航',
      });
      const todayLink = navigation.locator('a[href="/today"]');
      const tasksLink = navigation.locator('a[href="/tasks"]');
      const agentLink = navigation.locator('a[href="/agent"]');
      await expect(todayLink).toBeVisible();
      await expect(tasksLink).toBeVisible();
      await expect(agentLink).toBeVisible();

      await page.goto('/today');
      await expect(page).toHaveURL(/\/today$/);
      await expect(page.getByRole('heading', { name: '今天，从最重要的事开始。' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: '今天，从最重要的事开始。' })).toBeVisible();
      await todayLink.click();
      await expect(page).toHaveURL(/\/today$/);

      await page.goto('/tasks');
      await expect(page).toHaveURL(/\/tasks$/);
      await expect(page.getByRole('heading', { name: '任务工作台' })).toBeVisible();
      const taskTitle = `task16-route-${viewport.name}-${randomUUID().replaceAll('-', '')}`;
      await page.getByLabel('新建任务标题').fill(taskTitle);
      await page.getByRole('button', { name: '创建任务' }).click();
      await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: '任务工作台' })).toBeVisible();
      await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
      await tasksLink.click();
      await expect(page).toHaveURL(/\/tasks$/);

      await page.goto('/agent');
      await expect(page).toHaveURL(/\/agent$/);
      await expect(page.getByRole('heading', { name: 'Agent 工作台' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Agent 工作台' })).toBeVisible();

      await todayLink.click();
      await expect(page).toHaveURL(/\/today$/);
      await agentLink.click();
      await expect(page).toHaveURL(/\/agent$/);
      await expect(agentLink).toHaveAttribute('aria-current', 'page');

      await page.goBack();
      await expect(page).toHaveURL(/\/today$/);
      await expect(todayLink).toHaveAttribute('aria-current', 'page');
      await page.goForward();
      await expect(page).toHaveURL(/\/agent$/);
      await expect(agentLink).toHaveAttribute('aria-current', 'page');

      if (viewport.hasTouch) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      }

      await attachBrowserProblems(testInfo, viewport.name, browserProblems);
      expect(browserProblems).toEqual([]);
    } finally {
      await context.close();
    }
  }

  expect(contextIds.size).toBe(4);
  expect(usernames.size).toBe(1);
});
