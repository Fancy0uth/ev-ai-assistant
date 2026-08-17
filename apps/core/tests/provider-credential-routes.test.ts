import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  apiErrorSchema,
  deepSeekCredentialStatusResponseSchema,
  type DeepSeekConnectionTestResult,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { DeepSeekConnectionTester } from '../src/modules/providers/deepseek-connection';
import { SecretStoreUnavailableError, type SecretStorePort } from '../src/modules/providers/secret-store';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};
const testApiKey = 'test-only-deepseek-key';
const opaqueStoredToken = 'opaque-test-token';

class FakeSecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();

  async protect(plaintext: string): Promise<string> {
    this.values.set(opaqueStoredToken, plaintext);
    return opaqueStoredToken;
  }

  async unprotect(protectedValue: string): Promise<string> {
    const plaintext = this.values.get(protectedValue);
    if (plaintext === undefined) throw new SecretStoreUnavailableError();
    return plaintext;
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

class FakeDeepSeekConnectionTester implements DeepSeekConnectionTester {
  constructor(private readonly results: DeepSeekConnectionTestResult[]) {}

  async test(): Promise<DeepSeekConnectionTestResult> {
    const result = this.results.shift();
    if (!result) throw new Error('No fake connection result was configured');
    return result;
  }
}

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('DeepSeek provider credential routes', () => {
  let app: FastifyInstance | undefined;
  let databasePath: string;
  let testDirectory: string;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-provider-credential-routes-'));
    databasePath = join(testDirectory, 'app.sqlite');
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    rmSync(testDirectory, { recursive: true, force: true });
  });

  async function createAuthenticatedApp(
    secretStore: SecretStorePort = new FakeSecretStore(),
    deepSeekConnectionTester: DeepSeekConnectionTester = new FakeDeepSeekConnectionTester([
      { status: 'SUCCEEDED' },
      { status: 'FAILED', failureCode: 'RATE_LIMITED' },
    ]),
  ): Promise<string> {
    app = await buildApp({
      databasePath,
      logger: false,
      secretStore,
      deepSeekConnectionTester,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    expect(setup.statusCode).toBe(201);
    return readSessionToken(setup.headers['set-cookie']);
  }

  it('requires authentication for every credential route', async () => {
    app = await buildApp({
      databasePath,
      logger: false,
      secretStore: new FakeSecretStore(),
      deepSeekConnectionTester: new FakeDeepSeekConnectionTester([]),
    });
    const requests = [
      { method: 'GET', url: '/v1/providers/deepseek/credential' },
      { method: 'PUT', url: '/v1/providers/deepseek/credential', payload: { apiKey: testApiKey } },
      {
        method: 'DELETE',
        url: '/v1/providers/deepseek/credential',
        payload: { confirmation: 'DELETE' },
      },
      { method: 'POST', url: '/v1/providers/deepseek/connection-test' },
    ] as const;

    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('returns non-sensitive not-configured metadata to the authenticated owner', async () => {
    const token = await createAuthenticatedApp();

    const response = await app!.inject({
      method: 'GET',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
    });

    expect(response.statusCode).toBe(200);
    expect(deepSeekCredentialStatusResponseSchema.parse(response.json())).toEqual({
      data: {
        providerKey: 'DEEPSEEK',
        state: 'NOT_CONFIGURED',
        updatedAt: null,
        lastConnectionTest: null,
      },
    });
  });

  it('rejects missing, extra, and invalid credential mutation bodies', async () => {
    const token = await createAuthenticatedApp();
    const requests = [
      { method: 'PUT', url: '/v1/providers/deepseek/credential', payload: {} },
      {
        method: 'PUT',
        url: '/v1/providers/deepseek/credential',
        payload: { apiKey: testApiKey, encryptedApiKey: 'ciphertext' },
      },
      { method: 'DELETE', url: '/v1/providers/deepseek/credential', payload: {} },
      {
        method: 'DELETE',
        url: '/v1/providers/deepseek/credential',
        payload: { confirmation: 'delete' },
      },
      {
        method: 'DELETE',
        url: '/v1/providers/deepseek/credential',
        payload: { confirmation: 'DELETE', suffix: 'last-four' },
      },
    ] as const;

    for (const request of requests) {
      const response = await app!.inject({ ...request, cookies: { ev_session: token } });
      expect(response.statusCode).toBe(422);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('persists only metadata for credential saves and classified connection tests', async () => {
    const token = await createAuthenticatedApp();
    const responses: string[] = [];

    const saved = await app!.inject({
      method: 'PUT',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
      payload: { apiKey: testApiKey },
    });
    responses.push(saved.body);
    expect(saved.statusCode).toBe(200);
    expect(deepSeekCredentialStatusResponseSchema.parse(saved.json()).data).toMatchObject({
      providerKey: 'DEEPSEEK',
      state: 'CONFIGURED',
      lastConnectionTest: null,
    });

    const succeeded = await app!.inject({
      method: 'POST',
      url: '/v1/providers/deepseek/connection-test',
      cookies: { ev_session: token },
    });
    responses.push(succeeded.body);
    expect(succeeded.statusCode).toBe(200);
    expect(deepSeekCredentialStatusResponseSchema.parse(succeeded.json()).data.lastConnectionTest).toEqual({
      status: 'SUCCEEDED',
    });

    const rateLimited = await app!.inject({
      method: 'POST',
      url: '/v1/providers/deepseek/connection-test',
      cookies: { ev_session: token },
    });
    responses.push(rateLimited.body);
    expect(rateLimited.statusCode).toBe(200);
    expect(deepSeekCredentialStatusResponseSchema.parse(rateLimited.json()).data.lastConnectionTest).toEqual({
      status: 'FAILED',
      failureCode: 'RATE_LIMITED',
    });

    for (const response of responses) {
      expect(response).not.toContain(testApiKey);
      expect(response).not.toContain(opaqueStoredToken);
      expect(response).not.toContain('ciphertext');
      expect(response).not.toContain('suffix');
    }
  });

  it('requires an exact delete confirmation and returns not-configured metadata', async () => {
    const token = await createAuthenticatedApp();
    const saved = await app!.inject({
      method: 'PUT',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
      payload: { apiKey: testApiKey },
    });
    expect(saved.statusCode).toBe(200);

    const deleted = await app!.inject({
      method: 'DELETE',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
      payload: { confirmation: 'DELETE' },
    });

    expect(deleted.statusCode).toBe(200);
    expect(deepSeekCredentialStatusResponseSchema.parse(deleted.json()).data.state).toBe(
      'NOT_CONFIGURED',
    );
    expect(deleted.body).not.toContain(testApiKey);
    expect(deleted.body).not.toContain(opaqueStoredToken);
  });

  it('rejects connection tests without a configured credential', async () => {
    const token = await createAuthenticatedApp();

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/providers/deepseek/connection-test',
      cookies: { ev_session: token },
    });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('CREDENTIAL_NOT_CONFIGURED');
  });

  it('returns a safe unavailable error when secret storage cannot save a credential', async () => {
    const token = await createAuthenticatedApp(new UnavailableSecretStore());

    const response = await app!.inject({
      method: 'PUT',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
      payload: { apiKey: testApiKey },
    });

    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('SECRET_STORE_UNAVAILABLE');
    expect(response.body).not.toContain(testApiKey);
  });
});
