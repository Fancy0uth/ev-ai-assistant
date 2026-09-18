import { expect, test, type Page } from '@playwright/test';

const owner = {
  username: 'v8-05-synthetic-owner',
  password: 'v8-05-synthetic-password',
};
const taskTitle = 'V8-05 ordinary work coordination task';

async function authenticate(page: Page): Promise<void> {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: '建立本地身份' });
  await expect(setup.or(page.getByRole('heading', { name: '返回你的控制台' }))).toBeVisible();
  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill(owner.password);
  await page.getByRole('button', { name: (await setup.isVisible()) ? '创建本地账号' : '登录' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

async function localDateFromToday(page: Page): Promise<string> {
  const label = await page.locator('.today-header .section-kicker').textContent();
  const match = label?.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match?.[1]) throw new Error(`Today did not expose its local date: ${label ?? 'missing'}`);
  return match[1];
}

test('V8-05 preserves memory compaction and a normal work LOCAL_RULES coordination review', async ({ page }) => {
  test.setTimeout(90_000);
  const browserProblems: string[] = [];
  const emptyMemoryPath = '/api/core/memory/entities/DOMAIN/GENERAL';
  let emptyMemoryResponses = 0;
  let emptyMemoryDiagnostics = 0;
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  page.on('response', (response) => {
    if (response.request().method() === 'GET' && response.status() === 404 && new URL(response.url()).pathname === emptyMemoryPath) emptyMemoryResponses += 1;
  });
  page.on('console', (message) => {
    // The new synthetic Owner has no memory document. Only that precise GET 404 is expected.
    if (message.type() === 'error' && message.text() === 'Failed to load resource: the server responded with a status of 404 (Not Found)'
      && new URL(message.location().url || 'http://127.0.0.1/').pathname === emptyMemoryPath) {
      emptyMemoryDiagnostics += 1;
      return;
    }
    if (message.type() === 'warning' || message.type() === 'error') browserProblems.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => browserProblems.push(`[pageerror] ${error.message}`));

  await authenticate(page);
  const localDate = await localDateFromToday(page);
  await page.getByLabel('新任务').fill(taskTitle);
  await page.getByLabel('领域', { exact: true }).selectOption('WORK');
  await page.getByLabel('优先级').selectOption('HIGH');
  await page.getByLabel('加入每日计划').check();
  await page.getByLabel('预计时长（分钟）').fill('60');
  await page.getByLabel('最早开始时间').fill('09:00');
  await page.getByLabel('最晚结束时间').fill('10:00');
  const taskCreated = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/core/tasks',
  );
  await page.getByRole('button', { name: '添加到今天' }).click();
  expect((await taskCreated).status()).toBe(201);
  await expect(page.getByRole('link', { name: `查看任务详情：${taskTitle}` })).toBeVisible();

  await page.goto('/memory');
  await expect(page.getByRole('heading', { name: 'Agent 本地记忆' })).toBeVisible();
  const memoryContent = page.getByLabel('GENERAL · 通用 记忆内容');
  await expect(memoryContent).toBeEditable();
  await memoryContent.fill('重复段落\n\n重复段落');
  const memorySaved = page.waitForResponse((response) =>
    response.request().method() === 'PUT' && /\/api\/core\/memory\/entities\/DOMAIN\/GENERAL$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: '追加记忆版本' }).click();
  expect((await memorySaved).status()).toBe(201);
  const draftCreated = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/core/memory/compactions',
  );
  await page.getByRole('button', { name: '生成 LOCAL_RULES 压缩草案' }).click();
  expect((await draftCreated).status()).toBe(201);
  await expect(page.getByText(/差异：保留 1 段，合并 1 段/)).toBeVisible();
  const draftConfirmed = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/core\/memory\/compactions\/drafts\/[^/]+\/confirm$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: '确认压缩草案' }).click();
  expect((await draftConfirmed).status()).toBe(200);
  await expect(page.getByText('已确认草案并追加压缩后的记忆版本。')).toBeVisible();

  await page.goto(`/daily-plan?date=${localDate}`);
  await expect(page.getByRole('heading', { name: '每日计划审核' })).toBeVisible();
  const coordinated = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/core/daily-plans/coordinate',
  );
  await page.getByRole('button', { name: '按本地静态规则协调' }).click();
  expect((await coordinated).status()).toBe(201);
  await expect(page.getByText('协调来源：LOCAL_RULES 静态规则（无模型）。')).toBeVisible();
  const scheduleAccepted = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/core\/daily-plans\/proposals\/[^/]+\/decisions$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: '采用安排' }).click();
  expect((await scheduleAccepted).status()).toBe(200);
  await expect(page.getByText('已采用，该项不再提供审核操作。')).toBeVisible();
  expect(emptyMemoryResponses).toBeGreaterThan(0);
  expect(emptyMemoryDiagnostics).toBeLessThanOrEqual(emptyMemoryResponses);
  expect(browserProblems).toEqual([]);
});
