import Database from 'better-sqlite3';
import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dailyPlanDecisionBatchResponseSchema,
  dailyPlanProposalResponseSchema,
  taskResponseSchema,
} from '@ev/contracts';
import { expect, test, type Page, type Response as PlaywrightResponse, type TestInfo } from '@playwright/test';

const webOrigin = 'http://127.0.0.1:3217';
const owner = {
  username: 'v9-05-synthetic-owner',
  password: 'v9-05-synthetic-password',
};
const taskTitle = 'Confirm the V9-05 ordinary work action';

function readFactCounts(): { events: number; providerCalls: number } {
  const configured = process.env.EV_E2E_RUN_DIR;
  if (process.env.EV_E2E_MANAGED !== '1' || !configured) {
    throw new Error('V9-05 fact inspection requires a runner-owned managed E2E directory.');
  }
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const runsRoot = realpathSync(join(workspaceRoot, 'data', 'e2e-runs'));
  const runDirectory = realpathSync(configured);
  if (dirname(runDirectory) !== runsRoot || !basename(runDirectory).startsWith('managed-run-')) {
    throw new Error('V9-05 refused fact inspection outside a managed E2E run.');
  }
  const databasePath = realpathSync(join(runDirectory, 'app.sqlite'));
  if (dirname(databasePath) !== runDirectory) {
    throw new Error('V9-05 refused a database outside its managed E2E directory.');
  }
  const database = new Database(databasePath, { fileMustExist: true, readonly: true });
  try {
    const ownerId = database.prepare('select id from owners where username = ?').pluck().get(owner.username);
    if (typeof ownerId !== 'string') throw new Error('V9-05 synthetic Owner is missing.');
    return {
      events: database.prepare('select count(*) from events where owner_id = ?').pluck().get(ownerId) as number,
      providerCalls: database.prepare('select count(*) from provider_call_logs where owner_id = ?').pluck().get(ownerId) as number,
    };
  } finally {
    database.close();
  }
}

type BrowserDiagnostics = {
  apiFailures: string[];
  apiRequests: string[];
  consoleProblems: string[];
  cspConsoleProblems: string[];
  externalRequests: string[];
  failedRequests: string[];
  cancelledMetadataRequests: string[];
  pageErrors: string[];
};

function localDateFromToday(page: Page): Promise<string> {
  return page.locator('.today-header .section-kicker').textContent().then((label) => {
    const match = label?.match(/(\d{4}-\d{2}-\d{2})/);
    if (!match?.[1]) throw new Error(`Today did not expose its local date: ${label ?? 'missing'}`);
    return match[1];
  });
}

function assertTrustedMutation(response: PlaywrightResponse, expectedStatus: number): void {
  const request = response.request();
  const headers = request.headers();
  expect(response.status()).toBe(expectedStatus);
  expect(request.method()).toBe('POST');
  expect(new URL(response.url()).origin).toBe(webOrigin);
  expect(headers.origin).toBe(webOrigin);
  expect(headers['x-ev-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/);
}

function assertHtmlCsp(response: PlaywrightResponse): string {
  const policy = response.headers()['content-security-policy'];
  if (!policy) throw new Error('The HTML response did not include Content-Security-Policy.');
  const scriptDirective = policy.split(';').map((directive) => directive.trim()).find((directive) => directive.startsWith('script-src'));
  const nonce = scriptDirective?.match(/'nonce-([^']+)'/)?.[1];
  if (!nonce) throw new Error(`The HTML CSP did not include a script nonce: ${policy}`);

  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
  expect(policy).toContain("form-action 'self'");
  expect(scriptDirective).not.toContain("'unsafe-inline'");
  return nonce;
}

async function assertDocumentNonce(page: Page, expectedNonce: string): Promise<void> {
  const scriptNonces = await page.locator('script').evaluateAll((nodes) => nodes
    .map((node) => (node as HTMLScriptElement).nonce)
    .filter((nonce) => nonce.length > 0));
  expect(scriptNonces).toContain(expectedNonce);
}

function collectBrowserDiagnostics(page: Page): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = {
    apiFailures: [],
    apiRequests: [],
    consoleProblems: [],
    cspConsoleProblems: [],
    externalRequests: [],
    failedRequests: [],
    cancelledMetadataRequests: [],
    pageErrors: [],
  };

  page.on('console', (message) => {
    if (message.type() !== 'warning' && message.type() !== 'error') return;
    const entry = `[console:${message.type()}] ${message.text()}`;
    diagnostics.consoleProblems.push(entry);
    if (/content security policy|csp|refused to (load|apply|execute)/i.test(message.text())) {
      diagnostics.cspConsoleProblems.push(entry);
    }
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(`[pageerror] ${error.message}`));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== webOrigin || !url.pathname.startsWith('/api/')) return;
    const request = response.request();
    diagnostics.apiRequests.push(`${request.method()} ${url.pathname}`);
    if (response.status() >= 400) diagnostics.apiFailures.push(`${response.status()} ${request.method()} ${url.pathname}`);
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.origin !== webOrigin || url.pathname.startsWith('/api/')) {
      diagnostics.failedRequests.push(`${request.failure()?.errorText ?? 'unknown failure'} ${request.method()} ${url.origin}${url.pathname}`);
    }
  });
  page.on('websocket', (socket) => {
    const url = new URL(socket.url());
    if (url.hostname !== '127.0.0.1' || url.port !== '3217' || !['ws:', 'wss:'].includes(url.protocol)) {
      diagnostics.externalRequests.push(`WebSocket ${url.origin}${url.pathname}`);
    }
  });
  return diagnostics;
}

async function restrictBrowserToLoopbackWeb(page: Page, diagnostics: BrowserDiagnostics): Promise<void> {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isLoopbackWeb = url.hostname === '127.0.0.1'
      && url.port === '3217'
      && ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
    if (!isLoopbackWeb) {
      diagnostics.externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function installMetadataCancellationEvidence(page: Page): Promise<void> {
  // Observe the real fetch signal without changing requests, responses, or rejection behavior.
  await page.exposeFunction('recordV9MetadataCancellation', () => {
    metadataCancellationEvidence.push('GET /api/core/providers/deepseek/credential');
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      try {
        return await originalFetch(input, init);
      } catch (error) {
        if (requestUrl.origin === location.origin
          && requestUrl.pathname === '/api/core/providers/deepseek/credential'
          && method === 'GET' && signal?.aborted
          && error instanceof DOMException && error.name === 'AbortError') {
          await (window as unknown as { recordV9MetadataCancellation(): Promise<void> }).recordV9MetadataCancellation();
        }
        throw error;
      }
    };
  });
}

const metadataCancellationEvidence: string[] = [];

function auditMetadataCancellations(diagnostics: BrowserDiagnostics): void {
  const expectedFailure = `net::ERR_ABORTED GET ${webOrigin}/api/core/providers/deepseek/credential`;
  for (let index = diagnostics.failedRequests.length - 1; index >= 0; index -= 1) {
    if (diagnostics.failedRequests[index] === expectedFailure && metadataCancellationEvidence.length > 0) {
      metadataCancellationEvidence.pop();
      diagnostics.cancelledMetadataRequests.push(diagnostics.failedRequests.splice(index, 1)[0]!);
    }
  }
  // At most one dev-effect cancellation for each of the five authenticated page mounts.
  expect.soft(diagnostics.cancelledMetadataRequests.length).toBeLessThanOrEqual(5);
  expect.soft(metadataCancellationEvidence, 'Unmatched AbortSignal evidence').toEqual([]);
}

async function withCredentialMetadata<T>(page: Page, navigate: () => Promise<T>): Promise<T> {
  const metadataResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET'
      && new URL(response.url()).origin === webOrigin
      && new URL(response.url()).pathname === '/api/core/providers/deepseek/credential',
  { timeout: 8_000 });
  const [result, response] = await Promise.all([navigate(), metadataResponse]);
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  await expect(page.getByRole('heading', { name: 'DeepSeek：未配置', exact: true })).toBeVisible();
  return result;
}

async function authenticateViaSetupOrLogin(page: Page): Promise<void> {
  await page.goto('/');
  const setup = page.getByRole('heading', { name: '建立本地身份' });
  const login = page.getByRole('heading', { name: '返回你的控制台' });
  await expect(setup.or(login)).toBeVisible();
  await page.getByLabel('用户名').fill(owner.username);
  await page.getByLabel('密码').fill(owner.password);

  const isSetup = await setup.isVisible();
  const csrfResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/csrf',
  );
  const authResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === (isSetup ? '/api/core/auth/setup' : '/api/core/auth/login'),
  );
  await withCredentialMetadata(page, () => page.getByRole('button', { name: isSetup ? '创建本地账号' : '登录' }).click());
  const [csrf, authentication] = await Promise.all([csrfResponse, authResponse]);
  expect(csrf.status()).toBe(200);
  expect(csrf.headers()['cache-control']).toBe('no-store');
  assertTrustedMutation(authentication, isSetup ? 201 : 200);
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name: '今天的控制台' })).toBeVisible();
}

async function attachDiagnostics(testInfo: TestInfo, diagnostics: BrowserDiagnostics): Promise<void> {
  await testInfo.attach('v0.9-private-iphone-browser-diagnostics', {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
    contentType: 'application/json',
  });
}

test('V9-05 uses one ordinary work LOCAL_RULES review path without Provider calls and only writes facts after confirmation', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const diagnostics = collectBrowserDiagnostics(page);
  await installMetadataCancellationEvidence(page);
  await restrictBrowserToLoopbackWeb(page, diagnostics);

  try {
    await authenticateViaSetupOrLogin(page);

    const initialToday = await withCredentialMetadata(page, () => page.goto('/today'));
    if (!initialToday) throw new Error('Today navigation did not return an HTML response.');
    const initialNonce = assertHtmlCsp(initialToday);
    await assertDocumentNonce(page, initialNonce);
    await expect(page.getByRole('heading', { name: '今天的控制台' })).toBeVisible();
    const targetDate = await localDateFromToday(page);
    expect(readFactCounts()).toEqual({ events: 0, providerCalls: 0 });

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
    const taskResponse = await taskCreated;
    assertTrustedMutation(taskResponse, 201);
    expect(taskResponseSchema.parse(await taskResponse.json()).data).toMatchObject({
      title: taskTitle,
      area: 'WORK',
      scheduling: { durationMinutes: 60, earliestStartLocalTime: '09:00', latestEndLocalTime: '10:00' },
    });
    await expect(page.getByRole('link', { name: `查看任务详情：${taskTitle}`, exact: true })).toBeVisible();
    expect(readFactCounts()).toEqual({ events: 0, providerCalls: 0 });

    await withCredentialMetadata(page, () => page.goto(`/daily-plan?date=${encodeURIComponent(targetDate)}`));
    await expect(page.getByRole('heading', { name: '每日计划审核' })).toBeVisible();
    const localRulesResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/core/daily-plans/coordinate',
    );
    await page.getByRole('button', { name: '按本地静态规则协调' }).click();
    const localRules = await localRulesResponse;
    assertTrustedMutation(localRules, 201);
    const localRulesProposal = dailyPlanProposalResponseSchema.parse(await localRules.json()).data;
    expect(localRulesProposal).toMatchObject({ localDate: targetDate, mode: 'LOCAL_RULES', status: 'PENDING_REVIEW' });
    expect(localRulesProposal.items).toHaveLength(1);
    const scheduledItem = localRulesProposal.items.find((item) => item.operation === 'SCHEDULE_TIME_REQUEST');
    if (!scheduledItem) throw new Error('LOCAL_RULES review did not schedule the ordinary work TimeRequest.');
    expect(scheduledItem.status).toBe('PENDING_REVIEW');
    await expect(page.getByText('协调来源：LOCAL_RULES 静态规则（无模型）。', { exact: true })).toBeVisible();
    await expect(page.getByText('本地静态协调草案已生成；每项仍需单独审核后才会写入日程。')).toBeVisible();
    expect(readFactCounts()).toEqual({ events: 0, providerCalls: 0 });

    const reviewCard = page.locator('article.daily-plan-review-card').filter({ hasText: 'LOCAL_RULES' });
    const applyButton = reviewCard.getByRole('button', { name: '采用安排', exact: true });
    await expect(applyButton).toHaveCount(1);
    const applyResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /^\/api\/core\/daily-plans\/proposals\/[0-9a-f-]{36}\/decisions$/i.test(new URL(response.url()).pathname),
    );
    await applyButton.click();
    const applied = await applyResponse;
    assertTrustedMutation(applied, 200);
    const appliedReview = dailyPlanDecisionBatchResponseSchema.parse(await applied.json()).data;
    const appliedItem = appliedReview.proposal.items.find((item) => item.id === scheduledItem.id);
    if (!appliedItem) throw new Error('LOCAL_RULES review omitted the ordinary work TimeRequest.');
    const appliedDecision = appliedReview.decisions.find((decision) => decision.itemId === appliedItem.id);
    expect(appliedDecision).toMatchObject({ decision: 'APPLY', itemId: appliedItem.id });
    expect(appliedDecision?.scheduledEventId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(readFactCounts()).toEqual({ events: 1, providerCalls: 0 });

    await withCredentialMetadata(page, () => page.goto('/today'));
    const refreshedToday = await withCredentialMetadata(page, () => page.reload());
    if (!refreshedToday) throw new Error('Today refresh did not return an HTML response.');
    const refreshedNonce = assertHtmlCsp(refreshedToday);
    await assertDocumentNonce(page, refreshedNonce);
    await expect(page.getByRole('heading', { name: '今天的控制台' })).toBeVisible();
    await expect(page.getByText('来源：LOCAL_RULES 静态协调（无模型）', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: `查看日程详情：${taskTitle}` })).toBeVisible();
    expect(readFactCounts()).toEqual({ events: 1, providerCalls: 0 });

    expect(diagnostics.apiRequests.filter((entry) => /\/api\/core\/daily-plans\/(generate|preflights)/.test(entry))).toEqual([]);
  } finally {
    auditMetadataCancellations(diagnostics);
    expect.soft(diagnostics.apiFailures, 'API failures').toEqual([]);
    expect.soft(diagnostics.consoleProblems, 'Browser console problems').toEqual([]);
    expect.soft(diagnostics.cspConsoleProblems, 'CSP problems').toEqual([]);
    expect.soft(diagnostics.externalRequests, 'External requests').toEqual([]);
    expect.soft(diagnostics.failedRequests, 'Failed network requests').toEqual([]);
    expect.soft(diagnostics.pageErrors, 'Browser page errors').toEqual([]);
    try {
      await attachDiagnostics(testInfo, diagnostics);
    } catch (error) {
      expect.soft(error, 'Browser diagnostics attachment failed').toBeUndefined();
    }
  }
});
