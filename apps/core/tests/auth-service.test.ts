import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthRepository } from '../src/modules/auth/repository';
import { createAuthService, type AuthService } from '../src/modules/auth/service';
import { openDatabase } from '../src/storage/database';

describe('AuthService', () => {
  let database: ReturnType<typeof openDatabase>;
  let service: AuthService;
  let currentTime: Date;

  beforeEach(async () => {
    database = openDatabase(':memory:');
    currentTime = new Date('2026-08-07T00:00:00.000Z');
    service = await createAuthService(createAuthRepository(database), {
      now: () => currentTime,
    });
  });

  afterEach(() => {
    database.close();
  });

  it('creates one owner and resolves the issued session', async () => {
    expect(service.needsSetup()).toBe(true);

    const created = await service.setup({
      username: '本地主人',
      password: 'correct horse battery staple',
    });

    expect(created.owner.username).toBe('本地主人');
    expect(service.needsSetup()).toBe(false);
    expect(service.authenticate(created.token)).toEqual(created.owner);
  });

  it('rejects a second setup with a stable conflict', async () => {
    await service.setup({
      username: '本地主人',
      password: 'correct horse battery staple',
    });

    await expect(
      service.setup({ username: 'other-owner', password: 'another safe password' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SETUP_ALREADY_COMPLETED',
    });
  });

  it('logs in with the correct password and revokes that token', async () => {
    await service.setup({
      username: '本地主人',
      password: 'correct horse battery staple',
    });
    const login = await service.login({
      username: '本地主人',
      password: 'correct horse battery staple',
    });

    expect(service.authenticate(login.token).username).toBe('本地主人');
    service.logout(login.token);
    expect(() => service.authenticate(login.token)).toThrowError(
      expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }),
    );
  });

  it('rejects and removes an expired session', async () => {
    const created = await service.setup({
      username: '本地主人',
      password: 'correct horse battery staple',
    });
    currentTime = new Date('2026-08-14T00:00:00.001Z');

    expect(() => service.authenticate(created.token)).toThrowError(
      expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }),
    );
    expect(database.prepare('select count(*) as count from sessions').get()).toEqual({
      count: 0,
    });
  });
});
