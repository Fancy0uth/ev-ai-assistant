import { todaySnapshotSchema } from '@ev/contracts';
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
    expect(snapshot.status.reasons).toContain('仍有 3 个高优先级任务');
    expect(snapshot.yesterday).toBeNull();
    expect(snapshot.agents).toEqual({
      deepSeek: 'NOT_CONFIGURED',
      codex: 'NOT_CONFIGURED',
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
