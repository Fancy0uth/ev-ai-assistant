import { expect, test, type Page, type Response, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const fakeProviderEvidenceFile = 'daily-plan-fake-provider-evidence.json';

type FakeProviderEvidence = Array<{
  localDate: string;
  timeRequests: Array<{
    safeTitle: string;
    durationMinutes: number;
    availability: {
      earliestStartLocalTime: string | null;
      latestEndLocalTime: string | null;
    };
  }>;
}>;

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function runnerOwnedDirectory(): string {
  const suppliedDirectory = process.env.EV_E2E_RUN_DIR;
  if (!suppliedDirectory) throw new Error('V4-07 requires the runner-owned EV_E2E_RUN_DIR.');

  const runDirectory = resolve(suppliedDirectory);
  if (!basename(runDirectory).startsWith('managed-run-')) {
    throw new Error('V4-07 refused to create a filesystem fixture outside a managed E2E run.');
  }
  return runDirectory;
}

async function readFakeProviderEvidence(runDirectory: string): Promise<FakeProviderEvidence> {
  try {
    return JSON.parse(await readFile(join(runDirectory, fakeProviderEvidenceFile), 'utf8')) as FakeProviderEvidence;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function collectBrowserProblems(page: Page): { console: string[]; failedResponses: string[] } {
  const console: string[] = [];
  const failedResponses: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      console.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => console.push(`[pageerror] ${error.message}`));
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith('/api/core/') && response.status() >= 400) {
      failedResponses.push(`${response.request().method()} ${pathname} -> ${response.status()}`);
    }
  });
  return { console, failedResponses };
}

function isCoreResponse(response: Response, method: string, pathname: string): boolean {
  return response.request().method() === method && new URL(response.url()).pathname === pathname;
}

async function authenticateThroughUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: '建立本地身份' });
  const login = page.getByRole('heading', { name: '返回你的控制台' });
  await expect(setup.or(login)).toBeVisible();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: (await setup.isVisible()) ? '创建本地账号' : '登录' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

async function createScheduledTaskThroughUi(page: Page, title: string): Promise<void> {
  await page.getByLabel('新任务').fill(title);
  await page.getByLabel('领域', { exact: true }).selectOption('WORK');
  await page.getByLabel('优先级').selectOption('HIGH');
  await page.getByLabel('加入每日计划').check();
  const duration = page.getByLabel('预计时长（分钟）');
  await expect(duration).toHaveValue('60');
  await duration.fill('60');
  await page.getByLabel('最早开始时间').fill('10:00');
  await page.getByLabel('最晚结束时间').fill('18:00');
  const created = page.waitForResponse((response) => isCoreResponse(response, 'POST', '/api/core/tasks'));
  await page.getByRole('button', { name: '添加到今天' }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('link', { name: `查看任务详情：${title}`, exact: true })).toBeVisible();
}

async function clickRefreshAndReturn(page: Page, linkName: string, href: string, heading: string): Promise<void> {
  const link = page.getByRole('link', { name: linkName, exact: true });
  await expect(link).toHaveAttribute('href', href);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll('/', '\\/')}$`));
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll('/', '\\/')}$`));
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await page.goBack();
}

async function attachBrowserEvidence(
  testInfo: TestInfo,
  problems: { console: string[]; failedResponses: string[] },
  fakeEvidence: FakeProviderEvidence,
): Promise<void> {
  await testInfo.attach('v4-07-browser-evidence', {
    body: Buffer.from([
      ...problems.console,
      ...problems.failedResponses,
      fakeEvidence.length === 0 ? 'Fake Provider has not been called.' : JSON.stringify(fakeEvidence),
    ].join('\n') || 'No browser warnings, errors, or failed Core responses.'),
    contentType: 'text/plain',
  });
}

test('a UI-origin task is reviewed, generated by the guarded Fake, decided into Today, and reloaded through real detail URLs', async ({ page }, testInfo) => {
  const runDirectory = runnerOwnedDirectory();
  const suffix = randomUUID().replaceAll('-', '');
  const ownerUsername = `v407owner${suffix}`;
  const ownerPassword = `v407-password-${suffix}`;
  const taskTitle = `v407-primary-task-${suffix}`;
  const excludedTaskTitle = `v407-excluded-task-${suffix}`;
  const editedSafeTitle = `v407-reviewed-task-${suffix}`;
  const projectLabel = `v407-project-${suffix}`;
  const projectFixture = join(runDirectory, `v407-project-fixture-${suffix}`);
  const localDate = todayInShanghai();
  const problems = collectBrowserProblems(page);
  let fakeEvidence: FakeProviderEvidence = [];

  try {
    await mkdir(projectFixture, { recursive: true });
    await writeFile(join(projectFixture, 'PRD.md'), `# ${projectLabel}\n\nUI-origin scheduling fixture.\n`, 'utf8');
    await authenticateThroughUi(page, ownerUsername, ownerPassword);

    await createScheduledTaskThroughUi(page, taskTitle);
    const taskLink = page.getByRole('link', { name: `查看任务详情：${taskTitle}`, exact: true });
    const taskHref = await taskLink.getAttribute('href');
    expect(taskHref).toMatch(/^\/tasks\/[0-9a-f-]+$/);
    if (!taskHref) throw new Error('The UI-created Task is missing its detail href.');
    await clickRefreshAndReturn(page, `查看任务详情：${taskTitle}`, taskHref, taskTitle);
    await expect(page).toHaveURL(/\/today$/);

    const taskRead = await page.context().request.get(`/api/core${taskHref}`);
    expect(taskRead.status()).toBe(200);
    expect(await taskRead.json()).toMatchObject({
      data: { id: taskHref.slice('/tasks/'.length), title: taskTitle, scheduling: { durationMinutes: 60 } },
    });

    await createScheduledTaskThroughUi(page, excludedTaskTitle);

    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: '项目与工作流' })).toBeVisible();
    await page.getByLabel('项目名称').fill(projectLabel);
    await page.getByLabel('本机项目目录').fill(projectFixture);
    const registered = page.waitForResponse((response) => isCoreResponse(response, 'POST', '/api/core/projects'));
    await page.getByRole('button', { name: '登记只读项目范围' }).click();
    expect((await registered).status()).toBe(201);
    const projectLink = page.getByRole('link', { name: `查看项目详情：${projectLabel}`, exact: true });
    await expect(projectLink).toBeVisible();
    const projectHref = await projectLink.getAttribute('href');
    expect(projectHref).toMatch(/^\/projects\/[0-9a-f-]+$/);
    if (!projectHref) throw new Error('The UI-created Project is missing its detail href.');
    await clickRefreshAndReturn(page, `查看项目详情：${projectLabel}`, projectHref, projectLabel);
    await expect(page).toHaveURL(/\/projects$/);

    const projectRead = await page.context().request.get(`/api/core${projectHref}/snapshot`);
    expect(projectRead.status()).toBe(200);
    expect(await projectRead.json()).toMatchObject({
      data: { scope: { id: projectHref.slice('/projects/'.length), label: projectLabel } },
    });

    await page.goto('/daily-plan');
    await expect(page.getByRole('heading', { name: '每日计划审核' })).toBeVisible();
    await page.getByLabel('计划日期').fill(localDate);
    const prepared = page.waitForResponse((response) => isCoreResponse(response, 'POST', '/api/core/daily-plans/preflights'));
    await page.getByRole('button', { name: '准备外发内容' }).click();
    expect((await prepared).status()).toBe(201);

    await page.getByLabel(`安全标题：${taskTitle}`).fill(editedSafeTitle);
    await page.getByLabel(`包含/排除：${excludedTaskTitle}`).uncheck();
    const approved = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/core\/daily-plans\/preflights\/[^/]+\/approve$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole('button', { name: '批准外发内容' }).click();
    expect((await approved).status()).toBe(200);
    await expect(page.getByText('你的选择已保存，尚未调用 Provider。')).toBeVisible();
    expect(await readFakeProviderEvidence(runDirectory)).toEqual([]);

    const generated = page.waitForResponse((response) => isCoreResponse(response, 'POST', '/api/core/daily-plans/generate'));
    await page.getByRole('button', { name: '调用 Provider 生成草案' }).click();
    expect((await generated).status()).toBe(201);
    await expect.poll(() => readFakeProviderEvidence(runDirectory)).toEqual([
      {
        localDate,
        timeRequests: [
          {
            safeTitle: editedSafeTitle,
            durationMinutes: 60,
            availability: { earliestStartLocalTime: '10:00', latestEndLocalTime: '18:00' },
          },
        ],
      },
    ]);
    fakeEvidence = await readFakeProviderEvidence(runDirectory);

    await expect(page.getByRole('heading', { name: '每日计划草案' })).toBeVisible();
    const decided = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/core\/daily-plans\/proposals\/[^/]+\/decisions$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole('button', { name: '采用安排' }).click();
    expect((await decided).status()).toBe(200);

    await page.goto('/today');
    await expect(page.getByRole('heading', { name: '今天的控制台' })).toBeVisible();
    const eventLink = page.getByRole('link', { name: `查看日程详情：${taskTitle}`, exact: true });
    await expect(eventLink).toBeVisible();
    const eventHref = await eventLink.getAttribute('href');
    expect(eventHref).toMatch(/^\/schedule\/events\/[0-9a-f-]+$/);
    if (!eventHref) throw new Error('The Daily Plan decision is missing its Event detail href.');
    await clickRefreshAndReturn(page, `查看日程详情：${taskTitle}`, eventHref, taskTitle);
    await expect(page).toHaveURL(/\/today$/);

    const eventRead = await page.context().request.get(`/api/core/events/${eventHref.slice('/schedule/events/'.length)}`);
    expect(eventRead.status()).toBe(200);
    expect(await eventRead.json()).toMatchObject({
      data: { id: eventHref.slice('/schedule/events/'.length), title: taskTitle, status: 'CONFIRMED' },
    });
  } finally {
    fakeEvidence = await readFakeProviderEvidence(runDirectory);
    await attachBrowserEvidence(testInfo, problems, fakeEvidence);
  }

  expect(problems.console).toEqual([]);
  expect(problems.failedResponses).toEqual([]);
});
