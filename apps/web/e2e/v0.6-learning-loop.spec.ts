import { devices, expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import {
  dailyPlanDecisionBatchResponseSchema,
  learningRunGenerateResponseSchema,
  todaySnapshotSchema,
} from '@ev/contracts';

const owner = {
  username: 'task16-e2e-owner',
  password: 'task16-e2e-password',
};

const rawPngFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLLOAAAAABJRU5ErkJggg==',
  'base64',
);

type BrowserProblems = { values: string[] };
type LearningLineage = {
  courseId: string;
  actionId: string;
  timeRequestId: string;
  eventId: string;
};

const fakeLearningTitle = 'V6 cited linear algebra study';

function collectBrowserProblems(page: Page): BrowserProblems {
  const problems: BrowserProblems = { values: [] };
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      problems.values.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.values.push(`[pageerror] ${error.message}`));
  page.on('response', (response) => {
    if (response.status() === 401) {
      problems.values.push(`[response:401] ${response.request().method()} ${response.url()}`);
    }
  });
  return problems;
}

async function expectNoBrowserProblems(
  testInfo: TestInfo,
  contextName: string,
  problems: BrowserProblems,
): Promise<void> {
  await testInfo.attach(`v06-learning-browser-${contextName}`, {
    body: Buffer.from(problems.values.join('\n') || 'No browser warnings or errors captured.'),
    contentType: 'text/plain',
  });
  expect(problems.values).toEqual([]);
}

async function authenticate(page: Page): Promise<void> {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: '建立本地身份' });
  const login = page.getByRole('heading', { name: '返回你的控制台' });
  const today = page.getByRole('heading', { name: '今天的控制台' });
  await expect(setup.or(login).or(today)).toBeVisible();
  if (await today.isVisible()) return;
  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill(owner.password);
  await page.getByRole('button', { name: (await setup.isVisible()) ? '创建本地账号' : '登录' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

async function todayDate(page: Page): Promise<string> {
  const label = await page.locator('.today-header .section-kicker').textContent();
  const match = label?.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match?.[1]) throw new Error(`Today did not expose its local date: ${label ?? 'missing'}`);
  return match[1];
}

async function importReviewedCourse(page: Page, name: string): Promise<void> {
  await page.goto('/schedule');
  await expect(page.getByRole('heading', { name: '日程与课表' })).toBeVisible();
  await page.getByLabel('学期名称').fill(`V6 ${name} 学期`);
  await page.getByLabel('第一教学周的周一').fill('2026-08-31');
  await page.getByRole('button', { name: '建立本地学期' }).click();
  await page.getByLabel('课表截图').setInputFiles({
    name: 'v06-timetable.png',
    mimeType: 'image/png',
    buffer: rawPngFixture,
  });
  await page.getByRole('button', { name: '保存并查看外发披露' }).click();
  await expect(page.getByRole('heading', { name: '请确认外发披露' })).toBeVisible();
  await expect(page.getByText('自动测试 Fake 证据，不代表真实 Provider。')).toBeVisible();
  await page.getByRole('button', { name: '确认披露并提取候选' }).click();
  await expect(page.getByRole('heading', { name: '审阅课表候选' })).toBeVisible();
  await expect(page.getByText('总体置信度：1')).toBeVisible();
  const title = page.getByLabel('课程标题：V6 Fake Timetable Course');
  await title.fill(`V6 ${name} 课程`);
  await expect(page.getByRole('button', { name: '确认导入课程' })).toHaveCount(0);
  await page.getByRole('button', { name: '保存审阅版本' }).click();
  await expect(page.getByRole('button', { name: '确认导入课程' })).toBeEnabled();
  await page.getByRole('button', { name: '确认导入课程' }).click();
  await expect(page.getByText('状态：SCHEDULE_PROPOSAL_PENDING。日程事件只会在排程 Proposal 被接受后生成。')).toBeVisible();
}

async function acceptPendingProposal(page: Page): Promise<void> {
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: '今天的控制台' })).toBeVisible();
  const acceptButton = page.getByRole('button', { name: '确认安排' });
  await expect(acceptButton).toHaveCount(1);
  await expect(acceptButton).toBeVisible();
  await acceptButton.click();
  await expect(page.getByText('没有待确认的日程变更。')).toBeVisible();
}

function courseIdFromCurrentUrl(page: Page): string {
  const match = new URL(page.url()).pathname.match(/^\/courses\/([0-9a-f-]{36})$/i);
  if (!match?.[1]) throw new Error(`Course detail did not expose a UUID route: ${page.url()}`);
  return match[1];
}

async function createAndAcceptLearningProposal(
  page: Page,
  name: string,
  targetDate: string,
): Promise<Omit<LearningLineage, 'eventId'>> {
  await page.goto('/learning');
  await expect(page.getByRole('heading', { name: '学习与课程' })).toBeVisible();
  const courseCard = page.locator('.course-list > li').filter({
    has: page.getByRole('button', { name: `选择课程：V6 ${name} 课程` }),
  });
  await expect(courseCard).toHaveCount(1);
  const detailLink = courseCard.getByRole('link', { name: '打开课程详情' });
  await expect(detailLink).toHaveCount(1);
  await Promise.all([
    page.waitForURL(/\/courses\/[0-9a-f-]{36}$/i),
    detailLink.click(),
  ]);
  await expect(page.getByRole('heading', { name: `V6 ${name} 课程` })).toBeVisible();
  const courseId = courseIdFromCurrentUrl(page);
  await page.getByLabel('匿名公开检索关键词').fill('公开的 V6 线性代数资料');
  await page.getByRole('button', { name: '准备匿名公开检索' }).click();
  await expect(page.getByText('DISCLOSURE_READY：将请求 自动测试 Fake Public Search；adapter=TEST_FAKE，evidence=AUTOMATED_FAKE。')).toBeVisible();
  await page.getByRole('button', { name: '确认披露并开始检索' }).click();
  await expect(page.getByText('CITATIONS_READY：已保存 1 条 metadata-only citation。')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByLabel('学习目标').fill('理解向量空间与线性变换');
  await page.getByLabel('目标日期').fill(targetDate);
  await page.getByLabel('最早开始').fill(name === 'iphone' ? '18:00' : '16:00');
  await page.getByLabel('最晚结束').fill(name === 'iphone' ? '19:00' : '17:00');
  await page.getByRole('button', { name: '准备引用学习建议' }).click();
  await expect(page.getByText('DISCLOSURE_READY：将请求 自动测试 Fake Learning Advice；adapter=TEST_FAKE，evidence=AUTOMATED_FAKE。')).toBeVisible();
  await expect(page.getByText('自动测试 Fake 证据，不代表真实 Provider')).toBeVisible();
  const generatedResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && /^\/api\/core\/learning-runs\/[0-9a-f-]{36}\/generate$/i.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: '确认披露并生成学习建议' }).click();
  const generated = await generatedResponse;
  expect(generated.status()).toBe(202);
  const generatedBody = learningRunGenerateResponseSchema.parse(await generated.json()).data;
  const learningChanges = generatedBody.proposal.changes.filter((change) => change.operation === 'CREATE_LEARNING_ACTION');
  expect(learningChanges).toHaveLength(1);
  const [learningChange] = learningChanges;
  if (!learningChange) throw new Error('Learning Proposal did not include its single action change.');
  expect(learningChange.action.courseId).toBe(courseId);
  expect(learningChange.action.title).toBe(fakeLearningTitle);
  await expect(page.getByText('PROPOSAL_PENDING：学习行动仍待你在 Today 确认；尚未创建 Action 或排程请求。')).toBeVisible();
  await acceptPendingProposal(page);
  await expect(
    page.getByRole('listitem').filter({ hasText: `V6 ${name} 课程 · 1 条 citation` }).getByText(fakeLearningTitle),
  ).toBeVisible();
  return {
    courseId,
    actionId: learningChange.action.id,
    timeRequestId: learningChange.scheduling.timeRequestId,
  };
}

async function applyDailyPlan(page: Page, targetDate: string, timeRequestId: string): Promise<string> {
  await page.goto(`/daily-plan?date=${encodeURIComponent(targetDate)}`);
  await expect(page.getByRole('heading', { name: '每日计划审核' })).toBeVisible();
  await page.getByLabel('计划日期').fill(targetDate);
  await page.getByRole('button', { name: '准备外发内容' }).click();
  await page.getByRole('button', { name: '批准外发内容' }).click();
  await expect(page.getByText('你的选择已保存，尚未调用 Provider。')).toBeVisible();
  await page.getByRole('button', { name: '调用 Provider 生成草案' }).click();
  const currentProposalCard = page.locator('article.daily-plan-review-card').filter({
    has: page.getByRole('button', { name: '采用安排', exact: true }),
  });
  await expect(currentProposalCard).toHaveCount(1);
  await expect(currentProposalCard.getByText('由测试 Fake Provider 生成的待审核安排。', { exact: true })).toBeVisible();
  const applyButton = currentProposalCard.getByRole('button', { name: '采用安排', exact: true });
  await expect(applyButton).toHaveCount(1);
  const appliedResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && /^\/api\/core\/daily-plans\/proposals\/[0-9a-f-]{36}\/decisions$/i.test(new URL(response.url()).pathname),
  );
  await applyButton.click();
  const applied = await appliedResponse;
  expect(applied.status()).toBe(200);
  const review = dailyPlanDecisionBatchResponseSchema.parse(await applied.json()).data;
  const matchingItems = review.proposal.items.filter((item) => item.timeRequestId === timeRequestId);
  expect(matchingItems).toHaveLength(1);
  const [item] = matchingItems;
  if (!item) throw new Error('Daily Plan response omitted the current Learning TimeRequest.');
  const matchingDecisions = review.decisions.filter((decision) => decision.itemId === item.id);
  expect(matchingDecisions).toHaveLength(1);
  const [decision] = matchingDecisions;
  if (!decision || decision.decision !== 'APPLY' || !decision.scheduledEventId) {
    throw new Error('Daily Plan did not create the current Learning Event.');
  }
  return decision.scheduledEventId;
}

async function readTodaySnapshot(page: Page, targetDate: string) {
  const response = await page.context().request.get(`/api/core/today?date=${encodeURIComponent(targetDate)}`);
  expect(response.status()).toBe(200);
  return todaySnapshotSchema.parse(await response.json()).data;
}

function assertDistinctLineage(lineages: readonly LearningLineage[]): void {
  for (const property of ['courseId', 'actionId', 'timeRequestId', 'eventId'] as const) {
    expect(new Set(lineages.map((lineage) => lineage[property])).size).toBe(lineages.length);
  }
}

async function assertResponsiveToday(
  page: Page,
  name: string,
  targetDate: string,
  lineage: LearningLineage,
  completedLineages: readonly LearningLineage[],
): Promise<void> {
  await page.goto('/today');
  const snapshot = await readTodaySnapshot(page, targetDate);
  const courseActions = snapshot.learningActions.filter((summary) => summary.courseId === lineage.courseId);
  expect(courseActions).toHaveLength(1);
  const [courseAction] = courseActions;
  if (!courseAction) throw new Error('Today omitted the current Course Action summary.');
  expect(courseAction).toMatchObject({
    action: { id: lineage.actionId, title: fakeLearningTitle },
    citationCount: 1,
  });
  const courseEvents = snapshot.events.filter((event) => event.courseId === lineage.courseId && event.kind === 'STUDY');
  expect(courseEvents).toHaveLength(1);
  const [courseEvent] = courseEvents;
  if (!courseEvent) throw new Error('Today omitted the current Course STUDY Event.');
  expect(courseEvent).toMatchObject({ id: lineage.eventId, title: fakeLearningTitle, status: 'CONFIRMED' });
  assertDistinctLineage(completedLineages);
  const actionIds = snapshot.learningActions
    .filter((summary) => summary.action.title === fakeLearningTitle)
    .map((summary) => summary.action.id)
    .sort();
  const eventIds = snapshot.events
    .filter((event) => event.kind === 'STUDY' && event.title === fakeLearningTitle)
    .map((event) => event.id)
    .sort();
  expect(actionIds).toEqual(completedLineages.map((item) => item.actionId).sort());
  expect(eventIds).toEqual(completedLineages.map((item) => item.eventId).sort());
  const eventLink = page.locator(`a[href="/schedule/events/${lineage.eventId}"]`);
  await expect(eventLink).toHaveCount(1);
  await expect(eventLink).toBeVisible();
  const eventItem = eventLink.locator('xpath=ancestor::li[1]');
  const courseLink = eventItem.locator(`a[href="/courses/${lineage.courseId}"]`);
  await expect(courseLink).toHaveCount(1);
  await expect(courseLink).toBeVisible();
  await courseLink.click();
  await expect(page.getByRole('heading', { name: `V6 ${name} 课程` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

test('v0.6 browser loop uploads a raw timetable, accepts reviewed scheduling, then cites, schedules and links a study Event in desktop and iPhone contexts', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
  const completedLineages: LearningLineage[] = [];
  for (const device of [
    { name: 'desktop' as const, touch: false },
    { name: 'iphone' as const, touch: true },
  ]) {
    const context = device.touch
      ? await browser.newContext({ ...devices['iPhone 13'], ...(storageState ? { storageState } : {}) })
      : await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false, ...(storageState ? { storageState } : {}) });
    const page = await context.newPage();
    const problems = collectBrowserProblems(page);
    try {
      await authenticate(page);
      storageState ??= await context.storageState();
      const targetDate = await todayDate(page);
      await importReviewedCourse(page, device.name);
      await acceptPendingProposal(page);
      const learningLineage = await createAndAcceptLearningProposal(page, device.name, targetDate);
      const eventId = await applyDailyPlan(page, targetDate, learningLineage.timeRequestId);
      const completed = { ...learningLineage, eventId };
      completedLineages.push(completed);
      expect(completedLineages).toHaveLength(device.touch ? 2 : 1);
      await assertResponsiveToday(page, device.name, targetDate, completed, completedLineages);
    } finally {
      await expectNoBrowserProblems(testInfo, device.name, problems);
      await context.close();
    }
  }
});
