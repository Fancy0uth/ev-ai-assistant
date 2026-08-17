import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { deepSeekCredentialMetadataSchema } from '@ev/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CredentialNotConfiguredError,
  createProviderCredentialService,
  type ProviderCredentialService,
} from '../src/modules/providers/credential-service';
import {
  createWindowsDpapiSecretStore,
  SecretStoreUnavailableError,
  type SecretStorePort,
} from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';

const testApiKey = 'test-only-deepseek-key';
const ownerId = 'owner-a';

class FakeSecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();
  private nextToken = 1;

  async protect(plaintext: string): Promise<string> {
    const token = `opaque-${this.nextToken}`;
    this.nextToken += 1;
    this.values.set(token, plaintext);
    return token;
  }

  async unprotect(protectedValue: string): Promise<string> {
    const plaintext = this.values.get(protectedValue);
    if (plaintext === undefined) {
      throw new SecretStoreUnavailableError();
    }
    return plaintext;
  }
}

class FakeDpapiChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killCalls = 0;

  kill(): boolean {
    this.killCalls += 1;
    return true;
  }

  close(exitCode: number | null): void {
    this.emit('close', exitCode);
  }
}

function expectUnavailable(error: unknown): void {
  expect(error).toBeInstanceOf(SecretStoreUnavailableError);
  expect(error).toMatchObject({
    code: 'SECRET_STORE_UNAVAILABLE',
    message: 'Secret storage is unavailable',
  });
}

async function expectChildFailure(
  operation: Promise<unknown>,
  child: FakeDpapiChild,
): Promise<void> {
  await operation.catch(expectUnavailable);
  expect(child.stdin.destroyed).toBe(true);
  expect(child.killCalls).toBe(1);
}

class UnavailableSecretStore implements SecretStorePort {
  async protect(): Promise<string> {
    throw new SecretStoreUnavailableError();
  }

  async unprotect(): Promise<string> {
    throw new SecretStoreUnavailableError();
  }
}

describe('ProviderCredentialService', () => {
  let database: ReturnType<typeof openDatabase>;
  let service: ProviderCredentialService;
  let fakeSecretStore: FakeSecretStore;
  let currentTime: Date;

  beforeEach(() => {
    database = openDatabase(':memory:');
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'owner-a', 'not-used', '2026-08-17T05:30:00.000Z');
    fakeSecretStore = new FakeSecretStore();
    currentTime = new Date('2026-08-17T05:30:00.000Z');
    service = createProviderCredentialService(database, fakeSecretStore, {
      now: () => currentTime,
    });
  });

  afterEach(() => {
    database.close();
  });

  it('saves only a protected value and exposes the key only to withApiKey callback', async () => {
    expect(service.getMetadata(ownerId)).toEqual({
      providerKey: 'DEEPSEEK',
      state: 'NOT_CONFIGURED',
      updatedAt: null,
      lastConnectionTest: null,
    });

    const metadata = await service.save(ownerId, testApiKey);
    const stored = database
      .prepare(
        `select protected_value, version, created_at, updated_at
         from provider_credentials where owner_id = ? and provider_key = ?`,
      )
      .get(ownerId, 'DEEPSEEK') as {
      protected_value: string;
      version: number;
      created_at: string;
      updated_at: string;
    };

    expect(stored).toEqual({
      protected_value: 'opaque-1',
      version: 1,
      created_at: '2026-08-17T05:30:00.000Z',
      updated_at: '2026-08-17T05:30:00.000Z',
    });
    expect(stored.protected_value).not.toContain(testApiKey);
    expect(stored.protected_value).not.toContain(Buffer.from(testApiKey, 'utf8').toString('base64'));
    expect(metadata).toEqual({
      providerKey: 'DEEPSEEK',
      state: 'CONFIGURED',
      updatedAt: '2026-08-17T05:30:00.000Z',
      lastConnectionTest: null,
    });
    expect(deepSeekCredentialMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(JSON.stringify(metadata)).not.toContain(testApiKey);
    expect(JSON.stringify(metadata)).not.toContain(
      Buffer.from(testApiKey, 'utf8').toString('base64'),
    );

    let callbackInvocations = 0;
    await service.withApiKey(ownerId, (apiKey) => {
      expect(apiKey).toBe(testApiKey);
      callbackInvocations += 1;
    });
    expect(callbackInvocations).toBe(1);
  });

  it('replaces a credential by incrementing version without retaining the previous protected value', async () => {
    await service.save(ownerId, testApiKey);
    const firstProtectedValue = 'opaque-1';
    currentTime = new Date('2026-08-17T06:30:00.000Z');

    await service.save(ownerId, 'test-only-replacement-key');
    const stored = database
      .prepare(
        `select protected_value, version, created_at, updated_at
         from provider_credentials where owner_id = ? and provider_key = ?`,
      )
      .get(ownerId, 'DEEPSEEK') as {
      protected_value: string;
      version: number;
      created_at: string;
      updated_at: string;
    };

    expect(stored).toEqual({
      protected_value: 'opaque-2',
      version: 2,
      created_at: '2026-08-17T05:30:00.000Z',
      updated_at: '2026-08-17T06:30:00.000Z',
    });
    expect(stored.protected_value).not.toBe(firstProtectedValue);
    await service.withApiKey(ownerId, (apiKey) => {
      expect(apiKey).toBe('test-only-replacement-key');
    });
  });

  it('keeps queries and deletion scoped to the requested owner ID', async () => {
    await service.save(ownerId, testApiKey);

    expect(service.getMetadata('owner-b').state).toBe('NOT_CONFIGURED');
    await expect(service.withApiKey('owner-b', () => undefined)).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
    service.remove('owner-b');
    await service.withApiKey(ownerId, (apiKey) => {
      expect(apiKey).toBe(testApiKey);
    });

    service.remove(ownerId);

    expect(service.getMetadata(ownerId).state).toBe('NOT_CONFIGURED');
    await expect(service.withApiKey(ownerId, () => undefined)).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
  });

  it('distinguishes a missing credential from an unavailable SecretStore', async () => {
    await expect(service.withApiKey(ownerId, () => undefined)).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );

    await service.save(ownerId, testApiKey);
    const unavailableService = createProviderCredentialService(
      database,
      new UnavailableSecretStore(),
    );

    await expect(unavailableService.withApiKey(ownerId, () => undefined)).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
  });

  it('does not create a credential when protection is unavailable', async () => {
    const unavailableService = createProviderCredentialService(
      database,
      new UnavailableSecretStore(),
    );

    await expect(unavailableService.save(ownerId, testApiKey)).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
    expect(database.prepare('select count(*) as count from provider_credentials').get()).toEqual({
      count: 0,
    });
  });
});

describe('WindowsDpapiSecretStore', () => {
  it('is explicitly unavailable outside Windows without including plaintext in its error', async () => {
    const secretStore = createWindowsDpapiSecretStore({ platform: 'linux' });

    await expect(secretStore.protect(testApiKey)).rejects.toMatchObject({
      code: 'SECRET_STORE_UNAVAILABLE',
      message: 'Secret storage is unavailable',
    });
    await expect(secretStore.unprotect('not-a-dpapi-value')).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
  });

  it('fails closed and cleans up when the spawned PowerShell process errors', async () => {
    const child = new FakeDpapiChild();
    const secretStore = createWindowsDpapiSecretStore({
      platform: 'win32',
      spawn: () => child,
    });
    const protectedValue = secretStore.protect(testApiKey);

    child.emit('error', new Error(`spawn failed for ${testApiKey}`));

    await expectChildFailure(protectedValue, child);
  });

  it('fails closed and cleans up when PowerShell stdin errors', async () => {
    const child = new FakeDpapiChild();
    const secretStore = createWindowsDpapiSecretStore({
      platform: 'win32',
      spawn: () => child,
    });
    const protectedValue = secretStore.protect(testApiKey);

    child.stdin.emit('error', new Error(`stdin failed for ${testApiKey}`));

    await expectChildFailure(protectedValue, child);
  });

  it('fails closed and cleans up after a nonzero PowerShell exit', async () => {
    const child = new FakeDpapiChild();
    const secretStore = createWindowsDpapiSecretStore({
      platform: 'win32',
      spawn: () => child,
    });
    const protectedValue = secretStore.protect(testApiKey);

    child.stderr.write(`nonzero failure for ${testApiKey}`);
    child.close(1);
    child.emit('error', new Error(`late process error for ${testApiKey}`));

    await expectChildFailure(protectedValue, child);
  });

  it('fails closed and cleans up after invalid Base64 output', async () => {
    const child = new FakeDpapiChild();
    const secretStore = createWindowsDpapiSecretStore({
      platform: 'win32',
      spawn: () => child,
    });
    const protectedValue = secretStore.protect(testApiKey);

    child.stdout.end('not valid base64');
    child.stderr.end();
    child.close(0);

    await expectChildFailure(protectedValue, child);
  });

  it.each([
    ['stdout', (child: FakeDpapiChild) => child.stdout.write(Buffer.alloc(16 * 1024 + 1))],
    ['stderr', (child: FakeDpapiChild) => child.stderr.write(Buffer.alloc(16 * 1024 + 1))],
  ])('fails closed and cleans up when PowerShell %s exceeds the output limit', async (_stream, write) => {
    const child = new FakeDpapiChild();
    const secretStore = createWindowsDpapiSecretStore({
      platform: 'win32',
      spawn: () => child,
    });
    const protectedValue = secretStore.protect(testApiKey);

    write(child);

    await expectChildFailure(protectedValue, child);
  });

  it('fails closed and cleans up when PowerShell times out', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeDpapiChild();
      const secretStore = createWindowsDpapiSecretStore({
        platform: 'win32',
        spawn: () => child,
      });
      const protectedValue = secretStore.protect(testApiKey);
      const failure = protectedValue.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(5_000);

      expectUnavailable(await failure);
      expect(child.stdin.destroyed).toBe(true);
      expect(child.killCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
