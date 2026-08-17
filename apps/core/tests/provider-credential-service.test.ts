import { deepSeekCredentialMetadataSchema } from '@ev/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  readonly protectedValues: string[] = [];

  async protect(plaintext: string): Promise<string> {
    const protectedValue = `fake:${Buffer.from(plaintext, 'utf8').toString('base64')}`;
    this.protectedValues.push(protectedValue);
    return protectedValue;
  }

  async unprotect(protectedValue: string): Promise<string> {
    if (!protectedValue.startsWith('fake:')) {
      throw new SecretStoreUnavailableError();
    }
    return Buffer.from(protectedValue.slice('fake:'.length), 'base64').toString('utf8');
  }
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
      protected_value: fakeSecretStore.protectedValues[0],
      version: 1,
      created_at: '2026-08-17T05:30:00.000Z',
      updated_at: '2026-08-17T05:30:00.000Z',
    });
    expect(stored.protected_value).not.toContain(testApiKey);
    expect(metadata).toEqual({
      providerKey: 'DEEPSEEK',
      state: 'CONFIGURED',
      updatedAt: '2026-08-17T05:30:00.000Z',
      lastConnectionTest: null,
    });
    expect(deepSeekCredentialMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(JSON.stringify(metadata)).not.toContain(testApiKey);

    const callbackResult = await service.withApiKey(ownerId, (apiKey) => {
      expect(apiKey).toBe(testApiKey);
      return 'callback-consumed';
    });
    expect(callbackResult).toBe('callback-consumed');
  });

  it('replaces a credential by incrementing version without retaining the previous protected value', async () => {
    await service.save(ownerId, testApiKey);
    const firstProtectedValue = fakeSecretStore.protectedValues[0];
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
      protected_value: fakeSecretStore.protectedValues[1],
      version: 2,
      created_at: '2026-08-17T05:30:00.000Z',
      updated_at: '2026-08-17T06:30:00.000Z',
    });
    expect(stored.protected_value).not.toBe(firstProtectedValue);
    await expect(service.withApiKey(ownerId, (apiKey) => apiKey)).resolves.toBe(
      'test-only-replacement-key',
    );
  });

  it('keeps queries and deletion scoped to the requested owner ID', async () => {
    await service.save(ownerId, testApiKey);

    expect(service.getMetadata('owner-b').state).toBe('NOT_CONFIGURED');
    await expect(service.withApiKey('owner-b', () => 'unreachable')).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
    service.remove('owner-b');
    await expect(service.withApiKey(ownerId, (apiKey) => apiKey)).resolves.toBe(testApiKey);

    service.remove(ownerId);

    expect(service.getMetadata(ownerId).state).toBe('NOT_CONFIGURED');
    await expect(service.withApiKey(ownerId, () => 'unreachable')).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
  });

  it('distinguishes a missing credential from an unavailable SecretStore', async () => {
    await expect(service.withApiKey(ownerId, () => 'unreachable')).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );

    await service.save(ownerId, testApiKey);
    const unavailableService = createProviderCredentialService(
      database,
      new UnavailableSecretStore(),
    );

    await expect(unavailableService.withApiKey(ownerId, () => 'unreachable')).rejects.toBeInstanceOf(
      SecretStoreUnavailableError,
    );
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
});
