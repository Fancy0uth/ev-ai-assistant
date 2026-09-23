import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { expect, test, type Page, type Response } from '@playwright/test';
import {
  workoutContextPreviewV2Schema, workoutRevisionV2Schema, workoutSchema,
  dailyPlanProposalResponseSchema, dailyPlanDecisionBatchResponseSchema,
  type WorkoutContextPreviewV2,
} from '@ev/contracts';

// Exactly one context/device/case. No API mutation shortcuts or seeded business facts.
test.use({ timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'off' });
const origin = 'http://127.0.0.1:3217';
const username = 'fit04c-synthetic-owner';
const envelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema });
const createdSchema = envelope(z.object({ workout: workoutSchema, revision: workoutRevisionV2Schema, totalDurationSeconds: z.number(), capabilityRunId: z.uuid() }));
const fakeSchema = z.object({ calls: z.array(z.object({ call: z.number(), candidateHash: z.string(), feedbackCount: z.number(), feedbackIds: z.array(z.uuid()), memoryCount: z.number() })) });

const observedReadPaths = new Set([
  '/api/core/providers/deepseek/credential', '/api/core/fitness/planning/profile',
  '/api/core/fitness/planning/capability', '/api/core/fitness/planning/memory',
]);
interface CancellationFact {
  id: string; path: string; startedAt: number; abortedAt: number; rejectedAt: number;
  signalAborted: boolean; errorName: string;
}
interface FailedRequestFact { id: string | null; method: string; path: string; error: string | null; sameOrigin: boolean }

async function observeReadCancellation(page: Page, facts: CancellationFact[]) {
  await page.exposeFunction('recordFitnessReadCancellation', (fact: CancellationFact) => { facts.push(fact); });
  await page.addInitScript(({ paths }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (url.origin !== location.origin || method !== 'GET' || !signal || !paths.includes(url.pathname)) {
        return originalFetch(input, init);
      }
      const id = crypto.randomUUID();
      const startedAt = Date.now();
      let abortedAt = signal.aborted ? startedAt : 0;
      const onAbort = () => { abortedAt = Date.now(); };
      signal.addEventListener('abort', onAbort, { once: true });
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      // An isolated test-only identity pairs the browser failure with THIS
      // fetch's actual signal; never exempt a request by path or count alone.
      headers.set('x-ev-e2e-read-id', id);
      try { return await originalFetch(input, { ...init, headers }); }
      catch (error) {
        await (window as unknown as { recordFitnessReadCancellation(fact: CancellationFact): Promise<void> })
          .recordFitnessReadCancellation({ id, path: url.pathname, startedAt, abortedAt,
            rejectedAt: Date.now(), signalAborted: signal.aborted,
            errorName: error instanceof DOMException ? error.name : 'OTHER' });
        throw error;
      } finally { signal.removeEventListener('abort', onAbort); }
    };
  }, { paths: [...observedReadPaths] });
}

function unexplainedFailures(failures: FailedRequestFact[], cancellations: CancellationFact[]): number {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const matches = cancellations.filter((item) => item.id === failure.id);
    const match = matches[0];
    if (!failure.id || seen.has(failure.id) || matches.length !== 1 || !match
      || !failure.sameOrigin || failure.method !== 'GET' || failure.error !== 'net::ERR_ABORTED'
      || !observedReadPaths.has(failure.path) || match.path !== failure.path
      || !match.signalAborted || match.errorName !== 'AbortError'
      || match.startedAt <= 0 || match.abortedAt < match.startedAt || match.rejectedAt < match.abortedAt) return true;
    seen.add(failure.id);
    return false;
  }).length;
}

function runDirectory(): string {
  const configured = process.env.EV_E2E_RUN_DIR;
  if (process.env.EV_E2E_MANAGED !== '1' || process.env.EV_E2E_FITNESS_PLANNING_TEST_BOOTSTRAP !== '1' || !configured) throw new Error('FIT04C_MANAGED_RUN_REQUIRED');
  const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));
  const data = realpathSync(join(root, 'data'));
  const runs = realpathSync(join(data, 'e2e-runs'));
  const run = realpathSync(configured);
  if (dirname(data) !== root || dirname(runs) !== data || dirname(run) !== runs || !basename(run).startsWith('managed-run-')) throw new Error('FIT04C_UNSAFE_RUN');
  return run;
}

function withDatabase<T>(read: (db: Database.Database, ownerId: string) => T): T {
  const run = runDirectory();
  const path = realpathSync(join(run, 'app.sqlite'));
  if (dirname(path) !== run) throw new Error('FIT04C_UNSAFE_DATABASE');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    expect(db.prepare('select count(*) from owners').pluck().get()).toBe(1);
    const ownerId = db.prepare('select id from owners where username = ?').pluck().get(username);
    if (typeof ownerId !== 'string') throw new Error('FIT04C_SYNTHETIC_OWNER_REQUIRED');
    return read(db, ownerId);
  } finally { db.close(); }
}

function facts() {
  return withDatabase((db, ownerId) => {
    expect(db.prepare('select count(*) from provider_credentials').pluck().get()).toBe(0);
    expect(db.prepare('select count(*) from provider_call_logs where owner_id = ?').pluck().get(ownerId)).toBe(0);
    return {
      actions: db.prepare('select count(*) from actions where owner_id = ?').pluck().get(ownerId),
      timeRequests: db.prepare('select count(*) from time_requests where owner_id = ?').pluck().get(ownerId),
      events: db.prepare('select count(*) from events where owner_id = ?').pluck().get(ownerId),
    };
  });
}

async function mutation(page: Page, path: string, action: () => Promise<unknown>, status: number, method = 'POST'): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).origin === origin && new URL(r.url()).pathname === `/api/core/${path}` && r.request().method() === method),
    action(),
  ]);
  expect(response.status()).toBe(status);
  expect(response.request().headers().origin).toBe(origin);
  expect(response.request().headers()['x-ev-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await response.finished();
  return response;
}

async function enterDetailed(page: Page) {
  await page.goto('/fitness');
  await page.getByRole('button', { name: 'DeepSeek 详细训练计划', exact: true }).click();
  await expect(page.getByText('Fake 测试能力，仅合成验证。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存画像', exact: true })).toBeEnabled();
}

async function preview(page: Page): Promise<WorkoutContextPreviewV2> {
  const response = await mutation(page, 'fitness/planning/context/preview', () => page.getByRole('button', { name: '预览实际外发内容', exact: true }).click(), 200);
  const value = envelope(workoutContextPreviewV2Schema).parse(await response.json()).data;
  await expect(page.getByRole('region', { name: '实际外发预览' })).toContainText(value.contextHash);
  await expect(page.getByRole('button', { name: '同意后生成详细草稿' })).toBeDisabled();
  return value;
}

function previewCounts(value: WorkoutContextPreviewV2) {
  return { feedbackCount: value.fieldCounts.feedback, feedbackIds: value.payload.recentFeedback.map((f) => f.feedbackId), memoryCount: value.fieldCounts.fitnessMemory };
}

async function generate(page: Page) {
  await page.getByLabel('我已审阅上述实际内容并同意发送', { exact: true }).check();
  const response = await mutation(page, 'fitness/planning/workouts', () => page.getByRole('button', { name: '同意后生成详细草稿' }).click(), 201);
  const result = createdSchema.parse(await response.json()).data;
  await expect(page.getByRole('region', { name: '详细训练草稿审阅' })).toContainText('DRAFT');
  expect(result.workout.state).toBe('DRAFT');
  expect(result.revision.items.map((i) => i.phase)).toEqual(['WARMUP', 'MAIN', 'COOLDOWN']);
  for (const name of ['热身', '主训练', '放松']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return result;
}

test('FIT04c single synthetic fitness loop: two authorized FAKE generations and one separately confirmed LOCAL_RULES Event', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const run = runDirectory();
  const diagnostics = { apiFailures: 0, consoleProblems: 0, externalRequests: 0, failedRequests: 0, pageErrors: 0, schedulingMode: 'LOCAL_RULES' };
  const failedRequestFacts: FailedRequestFact[] = [];
  const cancellationFacts: CancellationFact[] = [];
  await observeReadCancellation(page, cancellationFacts);
  // Pin the blocker in this same sole case: a path match without a signal
  // proof, or a mutation, must still fail the diagnostic gate.
  const probeFailure: FailedRequestFact = { id: 'probe', method: 'GET', path: '/api/core/fitness/planning/profile', error: 'net::ERR_ABORTED', sameOrigin: true };
  const probeFact: CancellationFact = { id: 'probe', path: probeFailure.path, startedAt: 1, abortedAt: 2, rejectedAt: 3, signalAborted: true, errorName: 'AbortError' };
  expect(unexplainedFailures([probeFailure], [])).toBe(1);
  expect(unexplainedFailures([{ ...probeFailure, method: 'POST' }], [probeFact])).toBe(1);
  expect(unexplainedFailures([probeFailure], [probeFact])).toBe(0);
  page.on('console', (m) => { if (['warning', 'error'].includes(m.type())) diagnostics.consoleProblems++; });
  page.on('pageerror', () => { diagnostics.pageErrors++; });
  page.on('requestfailed', (request) => {
    diagnostics.failedRequests++;
    const url = new URL(request.url());
    failedRequestFacts.push({ id: request.headers()['x-ev-e2e-read-id'] ?? null, method: request.method(), path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':synthetic-id'), error: request.failure()?.errorText ?? null, sameOrigin: url.origin === origin });
  });
  page.on('response', (r) => { if (r.status() >= 400) diagnostics.apiFailures++; });
  await page.context().route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== origin) { diagnostics.externalRequests++; await route.abort(); }
    else await route.continue();
  });
  await page.context().routeWebSocket('**/*', (socket) => {
    const url = new URL(socket.url());
    if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== '3217') { diagnostics.externalRequests++; socket.close(); }
    else socket.connectToServer();
  });
  let completed = false;
  try {
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: '建立本地身份' })).toBeVisible();
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill('fit04c-synthetic-password');
    await mutation(page, 'auth/setup', () => page.getByRole('button', { name: '创建本地账号' }).click(), 201);
    await expect(page).toHaveURL(/\/today$/);
    await enterDetailed(page);
    const date = await page.getByLabel('本地训练日期', { exact: true }).inputValue();
    await page.getByRole('combobox', { name: '病史与训练限制', exact: true }).selectOption('NONE');
    await mutation(page, 'fitness/planning/profile', () => page.getByRole('button', { name: '保存画像', exact: true }).click(), 200, 'PUT');
    await expect(page.getByText('画像已保存 v1', { exact: true })).toBeVisible();
    await page.getByLabel('睡眠分钟', { exact: true }).fill('480');
    await page.getByLabel('主观精力（1–5）', { exact: true }).fill('5');
    await mutation(page, 'fitness/check-ins', () => page.getByRole('button', { name: '保存当天状态并读取候选' }).click(), 201);
    await expect(page.getByRole('button', { name: '预览实际外发内容' })).toBeEnabled();
    const first = await preview(page);
    expect(existsSync(join(run, 'fitness-planning-fake-evidence.json'))).toBe(false);
    expect(previewCounts(first)).toEqual({ feedbackCount: 0, feedbackIds: [], memoryCount: 0 });
    expect(first.payload.candidates.length).toBeGreaterThan(0);
    expect(first.payload.candidates.length).toBeLessThanOrEqual(5);
    const beforeTrainingConfirmation = facts();
    expect(beforeTrainingConfirmation).toEqual({ actions: 0, timeRequests: 0, events: 0 });
    const created = await generate(page);
    expect(facts()).toEqual(beforeTrainingConfirmation);
    const proposalResponse = await mutation(page, `fitness/planning/workouts/${created.workout.id}/proposal`, () => page.getByRole('button', { name: '提交详细训练提案' }).click(), 201);
    const proposal = envelope(z.object({ proposal: z.object({ id: z.uuid() }) })).parse(await proposalResponse.json()).data.proposal;
    expect(facts()).toEqual(beforeTrainingConfirmation);
    await mutation(page, `proposals/${proposal.id}/decision`, () => page.getByRole('button', { name: '接受详细训练提案' }).click(), 200);
    await expect(page.getByRole('region', { name: '详细训练草稿审阅' })).toContainText('ACCEPTED');
    const afterTrainingConfirmation = facts();
    expect(afterTrainingConfirmation).toEqual({ actions: 1, timeRequests: 1, events: 0 });
    await page.getByRole('link', { name: '前往每日计划审核日程' }).click();
    await expect(page.getByRole('heading', { name: '每日计划审核' })).toBeVisible();
    const coordinated = dailyPlanProposalResponseSchema.parse(await (await mutation(page, 'daily-plans/coordinate', () => page.getByRole('button', { name: '按本地静态规则协调' }).click(), 201)).json()).data;
    expect(coordinated.mode).toBe('LOCAL_RULES');
    expect(coordinated.localDate).toBe(date);
    expect(coordinated.items).toHaveLength(1);
    expect(coordinated.items[0]?.operation).toBe('SCHEDULE_TIME_REQUEST');
    expect(facts()).toEqual(afterTrainingConfirmation);
    const card = page.locator('article.daily-plan-review-card').filter({ hasText: 'LOCAL_RULES' });
    const scheduleResult = dailyPlanDecisionBatchResponseSchema.parse(await (await mutation(page, `daily-plans/proposals/${coordinated.id}/decisions`, () => card.getByRole('button', { name: '采用安排', exact: true }).click(), 200)).json()).data;
    expect(scheduleResult.decisions).toHaveLength(1);
    expect(scheduleResult.decisions[0]?.scheduledEventId).toMatch(/^[0-9a-f-]{36}$/i);
    const afterScheduleConfirmation = facts();
    expect(afterScheduleConfirmation).toEqual({ actions: 1, timeRequests: 1, events: 1 });

    await enterDetailed(page);
    await page.getByRole('button', { name: '读取详细训练草稿' }).click();
    await page.getByRole('button', { name: `打开详细草稿 ${created.workout.id}`, exact: true }).click();
    await page.getByLabel('实际开始时间', { exact: true }).fill(`${date}T10:00`);
    await page.getByLabel('实际结束时间', { exact: true }).fill(`${date}T10:07`);
    await page.getByLabel('自述用力（1–10，可不填）', { exact: true }).fill('4');
    await page.getByRole('combobox', { name: '训练期间是否疼痛', exact: true }).selectOption('NO');
    await page.getByLabel('反馈备注', { exact: true }).fill('FIT04c synthetic seven-minute feedback');
    const feedbackResponse = await mutation(page, `fitness/planning/workouts/${created.workout.id}/feedback`, () => page.getByRole('button', { name: '提交实际反馈' }).click(), 201);
    const feedback = envelope(z.object({ feedback: z.object({ id: z.uuid() }), memoryStatus: z.object({ state: z.literal('RECORDED') }) })).parse(await feedbackResponse.json()).data.feedback;
    await expect(page.getByText('训练反馈已保存：COMPLETED', { exact: true })).toBeVisible();
    await expect(page.getByText(/记忆结果：RECORDED/)).toBeVisible();
    withDatabase((db, ownerId) => {
      const row = db.prepare('select outcome, perceived_effort, had_pain, note, started_at, ended_at from workout_feedback_v2 where owner_id = ? and id = ?').get(ownerId, feedback.id);
      expect(row).toEqual({ outcome: 'COMPLETED', perceived_effort: 4, had_pain: 0, note: 'FIT04c synthetic seven-minute feedback', started_at: new Date(`${date}T10:00:00+08:00`).toISOString(), ended_at: new Date(`${date}T10:07:00+08:00`).toISOString() });
    });
    await page.getByRole('button', { name: '再次规划训练', exact: true }).click();
    await page.getByLabel('允许发送最近14天最多5条训练反馈', { exact: true }).check();
    await page.getByLabel('允许发送选中的健身记忆', { exact: true }).check();
    const memoryChoice = page.getByRole('checkbox', { name: /^记忆 FITNESS\// });
    await expect(memoryChoice).toHaveCount(1);
    await memoryChoice.check();
    await mutation(page, 'fitness/check-ins', () => page.getByRole('button', { name: '保存当天状态并读取候选' }).click(), 201);
    await expect(page.getByRole('button', { name: '预览实际外发内容' })).toBeEnabled();
    const second = await preview(page);
    expect(fakeSchema.parse(JSON.parse(readFileSync(join(run, 'fitness-planning-fake-evidence.json'), 'utf8'))).calls).toHaveLength(1);
    expect(previewCounts(second)).toEqual({ feedbackCount: 1, feedbackIds: [feedback.id], memoryCount: 1 });
    expect(second.payload.recentFeedback[0]?.actualDurationSeconds).toBe(420);
    expect(second.payload.recentFeedback[0]?.perceivedEffort).toBe(4);
    expect(second.payload.recentFeedback[0]?.hadPain).toBe(false);
    expect(second.payload.selectedFitnessMemory[0]?.content.includes(`feedback:${feedback.id}`)).toBe(true);
    expect(second.payload.authorization.allowedFields).toEqual(expect.arrayContaining(['RECENT_FEEDBACK', 'FITNESS_MEMORY']));
    expect(second.contextHash).not.toBe(first.contextHash);
    const secondPlan = await generate(page);
    expect(secondPlan.workout.id).not.toBe(created.workout.id);
    const afterSecondGeneration = facts();
    expect(afterSecondGeneration).toEqual(afterScheduleConfirmation);
    withDatabase((db, ownerId) => {
      expect(db.prepare('select state from workouts_v2 where owner_id = ? and id = ?').pluck().get(ownerId, secondPlan.workout.id)).toBe('DRAFT');
      expect(db.prepare('select count(*) from workouts_v2 where owner_id = ?').pluck().get(ownerId)).toBe(2);
      expect(db.prepare('select count(*) from workout_feedback_v2 where owner_id = ?').pluck().get(ownerId)).toBe(1);
    });
    const fake = fakeSchema.parse(JSON.parse(readFileSync(join(run, 'fitness-planning-fake-evidence.json'), 'utf8')));
    expect(fake.calls).toHaveLength(2);
    for (const [index, context] of [first, second].entries()) {
      expect(fake.calls[index]).toEqual({ call: index + 1, candidateHash: createHash('sha256').update(JSON.stringify(context.payload.candidates)).digest('hex'), ...previewCounts(context) });
    }
    await expect.poll(() => unexplainedFailures(failedRequestFacts, cancellationFacts), { timeout: 2000 }).toBe(0);
    diagnostics.failedRequests = unexplainedFailures(failedRequestFacts, cancellationFacts);
    expect(diagnostics).toEqual({ apiFailures: 0, consoleProblems: 0, externalRequests: 0, failedRequests: 0, pageErrors: 0, schedulingMode: 'LOCAL_RULES' });
    writeFileSync(join(run, 'fitness-planning-browser-evidence.json'), JSON.stringify({
      schemaVersion: 'FITNESS_PLANNING_BROWSER_EVIDENCE_V1', beforeTrainingConfirmation, afterTrainingConfirmation, afterScheduleConfirmation, afterSecondGeneration,
      firstPreview: previewCounts(first), secondPreview: { ...previewCounts(second), fakeGenerationObserved: true }, providerCallCount: fake.calls.length, diagnostics,
    }));
    completed = true;
  } finally {
    diagnostics.failedRequests = unexplainedFailures(failedRequestFacts, cancellationFacts);
    writeFileSync(join(run, 'fitness-planning-failed-request-facts.json'), JSON.stringify({
      rawFailureCount: failedRequestFacts.length, unexplainedFailureCount: diagnostics.failedRequests,
      failures: failedRequestFacts, cancellationFacts,
    }));
    // Counts only: never attach health payloads, browser text, cookies or passwords.
    await testInfo.attach('fit04c-diagnostic-counts', { body: Buffer.from(JSON.stringify({ completed, ...diagnostics })), contentType: 'application/json' });
    expect.soft(diagnostics.consoleProblems).toBe(0);
    expect.soft(diagnostics.externalRequests).toBe(0);
    expect.soft(diagnostics.failedRequests).toBe(0);
    expect.soft(diagnostics.apiFailures).toBe(0);
    expect.soft(diagnostics.pageErrors).toBe(0);
  }
});
