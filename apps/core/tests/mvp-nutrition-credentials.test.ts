import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';

it('stores only protected nutrition credentials, serves owner-only metadata and removes the configuration without external calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ev-mvp-nutrition-key-'));
  const protect = vi.fn(async () => 'synthetic-protected-nutrition');
  const unprotect = vi.fn(async () => 'synthetic-usda-key');
  const external = vi.fn(async () => { throw new Error('UNEXPECTED_EXTERNAL_CALL'); });
  vi.stubGlobal('fetch', external);
  const app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false, secretStore: { protect, unprotect } });
  try {
    expect((await app.inject({ method: 'GET', url: '/v1/providers/usda/credential' })).statusCode).toBe(401);
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: { username: 'nutrition-key-owner', password: 'synthetic-long-password' } });
    expect(setup.statusCode).toBe(201);
    const cookie = [setup.headers['set-cookie']].flat().join(';').match(/ev_session=([^;]+)/)?.[1];
    const cookies = { ev_session: cookie! };
    expect((await app.inject({ method: 'PUT', url: '/v1/providers/usda/credential', cookies, payload: { apiKey: 'DEMO_KEY' } })).statusCode).toBe(422);
    const saved = await app.inject({ method: 'PUT', url: '/v1/providers/usda/credential', cookies, payload: { apiKey: 'synthetic-usda-key' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.state).toBe('CONFIGURED');
    expect(saved.body).not.toContain('synthetic-');
    expect(protect).toHaveBeenCalledWith('synthetic-usda-key');
    const metadata = await app.inject({ method: 'GET', url: '/v1/providers/usda/credential', cookies });
    expect(metadata.json().data.state).toBe('CONFIGURED');
    expect(unprotect).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
    const removed = await app.inject({ method: 'DELETE', url: '/v1/providers/usda/credential', cookies, payload: { confirm: true } });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data.state).toBe('NOT_CONFIGURED');
  } finally {
    await app.close();
    vi.unstubAllGlobals();
    if (dirname(resolve(directory)) === resolve(tmpdir())) await rm(directory, { recursive: true, force: true });
  }
});
