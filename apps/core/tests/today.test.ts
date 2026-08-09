import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { todaySnapshotSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createTaskRepository } from '../src/modules/tasks/repository';
import { openDatabase } from '../src/storage/database';

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
    const snapshot = todaySnapshotSchema.parse(response.json()).data;
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
  });

  it('calculates Today from every task for the signed-in owner and date', async () => {
    const date = '2026-08-07';
    const otherDate = '2026-08-08';
    const timestamp = '2026-08-07T00:00:00.000Z';
    const priorityTaskId = '00000000-0000-4000-8000-000000000101';
    const otherDateTaskId = '00000000-0000-4000-8000-000000000102';
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
          priority: 'MEDIUM',
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

      expect(
        repository.list('00000000-0000-4000-8000-000000000999', {
          page: 1,
          pageSize: 100,
          targetDate: date,
        }).items,
      ).toEqual([]);
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
    expect(snapshot.tasks.map(({ id }) => id)).toContain(priorityTaskId);
    expect(snapshot.tasks.map(({ id }) => id)).not.toContain(otherDateTaskId);
    expect(snapshot.status).toMatchObject({
      score: 67,
      level: 'TIGHT',
      source: 'RULES_V1',
    });
    expect(snapshot.status.reasons).toEqual([
      '仍有 1 个高优先级任务',
      '待处理任务共 101 个，注意控制负载',
    ]);
    expect(snapshot.status.priorities[0]).toMatchObject({
      id: priorityTaskId,
      title: '第 101 个高优先级任务',
      priority: 'HIGH',
      status: 'OPEN',
    });
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
