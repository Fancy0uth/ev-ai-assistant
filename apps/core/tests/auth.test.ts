import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionResponseSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDatabase } from '../src/storage/database';

const validCredentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('local owner authentication', () => {
  let app: FastifyInstance | undefined;
  let testDirectory: string;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-auth-'));
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(testDirectory, { recursive: true, force: true });
  });

  it('allows exactly one owner setup and authenticates its session cookie', async () => {
    app = await buildApp({
      databasePath: join(testDirectory, 'app.sqlite'),
      logger: false,
      secureCookies: true,
    });

    const initialStatus = await app.inject({ method: 'GET', url: '/v1/auth/setup-status' });
    expect(initialStatus.json()).toEqual({ data: { needsSetup: true } });

    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: validCredentials,
    });
    expect(setup.statusCode).toBe(201);
    expect(String(setup.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(setup.headers['set-cookie'])).toContain('SameSite=Strict');
    expect(String(setup.headers['set-cookie'])).toContain('Secure');
    const token = readSessionToken(setup.headers['set-cookie']);

    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      cookies: { ev_session: token },
    });
    expect(session.statusCode).toBe(200);
    expect(sessionResponseSchema.parse(session.json()).data.owner.username).toBe('本地主人');

    const secondSetup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: 'other-owner', password: 'another safe password' },
    });
    expect(secondSetup.statusCode).toBe(409);
    expect(secondSetup.json().error.code).toBe('SETUP_ALREADY_COMPLETED');

  });

  it('rejects invalid setup input without creating the owner', async () => {
    app = await buildApp({ logger: false });

    const invalidSetup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: '本地主人', password: 'too-short' },
    });
    expect(invalidSetup.statusCode).toBe(422);
    expect(invalidSetup.json().error.code).toBe('VALIDATION_ERROR');

    const setupStatus = await app.inject({
      method: 'GET',
      url: '/v1/auth/setup-status',
    });
    expect(setupStatus.json()).toEqual({ data: { needsSetup: true } });
  });

  it('uses one generic error for invalid login and rate limits the sixth failure', async () => {
    app = await buildApp({ logger: false });
    await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: validCredentials });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { ...validCredentials, password: 'wrong password value' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: '用户名或密码错误',
      });
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { ...validCredentials, password: 'wrong password value' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: '请求过于频繁，请稍后重试',
      },
    });

  });

  it('revokes the current session on logout', async () => {
    app = await buildApp({ logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: validCredentials,
    });
    const token = readSessionToken(setup.headers['set-cookie']);

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { ev_session: token },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ data: { success: true } });

    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      cookies: { ev_session: token },
    });
    expect(session.statusCode).toBe(401);
    expect(session.json().error.code).toBe('AUTHENTICATION_REQUIRED');

  });

  it('stores neither the raw password nor the raw session token', async () => {
    const databasePath = join(testDirectory, 'app.sqlite');
    app = await buildApp({ databasePath, logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: validCredentials,
    });
    const token = readSessionToken(setup.headers['set-cookie']);
    await app.close();
    app = undefined;

    const database = openDatabase(databasePath);
    const owner = database.prepare('select password_hash as passwordHash from owners').get() as {
      passwordHash: string;
    };
    const session = database.prepare('select token_hash as tokenHash from sessions').get() as {
      tokenHash: string;
    };

    expect(owner.passwordHash).not.toContain(validCredentials.password);
    expect(owner.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    database.close();
  });
});
