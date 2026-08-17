import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { apiErrorSchema, type DailyPlanModelOutput } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import {
  DailyPlanningProviderUnavailableError,
  type DailyPlanningProvider,
  type DailyPlanningProviderInput,
} from '../src/modules/daily-planning/provider';
import { SecretStoreUnavailableError, type SecretStorePort } from '../src/modules/providers/secret-store';
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

  async protect(plaintext: string): Promise<string> {
    this.values.set('daily-plan-route-credential', plaintext);
    return 'daily-plan-route-credential';
  }

  async unprotect(protectedValue: string): Promise<string> {
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

  async generate(_apiKey: string, input: DailyPlanningProviderInput): Promise<unknown> {
    this.inputs.push(input);
    this.beforeGenerate?.();
    if (this.error) throw this.error;
    return this.response;
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

describe('daily planning generation route', () => {
  let app: FastifyInstance | undefined;
  let controlDatabase: Database.Database | undefined;
  let databasePath: string;
  let directory: string;
  let provider: FakeDailyPlanningProvider;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-daily-planning-routes-'));
    databasePath = join(directory, 'app.sqlite');
    provider = new FakeDailyPlanningProvider();
  });

  afterEach(async () => {
    controlDatabase?.close();
    controlDatabase = undefined;
    if (app) await app.close();
    app = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  async function createAuthenticatedApp(): Promise<{ token: string; ownerId: string }> {
    app = await buildApp({
      databasePath,
      dailyPlanningProvider: provider,
      logger: false,
      secretStore: new FakeSecretStore(),
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

  it('rejects request bodies that are not exactly a local date', async () => {
    const { token } = await createAuthenticatedApp();

    for (const payload of [{}, { localDate: '2026-8-18' }, { localDate, extra: true }]) {
      const response = await app!.inject({
        method: 'POST',
        url: '/v1/daily-plans/generate',
        cookies: { ev_session: token },
        payload,
      });

      expect(response.statusCode).toBe(422);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
      expectSafeResponse(response.body);
    }
  });

  it('maps a missing credential to a safe provider-not-configured conflict', async () => {
    const { token } = await createAuthenticatedApp();

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      payload: { localDate },
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
    provider.error = new DailyPlanningProviderUnavailableError();

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      payload: { localDate },
    });

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_PROVIDER_UNAVAILABLE');
    expectSafeResponse(response.body);
  });

  it('maps malformed fake output without exposing it', async () => {
    const { token } = await createAuthenticatedApp();
    await saveCredential(token);
    provider.response = { raw: rawProviderText };

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      payload: { localDate },
    });

    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_MODEL_OUTPUT_INVALID');
    expectSafeResponse(response.body);
  });

  it('maps deterministic validation failures without exposing model text', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    createTimeRequest(ownerId, ownerTimeRequestId, 'owner private request');
    await saveCredential(token);
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
      payload: { localDate },
    });

    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_VALIDATION_FAILED');
    expectSafeResponse(response.body);
  });

  it('maps an intervening schedule write to the stale base-version conflict', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    createTimeRequest(ownerId, ownerTimeRequestId, 'owner private request');
    await saveCredential(token);
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
      payload: { localDate },
    });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_BASE_VERSION_STALE');
    expectSafeResponse(response.body);
  });

  it('returns an owner-scoped pending proposal without credentials, raw text, or another owner data', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    createTimeRequest(ownerId, ownerTimeRequestId, 'owner private request');
    await saveCredential(token);

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      payload: { localDate },
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
