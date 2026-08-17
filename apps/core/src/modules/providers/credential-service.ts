import type { DeepSeekConnectionTestResult, DeepSeekCredentialMetadata } from '@ev/contracts';
import type Database from 'better-sqlite3';
import {
  createDeepSeekConnectionTester,
  type DeepSeekConnectionTester,
} from './deepseek-connection';
import { SecretStoreUnavailableError, type SecretStorePort } from './secret-store';

interface ProviderCredentialRow {
  protected_value: string;
  updated_at: string;
}

interface ProviderConnectionTestRow {
  status: 'SUCCEEDED' | 'FAILED';
  failure_code: string | null;
}

interface ProviderCredentialServiceOptions {
  now?: () => Date;
  connectionTester?: DeepSeekConnectionTester;
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
  testConnection(ownerId: string): Promise<DeepSeekConnectionTestResult>;
  remove(ownerId: string): void;
}

function toConnectionTestResult(
  row: ProviderConnectionTestRow | undefined,
): DeepSeekConnectionTestResult | null {
  if (!row) return null;
  if (row.status === 'SUCCEEDED') return { status: 'SUCCEEDED' };

  switch (row.failure_code) {
    case 'AUTHENTICATION_FAILED':
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'INVALID_RESPONSE':
    case 'PROVIDER_UNAVAILABLE':
      return { status: 'FAILED', failureCode: row.failure_code };
    default:
      return { status: 'FAILED', failureCode: 'INVALID_RESPONSE' };
  }
}

function toMetadata(
  row: ProviderCredentialRow | undefined,
  connectionTest: DeepSeekConnectionTestResult | null,
): DeepSeekCredentialMetadata {
  return {
    providerKey: 'DEEPSEEK',
    state: row ? 'CONFIGURED' : 'NOT_CONFIGURED',
    updatedAt: row?.updated_at ?? null,
    lastConnectionTest: connectionTest,
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
  const connectionTester = options.connectionTester ?? createDeepSeekConnectionTester();
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
  const findLatestConnectionTestStatement = database.prepare(
    `select status, failure_code
     from provider_connection_tests
     where owner_id = ? and provider_key = 'DEEPSEEK'
     order by created_at desc, rowid desc
     limit 1`,
  );
  const saveConnectionTestStatement = database.prepare(
    `insert into provider_connection_tests (
       owner_id, provider_key, status, failure_code, created_at
     ) values (?, 'DEEPSEEK', ?, ?, ?)`,
  );

  function find(ownerId: string): ProviderCredentialRow | undefined {
    return findStatement.get(ownerId) as ProviderCredentialRow | undefined;
  }

  function findLatestConnectionTest(ownerId: string): DeepSeekConnectionTestResult | null {
    return toConnectionTestResult(
      findLatestConnectionTestStatement.get(ownerId) as ProviderConnectionTestRow | undefined,
    );
  }

  async function withApiKey(
    ownerId: string,
    callback: (apiKey: string) => void | Promise<void>,
  ): Promise<void> {
    const credential = find(ownerId);
    if (!credential) throw new CredentialNotConfiguredError();

    let apiKey: string;
    try {
      apiKey = await secretStore.unprotect(credential.protected_value);
    } catch {
      throw unavailable();
    }
    await callback(apiKey);
  }

  return {
    getMetadata(ownerId) {
      return toMetadata(find(ownerId), findLatestConnectionTest(ownerId));
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
      return toMetadata(find(ownerId), findLatestConnectionTest(ownerId));
    },

    withApiKey,

    async testConnection(ownerId) {
      let result: DeepSeekConnectionTestResult = {
        status: 'FAILED',
        failureCode: 'NETWORK_ERROR',
      };
      await withApiKey(ownerId, async (apiKey) => {
        try {
          result = await connectionTester.test(apiKey);
        } catch {
          result = { status: 'FAILED', failureCode: 'NETWORK_ERROR' };
        }
      });
      saveConnectionTestStatement.run(
        ownerId,
        result.status,
        result.status === 'FAILED' ? result.failureCode : null,
        now().toISOString(),
      );
      return result;
    },

    remove(ownerId) {
      removeStatement.run(ownerId);
    },
  };
}
