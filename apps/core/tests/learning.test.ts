import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

describe('local course profiles and attributed resources', () => {
  let app: FastifyInstance | undefined;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-learning-'));
  });
  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates a course under an owned term and attributes a user-provided resource', async () => {
    app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: '学习主人', password: 'correct horse battery staple' },
    });
    const token = tokenFrom(setup.headers['set-cookie']);
    const term = await app.inject({
      method: 'POST',
      url: '/v1/terms',
      cookies: { ev_session: token },
      payload: { title: '2026 秋季', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' },
    });
    const course = await app.inject({
      method: 'POST',
      url: '/v1/courses',
      cookies: { ev_session: token },
      payload: { termId: term.json().data.id, title: '机器学习导论', officialUrl: 'https://example.edu/ml' },
    });
    expect(course.statusCode).toBe(201);
    const resource = await app.inject({
      method: 'POST',
      url: `/v1/courses/${course.json().data.id}/resources`,
      cookies: { ev_session: token },
      payload: { title: '第一周课程说明', url: 'https://example.edu/ml/week-1' },
    });
    expect(resource.statusCode).toBe(201);
    expect(resource.json().data).toMatchObject({ source: 'USER_PROVIDED', title: '第一周课程说明' });

    const resources = await app.inject({
      method: 'GET',
      url: `/v1/courses/${course.json().data.id}/resources`,
      cookies: { ev_session: token },
    });
    expect(resources.statusCode).toBe(200);
    expect(resources.json().data).toEqual([
      expect.objectContaining({ source: 'USER_PROVIDED', title: '第一周课程说明' }),
    ]);

    const listed = await app.inject({ method: 'GET', url: '/v1/courses', cookies: { ev_session: token } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toEqual([expect.objectContaining({ title: '机器学习导论' })]);
  });
});
