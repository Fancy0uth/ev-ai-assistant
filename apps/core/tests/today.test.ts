import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailyPlanPreflightResponseSchema, todaySnapshotSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { DailyPlanningProvider } from '../src/modules/daily-planning/provider';
import type { SecretStorePort } from '../src/modules/providers/secret-store';
import { createTaskRepository } from '../src/modules/tasks/repository';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};

const testApiKey = 'test-only-today-daily-plan-api-key';

class InMemorySecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();
  unprotectCalls = 0;

  async protect(plaintext: string): Promise<string> {
    const protectedValue = `today-snapshot-credential-${this.values.size + 1}`;
    this.values.set(protectedValue, plaintext);
    return protectedValue;
  }

  async unprotect(protectedValue: string): Promise<string> {
    this.unprotectCalls += 1;
    const value = this.values.get(protectedValue);
    if (!value) throw new Error('credential missing');
    return value;
  }
}

const planningProvider: DailyPlanningProvider = {
  async generate() {
    return {
      schemaVersion: 'DAILY_PLAN_MODEL_V1',
      summary: '今天没有可排入时间轴的新增事项。',
      actions: [],
    };
  },
};

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

async function generateApprovedPlan(app: FastifyInstance, token: string, localDate: string) {
  const prepared = await app.inject({
    method: 'POST',
    url: '/v1/daily-plans/preflights',
    cookies: { ev_session: token },
    payload: { localDate },
  });
  expect(prepared.statusCode).toBe(201);
  const preflight = dailyPlanPreflightResponseSchema.parse(prepared.json()).data;
  const approved = await app.inject({
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
  return app.inject({
    method: 'POST',
    url: '/v1/daily-plans/generate',
    cookies: { ev_session: token },
    headers: { 'idempotency-key': `v05-today-${approvedPreflight.id}` },
    payload: {
      preflightId: approvedPreflight.id,
      expectedPreflightVersion: approvedPreflight.version,
    },
  });
}

describe('Today snapshot API', () => {
  let app: FastifyInstance | undefined;
  let testDirectory: string | undefined;

  afterEach(async () => {
    if (app) await app.close();
    if (testDirectory) rmSync(testDirectory, { recursive: true, force: true });
  });

  it('returns an authenticated, explainable snapshot without claiming AI ran', async () => {
    app = await buildApp({ logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    const token = readSessionToken(setup.headers['set-cookie']);

    for (const [index, area] of ['WORK', 'STUDY', 'LIFE'].entries()) {
      await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        cookies: { ev_session: token },
        payload: {
          title: `高优先级任务 ${index + 1}`,
          area,
          priority: 'HIGH',
          targetDate: '2026-08-07',
        },
      });
    }
    await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      cookies: { ev_session: token },
      payload: {
        title: '其他日期的任务',
        area: 'WORK',
        priority: 'LOW',
        targetDate: '2026-08-08',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/today?date=2026-08-07',
      cookies: { ev_session: token },
    });

    expect(response.statusCode).toBe(200);
    const responseBody = response.json();
    const snapshot = todaySnapshotSchema.parse(responseBody).data;
    expect(snapshot.date).toBe('2026-08-07');
    expect(snapshot.tasks).toHaveLength(3);
    expect(snapshot.status).toMatchObject({
      score: 57,
      level: 'TIGHT',
      source: 'RULES_V1',
    });
    expect(snapshot.status.reasons).toContain('仍有 3 个高优先级任务');
    expect(snapshot.yesterday).toBeNull();
    expect(snapshot.agents).toEqual({
      deepSeek: 'NOT_CONFIGURED',
      codex: 'NOT_CONFIGURED',
    });
    expect(responseBody.data.dailyPlan).toEqual({
      status: 'NOT_CONFIGURED',
      proposalId: null,
      pendingItemCount: 0,
    });
  });

  it('includes the signed-in owner’s recovery signals for the requested day', async () => {
    app = await buildApp({ logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    const token = readSessionToken(setup.headers['set-cookie']);

    const checkIn = await app.inject({
      method: 'POST',
      url: '/v1/check-ins',
      cookies: { ev_session: token },
      payload: {
        localDate: '2026-08-07',
        sleepHours: 5,
        energy: 2,
        discomfort: 4,
      },
    });
    expect(checkIn.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/today?date=2026-08-07',
      cookies: { ev_session: token },
    });

    expect(response.statusCode).toBe(200);
    expect(todaySnapshotSchema.parse(response.json()).data.signals).toEqual([
      expect.objectContaining({
        kind: 'RECOVERY',
        source: 'CHECK_IN',
        value: 25,
        localDate: '2026-08-07',
      }),
    ]);
  });

  it('summarizes the latest reviewable daily plan instead of presenting an unconfigured placeholder', async () => {
    const date = '2026-08-07';
    app = await buildApp({
      logger: false,
      secretStore: new InMemorySecretStore(),
      dailyPlanningProvider: planningProvider,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    const token = readSessionToken(setup.headers['set-cookie']);

    const credential = await app.inject({
      method: 'PUT',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
      payload: { apiKey: testApiKey },
    });
    expect(credential.statusCode).toBe(200);

    const generated = await generateApprovedPlan(app, token, date);
    expect(generated.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/today?date=${date}`,
      cookies: { ev_session: token },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.dailyPlan).toMatchObject({
      status: 'PENDING_REVIEW',
      proposalId: generated.json().data.id,
      pendingItemCount: 0,
    });
  });

  it('prepares one post-07:00 local recovery run without calling the Provider or SecretStore', async () => {
    const date = '2026-08-18';
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-today-automation-'));
    const databasePath = join(testDirectory, 'app.sqlite');
    let providerCalls = 0;
    const provider: DailyPlanningProvider = {
      async generate() {
        providerCalls += 1;
        return planningProvider.generate('', {
          localDate: date,
          fixedBlocks: [],
          softBlocks: [],
          timeRequests: [],
          recoveryLevel: 'NONE',
        });
      },
    };
    const secretStore = new InMemorySecretStore();
    app = await buildApp({
      databasePath,
      logger: false,
      secretStore,
      dailyPlanningProvider: provider,
      enableDailyPlanAutomation: true,
      dailyPlanAutomationNow: () => new Date('2026-08-17T23:05:00.000Z'),
    });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const ownerId = setup.json().data.owner.id;
    await app.inject({
      method: 'PUT',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
      payload: { apiKey: testApiKey },
    });
    const unprotectCallsBeforeAutomation = secretStore.unprotectCalls;

    const awaiting = await app.inject({
      method: 'GET',
      url: `/v1/today?date=${date}`,
      cookies: { ev_session: token },
    });
    expect(awaiting.statusCode).toBe(200);
    expect(todaySnapshotSchema.parse(awaiting.json()).data.dailyPlan).toEqual({
      status: 'AWAITING_CONTEXT_APPROVAL',
      proposalId: null,
      pendingItemCount: 0,
    });
    const repeated = await app.inject({
      method: 'GET',
      url: `/v1/today?date=${date}`,
      cookies: { ev_session: token },
    });
    expect(repeated.statusCode).toBe(200);
    expect(todaySnapshotSchema.parse(repeated.json()).data.dailyPlan.status).toBe(
      'AWAITING_CONTEXT_APPROVAL',
    );
    expect(providerCalls).toBe(0);
    expect(secretStore.unprotectCalls).toBe(unprotectCallsBeforeAutomation);

    const database = openDatabase(databasePath);
    try {
      expect(
        Number(
          database
            .prepare('select count(*) from daily_plan_runs where owner_id = ? and local_date = ?')
            .pluck()
            .get(ownerId, date),
        ),
      ).toBe(1);
      expect(
        Number(
          database
            .prepare(
              `select count(*) from daily_plan_preflights
               join daily_plan_runs on daily_plan_runs.id = daily_plan_preflights.run_id
               where daily_plan_runs.owner_id = ? and daily_plan_runs.local_date = ?`,
            )
            .pluck()
            .get(ownerId, date),
        ),
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it('calculates Today from every task for the signed-in owner and date', async () => {
    const date = '2026-08-07';
    const otherDate = '2026-08-08';
    const timestamp = '2026-08-07T00:00:00.000Z';
    const inProgressHighTaskId = '00000000-0000-4000-8000-000000000001';
    const firstMediumTaskId = '00000000-0000-4000-8000-000000000002';
    const inProgressLowTaskId = '00000000-0000-4000-8000-000000000003';
    const lastMediumTaskId = '00000000-0000-4000-8000-000000000100';
    const priorityTaskId = '00000000-0000-4000-8000-000000000101';
    const otherDateTaskId = '00000000-0000-4000-8000-000000000102';
    const otherOwnerId = '00000000-0000-4000-8000-000000000999';
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-today-'));
    const databasePath = join(testDirectory, 'app.sqlite');

    app = await buildApp({ databasePath, logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    const token = readSessionToken(setup.headers['set-cookie']);
    await app.close();
    app = undefined;

    const database = openDatabase(databasePath);
    try {
      const repository = createTaskRepository(database);
      const owner = database.prepare('select id from owners').get() as { id: string };

      for (let index = 1; index <= 100; index += 1) {
        repository.create({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          ownerId: owner.id,
          title: `进行中的中优先级任务 ${index}`,
          area: 'WORK',
          priority: index === 1 ? 'HIGH' : index === 3 ? 'LOW' : 'MEDIUM',
          status: 'IN_PROGRESS',
          targetDate: date,
          completedAt: null,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      repository.create({
        id: priorityTaskId,
        ownerId: owner.id,
        title: '第 101 个高优先级任务',
        area: 'WORK',
        priority: 'HIGH',
        status: 'OPEN',
        targetDate: date,
        completedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      repository.create({
        id: otherDateTaskId,
        ownerId: owner.id,
        title: '其他日期的高优先级任务',
        area: 'WORK',
        priority: 'HIGH',
        status: 'OPEN',
        targetDate: otherDate,
        completedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      expect(repository.listForDate(otherOwnerId, date)).toEqual([]);
    } finally {
      database.close();
    }

    app = await buildApp({ databasePath, logger: false });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/today?date=${date}`,
      cookies: { ev_session: token },
    });

    expect(response.statusCode).toBe(200);
    const snapshot = todaySnapshotSchema.parse(response.json()).data;
    expect(snapshot.tasks).toHaveLength(101);
    const taskIds = snapshot.tasks.map(({ id }) => id);
    expect(taskIds.slice(0, 2)).toEqual([inProgressHighTaskId, firstMediumTaskId]);
    expect(taskIds.slice(98)).toEqual([
      lastMediumTaskId,
      inProgressLowTaskId,
      priorityTaskId,
    ]);
    expect(taskIds).not.toContain(otherDateTaskId);
    expect(snapshot.status).toMatchObject({
      score: 60,
      level: 'TIGHT',
      source: 'RULES_V1',
    });
    expect(snapshot.status.reasons).toEqual([
      '仍有 2 个高优先级任务',
      '待处理任务共 101 个，注意控制负载',
    ]);
    expect(snapshot.status.priorities.map(({ id }) => id)).toEqual([
      inProgressHighTaskId,
      priorityTaskId,
      firstMediumTaskId,
    ]);
  });

  it('rejects unauthenticated and invalid-date requests', async () => {
    app = await buildApp({ logger: false });
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/v1/today?date=2026-08-07',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/today?date=not-a-date',
      cookies: { ev_session: readSessionToken(setup.headers['set-cookie']) },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
  });
});
