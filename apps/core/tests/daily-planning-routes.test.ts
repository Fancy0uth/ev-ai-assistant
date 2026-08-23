import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  apiErrorSchema,
  dailyPlanPreflightResponseSchema,
  type DailyPlanModelOutput,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import {
  DailyPlanningProviderUnavailableError,
  type DailyPlanningProvider,
  type DailyPlanningProviderInput,
  type DailyPlanningProviderResult,
} from '../src/modules/daily-planning/provider';
import { SecretStoreUnavailableError, type SecretStorePort } from '../src/modules/providers/secret-store';
import { PROVIDER_POLICY, providerUsageLocalDate } from '../src/modules/providers/provider-policy';
import { createProviderReliabilityRepository } from '../src/modules/providers/reliability-repository';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: 'daily-plan-route-owner',
  password: 'correct horse battery staple',
};
const localDate = '2026-08-18';
const testApiKey = 'test-only-daily-plan-api-key';
const rawProviderText = 'raw provider response body that must not leak';
const ownerTimeRequestId = '00000000-0000-4000-8000-000000000702';
const otherOwnerTimeRequestId = '00000000-0000-4000-8000-000000000703';

class FakeSecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();
  unprotectCalls = 0;

  async protect(plaintext: string): Promise<string> {
    this.values.set('daily-plan-route-credential', plaintext);
    return 'daily-plan-route-credential';
  }

  async unprotect(protectedValue: string): Promise<string> {
    this.unprotectCalls += 1;
    const plaintext = this.values.get(protectedValue);
    if (plaintext === undefined) throw new SecretStoreUnavailableError();
    return plaintext;
  }
}

class FakeDailyPlanningProvider implements DailyPlanningProvider {
  readonly inputs: DailyPlanningProviderInput[] = [];
  response: unknown = validModelOutput();
  error: Error | undefined;
  beforeGenerate: (() => void) | undefined;
  waitForGenerate: Promise<void> | undefined;

  async generate(_apiKey: string, input: DailyPlanningProviderInput): Promise<DailyPlanningProviderResult> {
    this.inputs.push(input);
    this.beforeGenerate?.();
    if (this.waitForGenerate) await this.waitForGenerate;
    if (this.error) throw this.error;
    return {
      output: this.response,
      model: 'deepseek-v4-flash',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      outputChars: JSON.stringify(this.response).length,
    };
  }
}

function validModelOutput(): DailyPlanModelOutput {
  return {
    schemaVersion: 'DAILY_PLAN_MODEL_V1',
    summary: '为今天生成了待审阅安排。',
    actions: [
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_1',
        startLocalTime: '10:00',
        endLocalTime: '11:00',
        rationale: '该时段满足请求窗口且未与固定日程冲突。',
      },
    ],
  };
}

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('daily planning generation route', () => {
  let app: FastifyInstance | undefined;
  let controlDatabase: Database.Database | undefined;
  let databasePath: string;
  let directory: string;
  let provider: FakeDailyPlanningProvider;
  let secretStore: FakeSecretStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-daily-planning-routes-'));
    databasePath = join(directory, 'app.sqlite');
    provider = new FakeDailyPlanningProvider();
    secretStore = new FakeSecretStore();
  });

  afterEach(async () => {
    controlDatabase?.close();
    controlDatabase = undefined;
    if (app) await app.close();
    app = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  async function createAuthenticatedApp(
    overrides: Parameters<typeof buildApp>[0] = {},
  ): Promise<{ token: string; ownerId: string }> {
    app = await buildApp({
      databasePath,
      dailyPlanningProvider: provider,
      logger: false,
      secretStore,
      ...overrides,
    });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    expect(setup.statusCode).toBe(201);
    const ownerId = setup.json().data.owner.id as string;
    calendar().createEvent({
      id: '00000000-0000-4000-8000-000000000700',
      ownerId,
      calendarRuleId: null,
      title: 'owner baseline event',
      kind: 'MEETING',
      localDate,
      startLocalTime: '08:00',
      endLocalTime: '09:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: '2026-08-18T07:00:00.000Z',
      updatedAt: '2026-08-18T07:00:00.000Z',
    });
    return { token: readSessionToken(setup.headers['set-cookie']), ownerId };
  }

  async function saveCredential(token: string): Promise<void> {
    const response = await app!.inject({
      method: 'PUT',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
      payload: { apiKey: testApiKey },
    });
    expect(response.statusCode).toBe(200);
  }

  async function prepareAndApprove(token: string, targetDate = localDate): Promise<{
    preflightId: string;
    expectedPreflightVersion: number;
  }> {
    const prepared = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/preflights',
      cookies: { ev_session: token },
      payload: { localDate: targetDate },
    });
    expect(prepared.statusCode).toBe(201);
    const preflight = dailyPlanPreflightResponseSchema.parse(prepared.json()).data;
    const approved = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/preflights/${preflight.id}/approve`,
      cookies: { ev_session: token },
      payload: {
        expectedPreflightVersion: preflight.version,
        items: preflight.items.map((item) => ({
          contextRef: item.contextRef,
          safeTitle: item.safeTitle,
          domain: item.domain,
          deadlineLocalDate: item.deadlineLocalDate,
          included: item.included,
        })),
      },
    });
    expect(approved.statusCode).toBe(200);
    const approvedPreflight = dailyPlanPreflightResponseSchema.parse(approved.json()).data;
    return {
      preflightId: approvedPreflight.id,
      expectedPreflightVersion: approvedPreflight.version,
    };
  }

  function calendar() {
    if (!controlDatabase) controlDatabase = openDatabase(databasePath);
    return createCalendarRepository(controlDatabase);
  }

  function createTimeRequest(ownerId: string, id: string, title: string): void {
    calendar().createTimeRequest({
      id,
      ownerId,
      source: 'PROJECT_AGENT',
      title,
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '10:00',
      latestEndLocalTime: '17:00',
      isFixed: false,
      version: 1,
      createdAt: '2026-08-18T07:00:00.000Z',
      updatedAt: '2026-08-18T07:00:00.000Z',
    });
  }

  function expectSafeResponse(body: string): void {
    for (const prohibited of [
      testApiKey,
      rawProviderText,
      otherOwnerTimeRequestId,
      'other owner private request',
    ]) {
      expect(body).not.toContain(prohibited);
    }
  }

  function expectGenerationTerminalBundleRolledBack(idempotencyKey: string): void {
    const database = controlDatabase ?? openDatabase(databasePath);
    controlDatabase = database;
    expect(database.prepare('select count(*) as count from daily_plan_proposals').get()).toEqual({ count: 0 });
    expect(
      database
        .prepare('select status from daily_plan_preflights order by created_at desc limit 1')
        .get(),
    ).toEqual({ status: 'CLAIMED' });
    expect(
      database.prepare('select status from daily_plan_runs order by created_at desc limit 1').get(),
    ).toEqual({ status: 'GENERATING' });
    expect(
      database.prepare('select status from provider_call_logs order by started_at desc limit 1').get(),
    ).toEqual({ status: 'STARTED' });
    expect(
      database
        .prepare('select state, response_status from idempotency_records where idempotency_key = ?')
        .get(idempotencyKey),
    ).toEqual({ state: 'IN_PROGRESS', response_status: null });
  }

  function seedFinishedUsage(ownerId: string, usageDate: string, totals: number[]): void {
    const database = controlDatabase ?? openDatabase(databasePath);
    controlDatabase = database;
    const reliability = createProviderReliabilityRepository(database);
    totals.forEach((totalTokens, index) => {
      const id = `seed-provider-call-${index}-${totalTokens}`;
      expect(
        reliability.reserveProviderCall({
          id,
          ownerId,
          runId: null,
          idempotencyRecordId: null,
          provider: 'DEEPSEEK',
          operation: 'daily_plan.generate',
          model: 'deepseek-v4-flash',
          attemptNo: 1,
          inputChars: 10,
          localDate: usageDate,
          startedAt: '2026-08-24T00:00:00.000Z',
          reservedTokens: totalTokens,
          maxAttemptsPerDay: PROVIDER_POLICY.maxCallsPerOwnerDay,
          maxTokensPerDay: PROVIDER_POLICY.maxTokensPerOwnerDay,
        }),
      ).toBe(true);
      expect(
        reliability.finishProviderCall({
          id,
          status: 'SUCCEEDED',
          failureCode: null,
          finishReason: 'stop',
          usage: { promptTokens: totalTokens, completionTokens: 0, totalTokens },
          outputChars: 10,
          finishedAt: '2026-08-24T00:00:01.000Z',
          durationMs: 1_000,
        }),
      ).toBe(true);
    });
  }

  it('requires an authenticated owner session', async () => {
    app = await buildApp({
      databasePath,
      dailyPlanningProvider: provider,
      logger: false,
      secretStore: new FakeSecretStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      payload: { localDate },
    });

    expect(response.statusCode).toBe(401);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('AUTHENTICATION_REQUIRED');
    expectSafeResponse(response.body);
  });

  it('authenticates an invalid body before request validation', async () => {
    app = await buildApp({
      databasePath,
      dailyPlanningProvider: provider,
      logger: false,
      secretStore: new FakeSecretStore(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      payload: { localDate: 'not-a-date', extra: true },
    });

    expect(response.statusCode).toBe(401);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('AUTHENTICATION_REQUIRED');
    expectSafeResponse(response.body);
  });

  it('rejects request bodies that are not exactly an approved preflight reference', async () => {
    const { token } = await createAuthenticatedApp();

    for (const payload of [
      {},
      { preflightId: 'not-a-uuid', expectedPreflightVersion: 1 },
      {
        preflightId: '00000000-0000-4000-8000-000000000705',
        expectedPreflightVersion: 1,
        extra: true,
      },
    ]) {
      const response = await app!.inject({
        method: 'POST',
        url: '/v1/daily-plans/generate',
        cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v05-route-validation-key-01' },
        payload,
      });

      expect(response.statusCode).toBe(422);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
      expectSafeResponse(response.body);
    }
  });

  it('requires a valid key, replays a completed generation, and rejects semantic key reuse', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    createTimeRequest(ownerId, ownerTimeRequestId, 'idempotency replay request');
    await saveCredential(token);
    const generationInput = await prepareAndApprove(token);

    const missing = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      payload: generationInput,
    });
    expect(missing.statusCode).toBe(400);
    expect(apiErrorSchema.parse(missing.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const invalid = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'short' },
      payload: generationInput,
    });
    expect(invalid.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalid.json()).error.code).toBe('IDEMPOTENCY_KEY_INVALID');

    const first = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-replay-generation' },
      payload: generationInput,
    });
    expect(first.statusCode).toBe(201);
    const replay = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-replay-generation' },
      payload: generationInput,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(provider.inputs).toHaveLength(1);

    const conflict = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-replay-generation' },
      payload: { ...generationInput, expectedPreflightVersion: generationInput.expectedPreflightVersion + 1 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(apiErrorSchema.parse(conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rolls back every success terminal when a fault occurs after Provider-log finalization', async () => {
    const key = 'v05-terminal-uow-success-fault';
    const { token, ownerId } = await createAuthenticatedApp({
      dailyPlanTerminalFault(checkpoint) {
        if (checkpoint.phase === 'PROVIDER_TERMINAL') throw new Error('success terminal fault');
      },
    });
    createTimeRequest(ownerId, ownerTimeRequestId, 'atomic success terminal');
    await saveCredential(token);
    const generationInput = await prepareAndApprove(token);

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': key },
      payload: generationInput,
    });

    expect(response.statusCode).toBe(500);
    expectGenerationTerminalBundleRolledBack(key);
  });

  it('rolls back every failure terminal when a fault occurs after Provider-log finalization', async () => {
    const key = 'v05-terminal-uow-failure-fault';
    const { token } = await createAuthenticatedApp({
      dailyPlanTerminalFault(checkpoint) {
        if (checkpoint.phase === 'PROVIDER_TERMINAL') throw new Error('failure terminal fault');
      },
    });
    await saveCredential(token);
    const generationInput = await prepareAndApprove(token);
    provider.error = new DailyPlanningProviderUnavailableError();

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': key },
      payload: generationInput,
    });

    expect(response.statusCode).toBe(500);
    expectGenerationTerminalBundleRolledBack(key);
  });

  it('atomically reserves the twentieth Shanghai-day call and rejects the concurrent twenty-first before key access', async () => {
    const invocation = new Date('2026-08-24T02:00:00.000Z');
    const { token, ownerId } = await createAuthenticatedApp({
      providerReliabilityNow: () => invocation,
    });
    await saveCredential(token);
    provider.response = {
      schemaVersion: 'DAILY_PLAN_MODEL_V1',
      summary: 'No-op quota concurrency plan.',
      actions: [],
    };
    const firstInput = await prepareAndApprove(token, '2026-09-01');
    const secondInput = await prepareAndApprove(token, '2026-09-02');
    seedFinishedUsage(ownerId, '2026-08-24', Array.from({ length: 19 }, () => 1));

    const entered = deferred();
    const release = deferred();
    provider.beforeGenerate = entered.resolve;
    provider.waitForGenerate = release.promise;
    const firstRequest = app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-quota-concurrent-call-20' },
      payload: firstInput,
    });
    await entered.promise;

    const rejected = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-quota-concurrent-call-21' },
      payload: secondInput,
    });
    expect(rejected.statusCode).toBe(429);
    expect(apiErrorSchema.parse(rejected.json()).error.code).toBe('DAILY_PLAN_PROVIDER_QUOTA_EXCEEDED');
    expect(provider.inputs).toHaveLength(1);
    expect(secretStore.unprotectCalls).toBe(1);
    const started = controlDatabase!
      .prepare("select local_date, total_tokens from provider_call_logs where status = 'STARTED'")
      .get() as { local_date: string; total_tokens: number };
    expect(started.local_date).toBe('2026-08-24');
    expect(started.total_tokens).toBeGreaterThan(PROVIDER_POLICY.maxCompletionTokens);

    release.resolve();
    expect((await firstRequest).statusCode).toBe(201);
    expect(
      controlDatabase!
        .prepare("select total_tokens from provider_call_logs where status = 'SUCCEEDED' order by started_at desc limit 1")
        .get(),
    ).toEqual({ total_tokens: 15 });
  });

  it('rejects concurrent calls at 99k daily tokens before decrypting a key or invoking Provider', async () => {
    const invocation = new Date('2026-08-24T02:00:00.000Z');
    const { token, ownerId } = await createAuthenticatedApp({
      providerReliabilityNow: () => invocation,
    });
    await saveCredential(token);
    provider.response = {
      schemaVersion: 'DAILY_PLAN_MODEL_V1',
      summary: 'No-op quota boundary plan.',
      actions: [],
    };
    const firstInput = await prepareAndApprove(token, '2026-10-01');
    const secondInput = await prepareAndApprove(token, '2026-10-02');
    seedFinishedUsage(ownerId, '2026-08-24', [99_000]);

    const responses = await Promise.all([
      app!.inject({
        method: 'POST',
        url: '/v1/daily-plans/generate',
        cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v05-quota-token-call-a' },
        payload: firstInput,
      }),
      app!.inject({
        method: 'POST',
        url: '/v1/daily-plans/generate',
        cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v05-quota-token-call-b' },
        payload: secondInput,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([429, 429]);
    expect(provider.inputs).toHaveLength(0);
    expect(secretStore.unprotectCalls).toBe(0);
  });

  it('derives the quota date at the Asia/Shanghai natural-day boundary', () => {
    expect(providerUsageLocalDate(new Date('2026-08-23T15:59:59.999Z'))).toBe('2026-08-23');
    expect(providerUsageLocalDate(new Date('2026-08-23T16:00:00.000Z'))).toBe('2026-08-24');
  });

  it('maps a missing credential to a safe provider-not-configured conflict', async () => {
    const { token } = await createAuthenticatedApp();
    const generationInput = await prepareAndApprove(token);

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-missing-credential' },
      payload: generationInput,
    });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe(
      'DAILY_PLAN_PROVIDER_NOT_CONFIGURED',
    );
    expectSafeResponse(response.body);
  });

  it('maps provider transport failures without exposing raw provider text', async () => {
    const { token } = await createAuthenticatedApp();
    await saveCredential(token);
    const generationInput = await prepareAndApprove(token);
    provider.error = new DailyPlanningProviderUnavailableError();

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-provider-unavailable' },
      payload: generationInput,
    });

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_PROVIDER_UNAVAILABLE');
    expectSafeResponse(response.body);
  });

  it('maps malformed fake output without exposing it', async () => {
    const { token } = await createAuthenticatedApp();
    await saveCredential(token);
    const generationInput = await prepareAndApprove(token);
    provider.response = { raw: rawProviderText };

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-model-invalid-0001' },
      payload: generationInput,
    });

    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_MODEL_OUTPUT_INVALID');
    expectSafeResponse(response.body);
  });

  it('maps deterministic validation failures without exposing model text', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    createTimeRequest(ownerId, ownerTimeRequestId, 'owner private request');
    await saveCredential(token);
    const generationInput = await prepareAndApprove(token);
    provider.response = {
      ...validModelOutput(),
      actions: [
        {
          ...validModelOutput().actions[0],
          startLocalTime: '16:30',
          endLocalTime: '17:30',
          rationale: rawProviderText,
        },
      ],
    };

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-validation-failure' },
      payload: generationInput,
    });

    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_VALIDATION_FAILED');
    expectSafeResponse(response.body);
  });

  it('maps an intervening schedule write to the stale base-version conflict', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    createTimeRequest(ownerId, ownerTimeRequestId, 'owner private request');
    await saveCredential(token);
    const generationInput = await prepareAndApprove(token);
    provider.beforeGenerate = () => {
      calendar().createEvent({
        id: '00000000-0000-4000-8000-000000000704',
        ownerId,
        calendarRuleId: null,
        title: 'intervening schedule mutation',
        kind: 'MEETING',
        localDate,
        startLocalTime: '12:00',
        endLocalTime: '13:00',
        isHard: true,
        status: 'CONFIRMED',
        version: 1,
        createdAt: '2026-08-18T07:00:00.000Z',
        updatedAt: '2026-08-18T07:00:00.000Z',
      });
    };

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-stale-base-version' },
      payload: generationInput,
    });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_BASE_VERSION_STALE');
    expectSafeResponse(response.body);
  });

  it('returns an owner-scoped pending proposal without credentials, raw text, or another owner data', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    createTimeRequest(ownerId, ownerTimeRequestId, 'owner private request');
    await saveCredential(token);
    const generationInput = await prepareAndApprove(token);

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-route-successful-proposal' },
      payload: generationInput,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: {
        localDate,
        status: 'PENDING_REVIEW',
        items: [{ timeRequestId: ownerTimeRequestId }],
      },
    });
    expect(provider.inputs).toHaveLength(1);
    expect(JSON.stringify(provider.inputs[0])).not.toContain(otherOwnerTimeRequestId);
    expectSafeResponse(response.body);
  });
});
