import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

describe('local memory HTTP API', () => {
  let app: FastifyInstance | undefined;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-memory-routes-'));
  });
  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps revision truth in SQLite while projecting inspectable local Markdown', async () => {
    app = await buildApp({
      databasePath: join(directory, 'app.sqlite'),
      memoryProjectionRoot: join(directory, 'memory'),
      logger: false,
    });
    const setup = await app.inject({
      method: 'POST', url: '/v1/auth/setup', payload: { username: '记忆主人', password: 'correct horse battery staple' },
    });
    const token = tokenFrom(setup.headers['set-cookie']);

    const first = await app.inject({
      method: 'PUT', url: '/v1/memory/FITNESS', cookies: { ev_session: token },
      payload: { content: '训练偏好为晚间。', expectedVersion: null },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ scope: 'FITNESS', version: 1, content: '训练偏好为晚间。' });
    const projection = join(directory, 'memory', 'FITNESS', 'MEMORY.md');
    expect(readFileSync(projection, 'utf8')).toContain('训练偏好为晚间。');

    const second = await app.inject({
      method: 'PUT', url: '/v1/memory/FITNESS', cookies: { ev_session: token },
      payload: { content: '本周下肢训练降低到中等强度。', expectedVersion: 1 },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.version).toBe(2);

    const staleWrite = await app.inject({
      method: 'PUT', url: '/v1/memory/FITNESS', cookies: { ev_session: token },
      payload: { content: '不应覆盖较新记忆。', expectedVersion: 1 },
    });
    expect(staleWrite.statusCode).toBe(409);
    expect(staleWrite.json().error.code).toBe('MEMORY_VERSION_CONFLICT');

    const revisions = await app.inject({ method: 'GET', url: '/v1/memory/FITNESS/revisions', cookies: { ev_session: token } });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().data).toEqual(expect.arrayContaining([expect.objectContaining({ version: 1 }), expect.objectContaining({ version: 2 })]));

    const restored = await app.inject({
      method: 'POST', url: '/v1/memory/FITNESS/restore', cookies: { ev_session: token },
      payload: { expectedVersion: 2, revisionVersion: 1 },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data).toMatchObject({ version: 3, content: '训练偏好为晚间。' });

    const removed = await app.inject({
      method: 'DELETE', url: '/v1/memory/FITNESS', cookies: { ev_session: token },
      payload: { expectedVersion: 3 },
    });
    expect(removed.statusCode).toBe(204);
    expect(existsSync(projection)).toBe(false);
  });
});
