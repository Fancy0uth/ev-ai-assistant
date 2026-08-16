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

describe('local fitness check-in', () => {
  let app: FastifyInstance | undefined;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-fitness-'));
  });
  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('records a deterministic recovery Signal without diagnostic output', async () => {
    app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: '健身主人', password: 'correct horse battery staple' },
    });
    const result = await app.inject({
      method: 'POST',
      url: '/v1/check-ins',
      cookies: { ev_session: tokenFrom(setup.headers['set-cookie']) },
      payload: { localDate: '2026-08-17', sleepHours: 5, energy: 2, discomfort: 4 },
    });
    expect(result.statusCode).toBe(201);
    expect(result.json().data).toMatchObject({
      signal: { kind: 'RECOVERY', source: 'CHECK_IN', value: 25 },
      assessment: { level: 'CAUTION' },
    });
    expect(JSON.stringify(result.json())).not.toMatch(/diagnos|疾病|病症/i);
  });
});
