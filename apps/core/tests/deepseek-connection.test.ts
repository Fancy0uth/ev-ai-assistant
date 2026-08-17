import type { DeepSeekConnectionTestResult } from '@ev/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDeepSeekConnectionTester,
  type DeepSeekConnectionTester,
  type DeepSeekFetch,
} from '../src/modules/providers/deepseek-connection';
import {
  createProviderCredentialService,
  type ProviderCredentialService,
} from '../src/modules/providers/credential-service';
import type { SecretStorePort } from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';

const apiKey = 'deepseek-key-that-must-stay-secret';
const ownerId = 'owner-deepseek-test';

class FakeSecretStore implements SecretStorePort {
  async protect(): Promise<string> {
    return 'opaque-protected-value';
  }

  async unprotect(): Promise<string> {
    return apiKey;
  }
}

function response(status: number, json: unknown): Awaited<ReturnType<DeepSeekFetch>> {
  return {
    status,
    json: async () => json,
  };
}

function successfulResponse(): Awaited<ReturnType<DeepSeekFetch>> {
  return response(200, {
    choices: [{ message: { content: '{"status":"ok"}' } }],
  });
}

describe('DeepSeek connection tester', () => {
  it('sends a fixed minimal JSON probe without the API key or personal context', async () => {
    let capturedUrl = '';
    let capturedInit: Parameters<DeepSeekFetch>[1] | undefined;
    const fetch: DeepSeekFetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return successfulResponse();
    };

    const result = await createDeepSeekConnectionTester({ fetch }).test(apiKey);

    expect(result).toEqual({ status: 'SUCCEEDED' });
    expect(capturedUrl).toBe('https://api.deepseek.com/chat/completions');
    expect(capturedInit).toMatchObject({
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'user',
          content: 'Reply only with JSON: {"status":"ok"}.',
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 16,
    });
    expect(String(capturedInit?.body)).not.toContain(apiKey);
    expect(String(capturedInit?.body)).not.toMatch(
      /schedule|task|course|health|memory|personal/i,
    );
  });

  it.each([
    [
      '401 responses',
      async () => response(401, {}),
      { status: 'FAILED', failureCode: 'AUTHENTICATION_FAILED' },
    ],
    [
      '403 responses',
      async () => response(403, {}),
      { status: 'FAILED', failureCode: 'AUTHENTICATION_FAILED' },
    ],
    [
      '429 responses',
      async () => response(429, {}),
      { status: 'FAILED', failureCode: 'RATE_LIMITED' },
    ],
    [
      'server errors',
      async () => response(503, {}),
      { status: 'FAILED', failureCode: 'PROVIDER_UNAVAILABLE' },
    ],
    [
      'network errors',
      async () => Promise.reject(new TypeError('network disconnected')),
      { status: 'FAILED', failureCode: 'NETWORK_ERROR' },
    ],
    [
      'timeout errors',
      async () => Promise.reject(Object.assign(new Error('timed out'), { name: 'AbortError' })),
      { status: 'FAILED', failureCode: 'NETWORK_ERROR' },
    ],
    [
      'empty successful responses',
      async () => response(200, undefined),
      { status: 'FAILED', failureCode: 'INVALID_RESPONSE' },
    ],
    [
      'malformed successful response content',
      async () => response(200, { choices: [{ message: { content: '{' } }] }),
      { status: 'FAILED', failureCode: 'INVALID_RESPONSE' },
    ],
    [
      'contract-invalid successful response content',
      async () => response(200, { choices: [{ message: { content: '{"status":"nope"}' } }] }),
      { status: 'FAILED', failureCode: 'INVALID_RESPONSE' },
    ],
  ] satisfies ReadonlyArray<
    readonly [string, DeepSeekFetch, DeepSeekConnectionTestResult]
  >)('maps %s without exposing provider details', async (_name, fetch, expected) => {
    const result = await createDeepSeekConnectionTester({ fetch }).test(apiKey);

    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });
});

describe('ProviderCredentialService connection tests', () => {
  let database: ReturnType<typeof openDatabase>;
  let service: ProviderCredentialService;
  let currentTime: Date;
  const receivedApiKeys: string[] = [];
  const outcomes: DeepSeekConnectionTestResult[] = [
    { status: 'SUCCEEDED' },
    { status: 'FAILED', failureCode: 'RATE_LIMITED' },
  ];

  beforeEach(async () => {
    database = openDatabase(':memory:');
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'owner-deepseek-test', 'not-used', '2026-08-17T05:30:00.000Z');
    currentTime = new Date('2026-08-17T05:30:00.000Z');
    receivedApiKeys.length = 0;
    outcomes.splice(
      0,
      outcomes.length,
      { status: 'SUCCEEDED' },
      { status: 'FAILED', failureCode: 'RATE_LIMITED' },
    );
    const tester: DeepSeekConnectionTester = {
      async test(receivedApiKey) {
        receivedApiKeys.push(receivedApiKey);
        return outcomes.shift() ?? { status: 'FAILED', failureCode: 'INVALID_RESPONSE' };
      },
    };
    service = createProviderCredentialService(database, new FakeSecretStore(), {
      now: () => currentTime,
      connectionTester: tester,
    });
    await service.save(ownerId, apiKey);
  });

  afterEach(() => {
    database.close();
  });

  it('persists one sanitized result per run and returns the most recent result as metadata', async () => {
    currentTime = new Date('2026-08-17T06:00:00.000Z');
    await expect(service.testConnection(ownerId)).resolves.toEqual({ status: 'SUCCEEDED' });

    currentTime = new Date('2026-08-17T07:00:00.000Z');
    await service.save(ownerId, 'replacement-key-that-must-stay-secret');
    expect(service.getMetadata(ownerId)).toEqual({
      providerKey: 'DEEPSEEK',
      state: 'CONFIGURED',
      updatedAt: '2026-08-17T07:00:00.000Z',
      lastConnectionTest: { status: 'SUCCEEDED' },
    });

    currentTime = new Date('2026-08-17T08:00:00.000Z');
    await expect(service.testConnection(ownerId)).resolves.toEqual({
      status: 'FAILED',
      failureCode: 'RATE_LIMITED',
    });
    service.remove(ownerId);

    expect(service.getMetadata(ownerId)).toEqual({
      providerKey: 'DEEPSEEK',
      state: 'NOT_CONFIGURED',
      updatedAt: null,
      lastConnectionTest: { status: 'FAILED', failureCode: 'RATE_LIMITED' },
    });
    expect(receivedApiKeys).toEqual([apiKey, apiKey]);
    expect(
      database
        .prepare(
          `select owner_id, provider_key, status, failure_code, created_at
           from provider_connection_tests order by created_at`,
        )
        .all(),
    ).toEqual([
      {
        owner_id: ownerId,
        provider_key: 'DEEPSEEK',
        status: 'SUCCEEDED',
        failure_code: null,
        created_at: '2026-08-17T06:00:00.000Z',
      },
      {
        owner_id: ownerId,
        provider_key: 'DEEPSEEK',
        status: 'FAILED',
        failure_code: 'RATE_LIMITED',
        created_at: '2026-08-17T08:00:00.000Z',
      },
    ]);
  });

  it('adds only the non-sensitive connection-result columns in migration 12', () => {
    expect(
      database.prepare('select version, name from schema_migrations where version = 12').get(),
    ).toEqual({ version: 12, name: 'add_provider_connection_tests' });
    expect(
      database
        .prepare("select name from pragma_table_info('provider_connection_tests') order by cid")
        .all(),
    ).toEqual([
      { name: 'owner_id' },
      { name: 'provider_key' },
      { name: 'status' },
      { name: 'failure_code' },
      { name: 'created_at' },
    ]);
  });
});
