import { devices, expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  dailyPlanPreflightResponseSchema,
  dailyPlanDecisionBatchResponseSchema,
  dailyPlanProposalResponseSchema,
  dailyPlanReviewListResponseSchema,
  type DailyPlanProposal,
  type DailyPlanReview,
  type Task,
} from '@ev/contracts';
import { createCalendarRepository } from '../../core/src/modules/calendar/repository';
import { openDatabase } from '../../core/src/storage/database';

const owner = {
  username: 'task16-e2e-owner',
  password: 'task16-e2e-password',
};
const timestamp = '2026-08-18T07:00:00.000Z';
const staleDecisionConsoleDiagnostic = 'Failed to load resource: the server responded with a status of 409 (Conflict)';

type BrowserProblems = {
  values: string[];
  expectedStaleDiagnostic: {
    decisionPath: string;
    responseObserved: boolean;
    diagnostics: string[];
  } | null;
};

type TimeRequestFixture = {
  id: string;
  localDate: string;
  title: string;
  ownerId: string;
};

type DailyPlanFixture = {
  localDate: string;
  ownerId: string;
  timeRequests: TimeRequestFixture[];
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

function pathnameFromConsoleLocation(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

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

function createTimeRequest(
  ownerIdValue: string,
  localDate: string,
  title: string,
  createdAt: string,
): TimeRequestFixture {
  const database = openDatabase(e2eDatabasePath());
  try {
    const id = randomUUID();
    createCalendarRepository(database).createTimeRequest({
      id,
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
      createdAt,
      updatedAt: createdAt,
    });
    return { id, localDate, title, ownerId: ownerIdValue };
  } finally {
    database.close();
  }
}

function createDailyPlanFixture(
  ownerIdValue: string,
  localDate: string,
  titles: readonly string[],
): DailyPlanFixture {
  return {
    ownerId: ownerIdValue,
    localDate,
    timeRequests: titles.map((title, index) =>
      createTimeRequest(ownerIdValue, localDate, title, `2026-08-18T07:0${index}:00.000Z`),
    ),
  };
}

function createScheduleChange(fixture: DailyPlanFixture): void {
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

function collectBrowserProblems(page: Page): BrowserProblems {
  const problems: BrowserProblems = {
    values: [],
    expectedStaleDiagnostic: null,
  };
  page.on('console', (message) => {
    if (message.type() !== 'warning' && message.type() !== 'error') return;

    const staleDiagnostic = problems.expectedStaleDiagnostic;
    const locationPath = pathnameFromConsoleLocation(message.location().url);
    if (
      staleDiagnostic &&
      message.type() === 'error' &&
      message.text() === staleDecisionConsoleDiagnostic &&
      locationPath === staleDiagnostic.decisionPath
    ) {
      staleDiagnostic.diagnostics.push(message.text());
      return;
    }
    problems.values.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.values.push(`[pageerror] ${error.message}`));
  page.on('response', (response) => {
    const staleDiagnostic = problems.expectedStaleDiagnostic;
    if (
      staleDiagnostic &&
      response.request().method() === 'POST' &&
      response.status() === 409 &&
      new URL(response.url()).pathname === staleDiagnostic.decisionPath
    ) {
      staleDiagnostic.responseObserved = true;
    }
    if (response.status() === 401) {
      problems.values.push(`[response:401] ${response.request().method()} ${response.url()}`);
    }
  });
  return problems;
}

function expectStaleDecisionConsoleDiagnostic(
  problems: BrowserProblems,
  decisionPath: string,
): void {
  if (problems.expectedStaleDiagnostic !== null) {
    throw new Error('daily plan E2E may arm only one expected stale decision diagnostic');
  }
  problems.expectedStaleDiagnostic = {
    decisionPath,
    responseObserved: false,
    diagnostics: [],
  };
}

async function expectNoConsoleOrPageErrors(
  testInfo: TestInfo,
  contextName: string,
  problems: BrowserProblems,
): Promise<void> {
  const staleDiagnostic = problems.expectedStaleDiagnostic;
  if (staleDiagnostic) {
    expect(staleDiagnostic.responseObserved).toBe(true);
    expect(staleDiagnostic.diagnostics).toEqual([staleDecisionConsoleDiagnostic]);
  }
  await testInfo.attach(`daily-plan-browser-${contextName}`, {
    body: Buffer.from([
      ...problems.values,
      ...(staleDiagnostic
        ? [`[expected-stale-409] ${staleDiagnostic.decisionPath}: ${staleDiagnostic.diagnostics.join(', ')}`]
        : []),
    ].join('\n') || 'No browser warnings or errors captured.'),
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

async function createUnrelatedOpenTask(page: Page, localDate: string, title: string): Promise<Task> {
  const response = await page.context().request.post('/api/core/tasks', {
    data: { title, area: 'WORK', priority: 'HIGH', targetDate: localDate },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { data: Task };
  expect(body.data.status).toBe('OPEN');
  return body.data;
}

async function readUnrelatedTask(page: Page, taskId: string): Promise<Task | undefined> {
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

async function prepareAndApproveDailyPlan(page: Page, localDate: string): Promise<{
  preflightId: string;
  expectedPreflightVersion: number;
}> {
  const preparedResponse = await page.context().request.post('/api/core/daily-plans/preflights', {
    data: { localDate },
  });
  expect(preparedResponse.status()).toBe(201);
  const prepared = dailyPlanPreflightResponseSchema.parse(await preparedResponse.json()).data;
  const approvedResponse = await page.context().request.post(
    `/api/core/daily-plans/preflights/${prepared.id}/approve`,
    {
      data: {
        expectedPreflightVersion: prepared.version,
        items: prepared.items.map((item) => ({
          contextRef: item.contextRef,
          safeTitle: item.safeTitle,
          domain: item.domain,
          deadlineLocalDate: item.deadlineLocalDate,
          included: item.included,
        })),
      },
    },
  );
  expect(approvedResponse.status()).toBe(200);
  const approved = dailyPlanPreflightResponseSchema.parse(await approvedResponse.json()).data;
  return { preflightId: approved.id, expectedPreflightVersion: approved.version };
}

function isCoreProxyResponse(
  response: Awaited<ReturnType<Page['waitForResponse']>>,
  method: string,
  pathname: string,
): boolean {
  return response.request().method() === method && new URL(response.url()).pathname === pathname;
}

function reviewFromListResponse(responseBody: unknown, proposalId: string): DailyPlanReview {
  const response = dailyPlanReviewListResponseSchema.parse(responseBody);
  const review = response.data.items.find((item) => item.proposal.id === proposalId);
  if (!review) throw new Error(`daily plan ${proposalId} was missing from the actual proposal-list response`);
  return review;
}

async function generateProposalInBrowser(
  page: Page,
  fixture: DailyPlanFixture,
  proveIdempotency = false,
): Promise<DailyPlanProposal> {
  const prepared = page.waitForResponse((response) =>
    isCoreProxyResponse(response, 'POST', '/api/core/daily-plans/preflights'),
  );
  await page.getByRole('button', { name: '准备外发内容' }).click();
  expect((await prepared).status()).toBe(201);

  const approved = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    /\/api\/core\/daily-plans\/preflights\/[^/]+\/approve$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: '批准外发内容' }).click();
  expect((await approved).status()).toBe(200);

  const generated = page.waitForResponse((response) =>
    isCoreProxyResponse(response, 'POST', '/api/core/daily-plans/generate'),
  );
  const listed = page.waitForResponse((response) => {
    if (!isCoreProxyResponse(response, 'GET', '/api/core/daily-plans/proposals')) return false;
    return new URL(response.url()).searchParams.get('localDate') === fixture.localDate;
  });

  await page.getByRole('button', { name: '调用 Provider 生成草案' }).click();

  const generationResponse = await generated;
  expect(generationResponse.status()).toBe(201);
  const proposal = dailyPlanProposalResponseSchema.parse(await generationResponse.json()).data;
  expect(proposal.items).toHaveLength(fixture.timeRequests.length);

  if (proveIdempotency) {
    const requestInput = generationResponse.request().postDataJSON() as {
      preflightId: string;
      expectedPreflightVersion: number;
    };
    const idempotencyKey = generationResponse.request().headers()['idempotency-key'];
    expect(idempotencyKey).toMatch(/^web-/);

    const replay = await page.context().request.post('/api/core/daily-plans/generate', {
      data: requestInput,
      headers: { 'Idempotency-Key': idempotencyKey ?? '' },
    });
    expect(replay.status()).toBe(201);
    expect(replay.headers()['idempotency-replayed']).toBe('true');
    expect(dailyPlanProposalResponseSchema.parse(await replay.json()).data).toEqual(proposal);

    const conflict = await page.context().request.post('/api/core/daily-plans/generate', {
      data: { ...requestInput, expectedPreflightVersion: requestInput.expectedPreflightVersion + 1 },
      headers: { 'Idempotency-Key': idempotencyKey ?? '' },
    });
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  }

  const listResponse = await listed;
  expect(listResponse.status()).toBe(200);
  const listedReview = reviewFromListResponse(await listResponse.json(), proposal.id);
  expect(listedReview.proposal).toMatchObject({ id: proposal.id, status: 'PENDING_REVIEW' });
  await expect(page.getByText('由测试 Fake Provider 生成的待审核安排。')).toBeVisible();

  return proposal;
}

function itemForRequest(review: DailyPlanReview, request: TimeRequestFixture) {
  const item = review.proposal.items.find((candidate) => candidate.timeRequestId === request.id);
  if (!item) throw new Error(`daily plan item for ${request.title} was not returned`);
  return item;
}

function expectPartialApplyState(review: DailyPlanReview, fixture: DailyPlanFixture): void {
  const [firstRequest, secondRequest] = fixture.timeRequests;
  if (!firstRequest || !secondRequest) throw new Error('partial apply fixture requires exactly two time requests');

  expect(review.proposal.status).toBe('PARTIALLY_APPLIED');
  expect(itemForRequest(review, firstRequest)).toMatchObject({
    operation: 'SCHEDULE_TIME_REQUEST',
    status: 'APPLIED',
    startLocalTime: '13:00',
    endLocalTime: '14:00',
  });
  expect(itemForRequest(review, secondRequest)).toMatchObject({
    operation: 'SCHEDULE_TIME_REQUEST',
    status: 'PENDING_REVIEW',
  });
}

async function readToday(page: Page, localDate: string): Promise<TodayResponse> {
  const response = await page.context().request.get(`/api/core/today?date=${localDate}`);
  expect(response.status()).toBe(200);
  return await response.json() as TodayResponse;
}

async function assertIPhoneReviewLayout(page: Page): Promise<void> {
  const timeInputs = [
    page.getByLabel('开始时间（请求 1）'),
    page.getByLabel('结束时间（请求 1）'),
    page.getByLabel('开始时间（请求 2）'),
    page.getByLabel('结束时间（请求 2）'),
  ];
  for (const input of timeInputs) {
    await expect(input).toBeVisible();
    expect((await input.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const applyButtons = page.getByRole('button', { name: '采用安排', exact: true });
  await expect(applyButtons).toHaveCount(2);
  for (let index = 0; index < await applyButtons.count(); index += 1) {
    const button = applyButtons.nth(index);
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
}

async function runPartialApplyAndReloadLoop(
  page: Page,
  fixture: DailyPlanFixture,
  unrelatedTask: Task,
  touch: boolean,
): Promise<void> {
  const [firstRequest, secondRequest] = fixture.timeRequests;
  if (!firstRequest || !secondRequest) throw new Error('partial apply fixture requires exactly two time requests');

  await openDailyPlan(page, fixture.localDate);
  const proposal = await generateProposalInBrowser(page, fixture, !touch);
  const explanationResponse = page.waitForResponse((response) =>
    isCoreProxyResponse(response, 'GET', `/api/core/daily-plans/proposals/${proposal.id}/explanation`),
  );
  await page.getByText('查看本次上下文与校验', { exact: true }).click();
  expect((await explanationResponse).status()).toBe(200);
  await expect(page.getByText(/草案基于日程版本 v\d+；当前为 v\d+。/)).toBeVisible();
  await expect(page.getByRole('list', { name: '本次上下文类别' })).toBeVisible();
  expect(proposal.items.map((item) => item.operation)).toEqual([
    'SCHEDULE_TIME_REQUEST',
    'SCHEDULE_TIME_REQUEST',
  ]);
  if (touch) await assertIPhoneReviewLayout(page);

  const firstItem = page.getByRole('listitem').filter({ hasText: '请求 1' });
  const secondItem = page.getByRole('listitem').filter({ hasText: '请求 2' });
  await firstItem.getByLabel('开始时间（请求 1）').fill('13:00');
  await firstItem.getByLabel('结束时间（请求 1）').fill('14:00');
  const decisionResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    /\/api\/core\/daily-plans\/proposals\/[^/]+\/decisions$/.test(new URL(response.url()).pathname),
  );
  await firstItem.getByRole('button', { name: '采用安排', exact: true }).click();
  const appliedResponse = await decisionResponse;
  expect(appliedResponse.status()).toBe(200);
  const appliedReview = dailyPlanDecisionBatchResponseSchema.parse(await appliedResponse.json()).data;
  expectPartialApplyState(appliedReview, fixture);
  await expect(page.getByText('部分已处理')).toBeVisible();
  await expect(firstItem.getByText('已采用', { exact: true })).toBeVisible();
  await expect(firstItem.getByRole('button', { name: '采用安排', exact: true })).toHaveCount(0);
  await expect(secondItem.getByText('待审核', { exact: true })).toBeVisible();
  await expect(secondItem.getByRole('button', { name: '采用安排', exact: true })).toBeEnabled();

  await page.reload();
  await expect(page.getByRole('heading', { name: '每日计划审核' })).toBeVisible();
  const reloadedList = page.waitForResponse((response) => {
    if (!isCoreProxyResponse(response, 'GET', '/api/core/daily-plans/proposals')) return false;
    return new URL(response.url()).searchParams.get('localDate') === fixture.localDate;
  });
  await page.getByLabel('计划日期').fill(fixture.localDate);
  const reloadedResponse = await reloadedList;
  expect(reloadedResponse.status()).toBe(200);
  expectPartialApplyState(reviewFromListResponse(await reloadedResponse.json(), proposal.id), fixture);
  await expect(page.getByText('部分已处理')).toBeVisible();
  await expect(firstItem.getByText('已采用', { exact: true })).toBeVisible();
  await expect(secondItem.getByText('待审核', { exact: true })).toBeVisible();
  await expect(secondItem.getByRole('button', { name: '采用安排', exact: true })).toBeEnabled();
  expect(await readUnrelatedTask(page, unrelatedTask.id)).toEqual(unrelatedTask);

  const today = await readToday(page, fixture.localDate);
  expect(today.data.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: firstRequest.title,
        startLocalTime: '13:00',
        endLocalTime: '14:00',
        isHard: false,
        status: 'CONFIRMED',
      }),
    ]),
  );
  expect(today.data.events.find((event) => event.title === secondRequest.title)).toBeUndefined();
}

async function runStaleVariant(page: Page, ownerIdValue: string, problems: BrowserProblems): Promise<void> {
  const fixture = createDailyPlanFixture(ownerIdValue, '2026-08-22', ['stale request must not create an event']);
  await openDailyPlan(page, fixture.localDate);
  const proposal = await generateProposalInBrowser(page, fixture);
  const proposalItem = proposal.items[0];
  if (!proposalItem) throw new Error('stale fixture proposal must include one item');
  createScheduleChange(fixture);

  const staleDecisionPath = `/api/core/daily-plans/proposals/${proposal.id}/decisions`;
  expectStaleDecisionConsoleDiagnostic(problems, staleDecisionPath);
  const staleDecision = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === staleDecisionPath,
  );
  await page.getByRole('button', { name: '采用安排', exact: true }).click();
  const staleResponse = await staleDecision;
  expect(staleResponse.status()).toBe(409);
  expect(await staleResponse.json()).toMatchObject({
    error: { code: 'DAILY_PLAN_BASE_VERSION_STALE' },
  });
  await expect(page.getByRole('region', { name: '每日计划审核' }).getByRole('alert')).toContainText('日程已变化');
  await expect(page.getByRole('region', { name: '每日计划审核' }).getByText(/\/ 已失效$/)).toBeVisible();

  const staleItem = page.getByRole('listitem').filter({ hasText: '请求 1' });
  await expect(staleItem.getByLabel('开始时间（请求 1）')).toBeDisabled();
  await expect(staleItem.getByLabel('结束时间（请求 1）')).toBeDisabled();
  await expect(staleItem.getByLabel('拒绝原因（请求 1）')).toBeDisabled();
  await expect(staleItem.getByRole('button', { name: '采用安排', exact: true })).toBeDisabled();
  await expect(staleItem.getByRole('button', { name: '拒绝安排', exact: true })).toBeDisabled();

  const today = await readToday(page, fixture.localDate);
  expect(today.data.events).toEqual([
    expect.objectContaining({
      title: 'stale-version schedule change',
      startLocalTime: '10:00',
      endLocalTime: '11:00',
      isHard: true,
    }),
  ]);
  expect(today.data.events.find((event) => event.title === fixture.timeRequests[0]?.title)).toBeUndefined();
}

test('daily plan review partially applies one edited item in isolated desktop and iPhone touch contexts while an unrelated same-date OPEN Task remains unchanged', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
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

        const unconfiguredInput = await prepareAndApproveDailyPlan(page, '2026-08-24');
        const unconfigured = await page.context().request.post('/api/core/daily-plans/generate?e2eWithoutTestCredential=1', {
          data: unconfiguredInput,
          headers: { 'Idempotency-Key': 'v05-e2e-provider-not-configured' },
        });
        expect(unconfigured.status()).toBe(409);
        expect(await unconfigured.json()).toMatchObject({
          error: { code: 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED' },
        });
      } else {
        await page.goto('/today');
        await expect(page.getByRole('heading', { name: '今天的控制台' })).toBeVisible();
      }

      if (!currentOwnerId) throw new Error('daily plan E2E owner id is unavailable');
      const localDate = device.touch ? '2026-08-21' : '2026-08-20';
      const unrelatedTask = await createUnrelatedOpenTask(
        page,
        localDate,
        `${device.name} unrelated same-date task ${randomUUID()}`,
      );
      const fixture = createDailyPlanFixture(currentOwnerId, localDate, [
        `${device.name} first reviewed time block`,
        `${device.name} second pending time block`,
      ]);
      await runPartialApplyAndReloadLoop(page, fixture, unrelatedTask, device.touch);

      if (!device.touch) await runStaleVariant(page, currentOwnerId, problems);
    } finally {
      await expectNoConsoleOrPageErrors(testInfo, device.name, problems);
      await context.close();
    }
  }

  expect(contexts).toHaveLength(2);
  expect(contexts.filter(({ touch }) => touch)).toHaveLength(1);
});
