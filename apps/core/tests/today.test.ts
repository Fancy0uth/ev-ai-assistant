import { taskListResponseSchema, taskResponseSchema, todaySnapshotSchema, type Task } from '@ev/contracts';
import { calculateDailyStatus } from '@ev/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('Today snapshot API', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
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
    const snapshot = todaySnapshotSchema.parse(response.json()).data;
    expect(snapshot.date).toBe('2026-08-07');
    expect(snapshot.tasks).toHaveLength(3);
    expect(snapshot.status).toMatchObject({
      score: 57,
      level: 'TIGHT',
      source: 'RULES_V1',
    });
    expect(snapshot.yesterday).toBeNull();
    expect(snapshot.agents).toEqual({
      deepSeek: 'NOT_CONFIGURED',
      codex: 'NOT_CONFIGURED',
    });
  });

  it('scores every matching task beyond the paginated task-list limit', async () => {
    app = await buildApp({ logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    const cookies = { ev_session: readSessionToken(setup.headers['set-cookie']) };
    const tasks: Task[] = [];

    for (let index = 0; index < 200; index += 1) {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        cookies,
        payload: {
          title: `今日任务 ${index + 1}`,
          area: 'WORK',
          priority: 'LOW',
          targetDate: '2026-08-07',
        },
      });
      expect(created.statusCode).toBe(201);
      let task = taskResponseSchema.parse(created.json()).data;
      if (index >= 100) {
        const completed = await app.inject({
          method: 'PATCH',
          url: `/v1/tasks/${task.id}`,
          cookies,
          payload: { version: task.version, status: 'DONE' },
        });
        expect(completed.statusCode).toBe(200);
        task = taskResponseSchema.parse(completed.json()).data;
      }
      tasks.push(task);
    }

    const otherDate = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      cookies,
      payload: {
        title: '不计入今日的高优先级任务',
        area: 'WORK',
        priority: 'HIGH',
        targetDate: '2026-08-08',
      },
    });
    expect(otherDate.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/today?date=2026-08-07',
      cookies,
    });
    expect(response.statusCode).toBe(200);
    const snapshot = todaySnapshotSchema.parse(response.json()).data;
    expect(snapshot.tasks).toHaveLength(200);
    expect(snapshot.tasks).toEqual(expect.arrayContaining(tasks));
    expect(snapshot.status).toEqual(calculateDailyStatus({ tasks, yesterday: null }));
    expect(snapshot.status.score).toBe(80);

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/tasks?pageSize=999&targetDate=2026-08-07',
      cookies,
    });
    expect(listed.statusCode).toBe(200);
    const page = taskListResponseSchema.parse(listed.json()).data;
    expect(page.items).toEqual(snapshot.tasks.slice(0, 100));
    expect(page.pagination).toEqual({ page: 1, pageSize: 100, total: 200, totalPages: 2 });
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
