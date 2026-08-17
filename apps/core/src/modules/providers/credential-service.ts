import type { DeepSeekCredentialMetadata } from '@ev/contracts';
import type Database from 'better-sqlite3';
import { SecretStoreUnavailableError, type SecretStorePort } from './secret-store';

interface ProviderCredentialRow {
  protected_value: string;
  updated_at: string;
}

interface ProviderCredentialServiceOptions {
  now?: () => Date;
}

export class CredentialNotConfiguredError extends Error {
  readonly code = 'CREDENTIAL_NOT_CONFIGURED';

  constructor() {
    super('Credential is not configured');
    this.name = 'CredentialNotConfiguredError';
  }
}

export interface ProviderCredentialService {
  getMetadata(ownerId: string): DeepSeekCredentialMetadata;
  save(ownerId: string, apiKey: string): Promise<DeepSeekCredentialMetadata>;
  withApiKey(ownerId: string, callback: (apiKey: string) => void | Promise<void>): Promise<void>;
  remove(ownerId: string): void;
}

function toMetadata(row: ProviderCredentialRow | undefined): DeepSeekCredentialMetadata {
  return {
    providerKey: 'DEEPSEEK',
    state: row ? 'CONFIGURED' : 'NOT_CONFIGURED',
    updatedAt: row?.updated_at ?? null,
    lastConnectionTest: null,
  };
}

function unavailable(): SecretStoreUnavailableError {
  return new SecretStoreUnavailableError();
}

export function createProviderCredentialService(
  database: Database.Database,
  secretStore: SecretStorePort,
  options: ProviderCredentialServiceOptions = {},
): ProviderCredentialService {
  const now = options.now ?? (() => new Date());
  const findStatement = database.prepare(
    `select protected_value, updated_at
     from provider_credentials
     where owner_id = ? and provider_key = 'DEEPSEEK'`,
  );
  const saveStatement = database.prepare(
    `insert into provider_credentials (
       owner_id, provider_key, protected_value, version, created_at, updated_at
     ) values (?, 'DEEPSEEK', ?, 1, ?, ?)
     on conflict(owner_id, provider_key) do update set
       protected_value = excluded.protected_value,
       version = provider_credentials.version + 1,
       updated_at = excluded.updated_at`,
  );
  const removeStatement = database.prepare(
    `delete from provider_credentials where owner_id = ? and provider_key = 'DEEPSEEK'`,
  );

  function find(ownerId: string): ProviderCredentialRow | undefined {
    return findStatement.get(ownerId) as ProviderCredentialRow | undefined;
  }

  return {
    getMetadata(ownerId) {
      return toMetadata(find(ownerId));
    },

    async save(ownerId, apiKey) {
      let protectedValue: string;
      try {
        protectedValue = await secretStore.protect(apiKey);
      } catch {
        throw unavailable();
      }
      const timestamp = now().toISOString();
      saveStatement.run(ownerId, protectedValue, timestamp, timestamp);
      return toMetadata(find(ownerId));
    },

    async withApiKey(ownerId, callback) {
      const credential = find(ownerId);
      if (!credential) throw new CredentialNotConfiguredError();

      let apiKey: string;
      try {
        apiKey = await secretStore.unprotect(credential.protected_value);
      } catch {
        throw unavailable();
      }
      await callback(apiKey);
    },

    remove(ownerId) {
      removeStatement.run(ownerId);
    },
  };
}
