import { devices, expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import {
  fitnessCheckInResponseSchema,
  mealConfirmResponseSchema,
  mealDraftCreateResponseSchema,
  mealDraftDetailResponseSchema,
  mealDraftMatchResponseSchema,
  mealDraftRevisionResponseSchema,
  todaySnapshotSchema,
  workoutCreateResponseSchema,
  workoutDetailResponseSchema,
} from '@ev/contracts';

const owner = { username: 'task16-e2e-owner', password: 'task16-e2e-password' };
const todayInShanghai = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Shanghai',
}).format(new Date());
const tomorrowInShanghai = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Shanghai',
}).format(new Date(Date.now() + 24 * 60 * 60 * 1000));

type BrowserProblems = { values: string[] };
type HealthLineage = { checkInId: string; signalId: string; workoutId: string; actionId: string; timeRequestId: string; activitySessionId: string; mealDraftId: string; mealId: string };

function collectBrowserProblems(page: Page): BrowserProblems {
  const problems = { values: [] as string[] };
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') problems.values.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.values.push(`[pageerror] ${error.message}`));
  return problems;
}

async function expectNoBrowserProblems(testInfo: TestInfo, name: string, problems: BrowserProblems): Promise<void> {
  await testInfo.attach(`v07-health-browser-${name}`, { body: Buffer.from(problems.values.join('\n') || 'No browser warnings or errors captured.'), contentType: 'text/plain' });
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

function responsePath(response: Awaited<ReturnType<Page['waitForResponse']>>): string {
  return new URL(response.url()).pathname;
}

function recordWithId(value: unknown, name: string): { id: string } {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') throw new Error(`${name} was missing an id in its Owner-authenticated detail response.`);
  return { id: value.id };
}

function actionWithTitle(value: unknown): { id: string; title: string } {
  const action = recordWithId(value, 'Action');
  if (typeof value !== 'object' || value === null || !('title' in value) || typeof value.title !== 'string') throw new Error('Action detail was missing its title.');
  return { ...action, title: value.title };
}

async function applyDailyPlanThroughUi(page: Page, localDate: string, timeRequestId: string, actionTitle: string): Promise<void> {
  await page.goto(`/daily-plan?date=${encodeURIComponent(localDate)}`);
  await expect(page.getByRole('heading', { name: '每日计划审核' })).toBeVisible();
  await page.getByLabel('计划日期').fill(localDate);
  await page.getByRole('button', { name: '准备外发内容' }).click();
  await page.getByRole('button', { name: '批准外发内容' }).click();
  await page.getByRole('button', { name: '调用 Provider 生成草案' }).click();
  const proposalCard = page.locator('article.daily-plan-review-card').filter({ has: page.getByRole('button', { name: '采用安排', exact: true }) });
  await expect(proposalCard).toHaveCount(1);
  await proposalCard.getByRole('button', { name: '采用安排', exact: true }).click();
  const todayResponse = await page.context().request.get(`/api/core/today?date=${encodeURIComponent(localDate)}`);
  expect(todayResponse.status()).toBe(200);
  const today = todaySnapshotSchema.parse(await todayResponse.json()).data;
  expect(today.events.some((event) => event.kind === 'WORKOUT' && event.title === actionTitle)).toBe(true);
  if (localDate === todayInShanghai) {
    await page.goto('/today');
    await expect(page.getByText(actionTitle, { exact: true })).toBeVisible();
  }
  expect(timeRequestId).toMatch(/^[0-9a-f-]{36}$/i);
}

async function runHealthLoop(page: Page, name: string, localDate: string): Promise<HealthLineage> {
  await page.goto('/fitness');
  await expect(page.getByRole('heading', { name: '训练与恢复' })).toBeVisible();
  await page.getByLabel('本地日期').fill(localDate);
  await page.getByLabel('睡眠分钟').fill('480');
  await page.getByLabel('主观精力（1–5）').selectOption('5');
  const checkInResponse = page.waitForResponse((response) => response.request().method() === 'POST' && responsePath(response) === '/api/core/fitness/check-ins');
  await page.getByRole('button', { name: '保存并查看训练目录' }).click();
  const checkIn = fitnessCheckInResponseSchema.parse(await (await checkInResponse).json()).data;
  expect(checkIn.checkIn.safety.eligibility).toBe('ELIGIBLE');
  await expect(page.getByText('项目内部非医疗目录')).toBeVisible();
  await page.getByLabel('最早开始时间').fill('12:00');
  await page.getByLabel('最晚结束时间').fill('13:00');
  await expect(page.getByRole('button', { name: '使用测试 Workout selector' })).toBeEnabled();
  const workoutResponse = page.waitForResponse((response) => response.request().method() === 'POST' && responsePath(response) === '/api/core/fitness/workouts');
  await page.getByRole('button', { name: '使用测试 Workout selector' }).click();
  const createdWorkout = workoutCreateResponseSchema.parse(await (await workoutResponse).json()).data;
  await expect(page.getByText(/修订 v1 是不可变记录/)).toBeVisible();
  await page.getByLabel('训练标题').fill(`Fixture workout ${name} owner revision`);
  await page.getByRole('button', { name: '保存所有者修订' }).click();
  await expect(page.getByText(/修订 v2 是不可变记录/)).toBeVisible();
  await page.getByRole('button', { name: '提交提案' }).click();
  await expect(page.getByRole('button', { name: '接受训练提案' })).toBeVisible();
  await page.getByRole('button', { name: '接受训练提案' }).click();
  await expect(page.getByText(/已创建 Action/)).toBeVisible();

  const acceptedDetailResponse = await page.context().request.get(`/api/core/fitness/workouts/${createdWorkout.workout.id}`);
  expect(acceptedDetailResponse.status()).toBe(200);
  const accepted = workoutDetailResponseSchema.parse(await acceptedDetailResponse.json()).data;
  const action = actionWithTitle(accepted.action);
  const timeRequest = recordWithId(accepted.timeRequest, 'TimeRequest');
  expect(accepted.workout).toMatchObject({ id: createdWorkout.workout.id, state: 'ACCEPTED', checkInId: checkIn.checkIn.id, signalId: checkIn.signal.id, actionId: action.id, timeRequestId: timeRequest.id });

  await applyDailyPlanThroughUi(page, localDate, timeRequest.id, action.title);
  await page.goto('/fitness');
  await page.getByLabel('本地日期').fill(localDate);
  await page.getByRole('button', { name: '读取本地训练草稿' }).click();
  await page.getByRole('button', { name: `打开训练草稿 ${createdWorkout.workout.id}` }).click();
  await expect(page.getByRole('button', { name: '确认已完成' })).toBeVisible();
  await page.getByRole('button', { name: '确认已完成' }).click();
  await expect(page.getByText('训练反馈已确认：已完成。')).toBeVisible();

  const completedDetailResponse = await page.context().request.get(`/api/core/fitness/workouts/${createdWorkout.workout.id}`);
  expect(completedDetailResponse.status()).toBe(200);
  const completed = workoutDetailResponseSchema.parse(await completedDetailResponse.json()).data;
  const feedback = completed.feedback as Record<string, unknown> | null;
  if (!feedback || typeof feedback.activitySessionId !== 'string') throw new Error('Completed Workout detail did not expose its ActivitySession lineage.');
  expect(completed.workout).toMatchObject({ state: 'COMPLETED', actionId: action.id, timeRequestId: timeRequest.id });

  await page.goto('/nutrition');
  await page.getByLabel('本地日期').fill(localDate);
  await page.getByLabel('餐食文本').fill('Fixture Food Alpha 150 g');
  const draftResponse = page.waitForResponse((response) => response.request().method() === 'POST' && responsePath(response) === '/api/core/nutrition/meal-drafts');
  await page.getByRole('button', { name: '解析候选食物' }).click();
  const draft = mealDraftCreateResponseSchema.parse(await (await draftResponse).json()).data;
  await expect(page.getByText('Fixture Food Alpha · 150 GRAM')).toBeVisible();
  const matchResponse = page.waitForResponse((response) => response.request().method() === 'POST' && responsePath(response) === `/api/core/nutrition/meal-drafts/${draft.draft.id}/matches`);
  await page.getByRole('button', { name: '匹配营养来源' }).click();
  const matched = mealDraftMatchResponseSchema.parse(await (await matchResponse).json()).data;
  const matchingCandidate = matched.matches.find((match) => match.candidateId === draft.revision.candidates[0]?.candidateId);
  const snapshotId = matchingCandidate?.snapshots[0]?.id;
  if (!snapshotId) throw new Error('Synthetic match response did not expose the exact source snapshot id.');
  await expect(page.getByText('TEST_FIXTURE — 非真实营养数据')).toBeVisible();
  await page.getByLabel('为 Fixture Food Alpha 选择来源').selectOption(snapshotId);
  const revisionResponse = page.waitForResponse((response) => response.request().method() === 'POST' && responsePath(response) === `/api/core/nutrition/meal-drafts/${draft.draft.id}/revisions`);
  await page.getByRole('button', { name: '保存来源选择' }).click();
  const savedSelection = mealDraftRevisionResponseSchema.parse(await (await revisionResponse).json()).data;
  expect(savedSelection.revision.candidates).toMatchObject([{ candidateId: draft.revision.candidates[0]?.candidateId, selectedFoodSnapshotId: snapshotId }]);
  await expect(page.getByRole('button', { name: '确认这餐' })).toBeEnabled();
  const mealResponse = page.waitForResponse((response) => response.request().method() === 'POST' && responsePath(response) === `/api/core/nutrition/meal-drafts/${draft.draft.id}/confirm`);
  await page.getByRole('button', { name: '确认这餐' }).click();
  const confirmed = mealConfirmResponseSchema.parse(await (await mealResponse).json()).data;
  expect(confirmed.meal.totals).toEqual({ energyKcalDecimal: '150', proteinGramsDecimal: '15', carbohydrateGramsDecimal: '30', fatGramsDecimal: '7.5' });
  await expect(page.getByText('150 kcal · 蛋白质 15 g · 碳水 30 g · 脂肪 7.5 g')).toBeVisible();

  await page.reload();
  await page.getByLabel('本地日期').fill(localDate);
  await page.getByRole('button', { name: '读取本地餐食草稿' }).click();
  await page.getByRole('button', { name: `打开餐食草稿 ${draft.draft.id}` }).click();
  await expect(page.getByText('TEST_FIXTURE — 非真实营养数据')).toBeVisible();
  const savedDetailResponse = await page.context().request.get(`/api/core/nutrition/meal-drafts/${draft.draft.id}`);
  expect(savedDetailResponse.status()).toBe(200);
  const saved = mealDraftDetailResponseSchema.parse(await savedDetailResponse.json()).data;
  expect(saved.confirmedMeal).toMatchObject({ id: confirmed.meal.id, totals: { energyKcalDecimal: '150', proteinGramsDecimal: '15', carbohydrateGramsDecimal: '30', fatGramsDecimal: '7.5' } });

  const bodyText = await page.locator('body').textContent();
  expect(bodyText).not.toContain('USDA');
  expect(bodyText).not.toMatch(/外部权威|真实 Provider/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

  return { checkInId: checkIn.checkIn.id, signalId: checkIn.signal.id, workoutId: createdWorkout.workout.id, actionId: action.id, timeRequestId: timeRequest.id, activitySessionId: feedback.activitySessionId, mealDraftId: draft.draft.id, mealId: confirmed.meal.id };
}

test('v0.7 health review loops complete with synthetic evidence in desktop and iPhone contexts', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
  const lineages: HealthLineage[] = [];
  for (const device of [{ name: 'desktop' as const, touch: false, date: todayInShanghai }, { name: 'iphone' as const, touch: true, date: tomorrowInShanghai }]) {
    const context = device.touch
      ? await browser.newContext({ ...devices['iPhone 13'], ...(storageState ? { storageState } : {}) })
      : await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false, ...(storageState ? { storageState } : {}) });
    const page = await context.newPage();
    const problems = collectBrowserProblems(page);
    try {
      await authenticate(page);
      storageState ??= await context.storageState();
      lineages.push(await runHealthLoop(page, device.name, device.date));
      expect(new Set(lineages.map((lineage) => lineage.workoutId)).size).toBe(lineages.length);
      expect(new Set(lineages.map((lineage) => lineage.mealId)).size).toBe(lineages.length);
    } finally {
      await expectNoBrowserProblems(testInfo, device.name, problems);
      await context.close();
    }
  }
});
