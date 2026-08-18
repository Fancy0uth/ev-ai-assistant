import { devices, expect, test, type BrowserContext, type Page, type Route, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { DailyPlanModelOutput, DailyPlanProposal, Task } from '@ev/contracts';
import { createCalendarRepository } from '../../core/src/modules/calendar/repository';
import { createDailyPlanningContextService } from '../../core/src/modules/daily-planning/context-service';
import type { DailyPlanningProvider } from '../../core/src/modules/daily-planning/provider';
import { createDailyPlanRunRepository } from '../../core/src/modules/daily-planning/repository';
import { createDailyPlanningService } from '../../core/src/modules/daily-planning/service';
import { openDatabase } from '../../core/src/storage/database';

const owner = {
  username: 'task16-e2e-owner',
  password: 'task16-e2e-password',
};
const timestamp = '2026-08-18T07:00:00.000Z';
const fakeProviderKey = 'fake-daily-plan-provider-key';

type BrowserProblems = {
  values: string[];
};

type TimeRequestFixture = {
  localDate: string;
  title: string;
  ownerId: string;
};

type TodayResponse = {
  data: {
    events: Array<{
      title: string;
      startLocalTime: string;
      endLocalTime: string;
      isHard: boolean;
      status: string;
    }>;
  };
};

function e2eDatabasePath(): string {
  const runDirectory = process.env.EV_E2E_RUN_DIR;
  if (!runDirectory) throw new Error('daily plan E2E requires the runner-owned EV_E2E_RUN_DIR');

  const databasePath = resolve(runDirectory, 'app.sqlite');
  if (databasePath !== join(resolve(runDirectory), 'app.sqlite')) {
    throw new Error('daily plan E2E refused an unsafe fixture database path');
  }
  return databasePath;
}

function ownerId(): string {
  const database = openDatabase(e2eDatabasePath());
  try {
    const row = database.prepare('select id from owners where username = ?').get(owner.username) as
      | { id: string }
      | undefined;
    if (!row) throw new Error('daily plan E2E owner was not created');
    return row.id;
  } finally {
    database.close();
  }
}

function createTimeRequest(ownerIdValue: string, localDate: string, title: string): TimeRequestFixture {
  const database = openDatabase(e2eDatabasePath());
  try {
    createCalendarRepository(database).createTimeRequest({
      id: randomUUID(),
      ownerId: ownerIdValue,
      source: 'PROJECT_AGENT',
      title,
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '09:00',
      latestEndLocalTime: '18:00',
      isFixed: false,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { localDate, title, ownerId: ownerIdValue };
  } finally {
    database.close();
  }
}

function createScheduleChange(fixture: TimeRequestFixture): void {
  const database = openDatabase(e2eDatabasePath());
  try {
    createCalendarRepository(database).createEvent({
      id: randomUUID(),
      ownerId: fixture.ownerId,
      calendarRuleId: null,
      title: 'stale-version schedule change',
      kind: 'MEETING',
      localDate: fixture.localDate,
      startLocalTime: '10:00',
      endLocalTime: '11:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } finally {
    database.close();
  }
}

async function createFakeProviderProposal(fixture: TimeRequestFixture): Promise<DailyPlanProposal> {
  const database = openDatabase(e2eDatabasePath());
  try {
    const provider: DailyPlanningProvider = {
      async generate(apiKey, input): Promise<unknown> {
        expect(apiKey).toBe(fakeProviderKey);
        expect(input).toMatchObject({
          localDate: fixture.localDate,
          timeRequests: [
            {
              contextRef: 'TIME_REQUEST_1',
              durationMinutes: 60,
              priority: 'HIGH',
              availability: {
                earliestStartLocalTime: '09:00',
                latestEndLocalTime: '18:00',
              },
            },
          ],
        });
        const output: DailyPlanModelOutput = {
          schemaVersion: 'DAILY_PLAN_MODEL_V1',
          summary: '由测试 Fake Provider 生成的待审核安排。',
          actions: [
            {
              operation: 'SCHEDULE_TIME_REQUEST',
              contextRef: 'TIME_REQUEST_1',
              startLocalTime: '12:00',
              endLocalTime: '13:00',
              rationale: '在请求可用窗口内保留一小时的审核安排。',
            },
          ],
        };
        return output;
      },
    };
    const repository = createDailyPlanRunRepository(database);
    const service = createDailyPlanningService({
      contextService: createDailyPlanningContextService(repository, { newId: () => randomUUID() }),
      repository,
      credentialService: {
        async withApiKey(_ownerId, callback) {
          await callback(fakeProviderKey);
        },
      },
      provider,
      newId: () => randomUUID(),
      now: () => new Date(timestamp),
    });

    return await service.generateDailyPlan({
      ownerId: fixture.ownerId,
      localDate: fixture.localDate,
      trigger: 'MANUAL',
    });
  } finally {
    database.close();
  }
}

function collectBrowserProblems(page: Page): BrowserProblems {
  const values: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      values.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => values.push(`[pageerror] ${error.message}`));
  page.on('response', (response) => {
    if (response.status() === 401) values.push(`[response:401] ${response.request().method()} ${response.url()}`);
  });
  return { values };
}

async function expectNoConsoleOrPageErrors(
  testInfo: TestInfo,
  contextName: string,
  problems: BrowserProblems,
): Promise<void> {
  await testInfo.attach(`daily-plan-browser-${contextName}`, {
    body: Buffer.from(problems.values.join('\n') || 'No browser warnings or errors captured.'),
    contentType: 'text/plain',
  });
  expect(problems.values).toEqual([]);
}

async function authenticate(page: Page): Promise<void> {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: '建立本地身份' });
  const login = page.getByRole('heading', { name: '返回你的控制台' });
  await expect(setup.or(login)).toBeVisible();
  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill(owner.password);
  await page.getByRole('button', { name: (await setup.isVisible()) ? '创建本地账号' : '登录' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

async function createOpenSourceTask(page: Page, localDate: string, title: string): Promise<Task> {
  const response = await page.context().request.post('/api/core/tasks', {
    data: { title, area: 'WORK', priority: 'HIGH', targetDate: localDate },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { data: Task };
  expect(body.data.status).toBe('OPEN');
  return body.data;
}

async function readTask(page: Page, taskId: string): Promise<Task | undefined> {
  const response = await page.context().request.get('/api/core/tasks?page=1&pageSize=100');
  expect(response.status()).toBe(200);
  const body = await response.json() as { data: { items: Task[] } };
  return body.data.items.find((task) => task.id === taskId);
}

async function openDailyPlan(page: Page, localDate: string): Promise<void> {
  await page.goto('/daily-plan');
  await expect(page.getByRole('heading', { name: '每日计划审核' })).toBeVisible();
  await page.getByLabel('计划日期').fill(localDate);
  await expect(page.getByText('还没有该日期的每日计划')).toBeVisible();
}

async function generateFakeProposalInBrowser(
  page: Page,
  fixture: TimeRequestFixture,
): Promise<DailyPlanProposal> {
  let proposal: DailyPlanProposal | undefined;
  const handler = async (route: Route) => {
    expect(route.request().postDataJSON()).toEqual({ localDate: fixture.localDate });
    proposal = await createFakeProviderProposal(fixture);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: proposal }),
    });
  };

  await page.route('**/api/core/daily-plans/generate', handler);
  try {
    await page.getByRole('button', { name: '生成每日计划' }).click();
    await expect(page.getByText('由测试 Fake Provider 生成的待审核安排。')).toBeVisible();
  } finally {
    await page.unroute('**/api/core/daily-plans/generate', handler);
  }

  if (!proposal) throw new Error('fake daily plan proposal was not generated');
  return proposal;
}

async function readToday(page: Page, localDate: string): Promise<TodayResponse> {
  const response = await page.context().request.get(`/api/core/today?date=${localDate}`);
  expect(response.status()).toBe(200);
  return await response.json() as TodayResponse;
}

async function assertIPhoneReviewLayout(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const height = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0;
    return {
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      startTimeHeight: height('.daily-plan-item-card__time-inputs input'),
      applyButtonHeight: height('.daily-plan-item-card__actions button'),
    };
  });
  expect(metrics.hasHorizontalOverflow).toBe(false);
  expect(metrics.startTimeHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.applyButtonHeight).toBeGreaterThanOrEqual(44);
}

async function runApplyAndReloadLoop(
  page: Page,
  fixture: TimeRequestFixture,
  sourceTask: Task,
  touch: boolean,
): Promise<void> {
  await openDailyPlan(page, fixture.localDate);
  await generateFakeProposalInBrowser(page, fixture);
  if (touch) await assertIPhoneReviewLayout(page);

  await page.getByLabel('开始时间（请求 1）').fill('13:00');
  await page.getByLabel('结束时间（请求 1）').fill('14:00');
  const decisionResponse = page.waitForResponse((response) =>
    response.url().includes('/api/core/daily-plans/proposals/') &&
    response.url().endsWith('/decisions') &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '采用安排' }).click();
  expect((await decisionResponse).status()).toBe(200);
  await expect(page.getByText('已采用', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByLabel('计划日期').fill(fixture.localDate);
  await expect(page.getByText('已采用', { exact: true })).toBeVisible();
  expect(await readTask(page, sourceTask.id)).toEqual(sourceTask);

  const today = await readToday(page, fixture.localDate);
  expect(today.data.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: fixture.title,
        startLocalTime: '13:00',
        endLocalTime: '14:00',
        isHard: false,
        status: 'CONFIRMED',
      }),
    ]),
  );
}

async function runStaleVariant(page: Page, ownerIdValue: string): Promise<void> {
  const fixture = createTimeRequest(ownerIdValue, '2026-08-22', 'stale request must not create an event');
  await openDailyPlan(page, fixture.localDate);
  const proposal = await generateFakeProposalInBrowser(page, fixture);
  const proposalItem = proposal.items[0];
  if (!proposalItem) throw new Error('stale fixture proposal must include one item');
  createScheduleChange(fixture);

  const response = await page.context().request.post(
    `/api/core/daily-plans/proposals/${proposal.id}/decisions`,
    {
      data: {
        expectedProposalVersion: proposal.version,
        decisions: [{ itemId: proposalItem.id, decision: 'APPLY' }],
      },
    },
  );
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: 'DAILY_PLAN_BASE_VERSION_STALE' },
  });
  await page.reload();
  await page.getByLabel('计划日期').fill(fixture.localDate);
  await expect(page.getByText('已失效')).toBeVisible();

  const today = await readToday(page, fixture.localDate);
  expect(today.data.events).toEqual([
    expect.objectContaining({
      title: 'stale-version schedule change',
      startLocalTime: '10:00',
      endLocalTime: '11:00',
      isHard: true,
    }),
  ]);
  expect(today.data.events.find((event) => event.title === fixture.title)).toBeUndefined();
}

test('daily plan review applies an edited Fake-Provider proposal in isolated desktop and iPhone touch contexts without mutating its source task', async ({ browser }, testInfo) => {
  const contexts: Array<{ name: 'desktop' | 'iphone-touch'; touch: boolean; context: BrowserContext }> = [];
  let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
  let currentOwnerId: string | undefined;

  for (const device of [
    { name: 'desktop' as const, touch: false },
    { name: 'iphone-touch' as const, touch: true },
  ]) {
    const existingSession = storageState ? { storageState } : {};
    const context = device.touch
      ? await browser.newContext({ ...devices['iPhone 13'], ...existingSession })
      : await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false, ...existingSession });
    contexts.push({ ...device, context });
    const page = await context.newPage();
    const problems = collectBrowserProblems(page);

    try {
      if (!storageState) {
        await authenticate(page);
        storageState = await context.storageState();
        currentOwnerId = ownerId();

        const unconfigured = await page.context().request.post('/api/core/daily-plans/generate', {
          data: { localDate: '2026-08-24' },
        });
        expect(unconfigured.status()).toBe(409);
        expect(await unconfigured.json()).toMatchObject({
          error: { code: 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED' },
        });
      } else {
        await page.goto('/today');
        await expect(page.getByRole('heading', { name: '今天，从最重要的事开始。' })).toBeVisible();
      }

      if (!currentOwnerId) throw new Error('daily plan E2E owner id is unavailable');
      const localDate = device.touch ? '2026-08-21' : '2026-08-20';
      const taskTitle = `${device.name} source task ${randomUUID()}`;
      const sourceTask = await createOpenSourceTask(page, localDate, taskTitle);
      const fixture = createTimeRequest(currentOwnerId, localDate, `${device.name} reviewed time block`);
      await runApplyAndReloadLoop(page, fixture, sourceTask, device.touch);

      if (!device.touch) await runStaleVariant(page, currentOwnerId);
    } finally {
      await expectNoConsoleOrPageErrors(testInfo, device.name, problems);
      await context.close();
    }
  }

  expect(contexts).toHaveLength(2);
  expect(contexts.filter(({ touch }) => touch)).toHaveLength(1);
});
