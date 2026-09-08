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

describe('confirmed local meal records', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-nutrition-'));
  });
  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('only persists user-confirmed numeric food values and calculates totals in Core', async () => {
    app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: '饮食主人', password: 'correct horse battery staple' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/meals',
      cookies: { ev_session: tokenFrom(setup.headers['set-cookie']) },
      payload: {
        localDate: '2026-08-17',
        entries: [
          {
            name: '燕麦',
            grams: 80,
            calories: 300,
            proteinGrams: 10,
            carbohydrateGrams: 50,
            fatGrams: 6,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      totals: { calories: 300, proteinGrams: 10, carbohydrateGrams: 50, fatGrams: 6 },
    });
    const v2Meals = await app.inject({
      method: 'GET',
      url: '/v1/nutrition/meals',
      cookies: { ev_session: tokenFrom(setup.headers['set-cookie']) },
    });
    expect(v2Meals.json().data.items).toEqual([]);
  });
});
