import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentCapabilityResponseSchema,
  agentMessageListResponseSchema,
  agentSendMessageResponseSchema,
  agentSessionListResponseSchema,
  agentSessionResponseSchema,
  apiErrorSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { AgentProvider } from '../src/modules/agent/provider';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};

const missingSessionId = '00000000-0000-4000-8000-000000000001';
const foreignSessionId = '00000000-0000-4000-8000-000000000002';

class FakeAgentProvider implements AgentProvider {
  calls = 0;

  constructor(private readonly reply: string) {}

  async generate(): Promise<string> {
    this.calls += 1;
    return this.reply;
  }
}

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('authenticated agent conversation API', () => {
  let app: FastifyInstance | undefined;
  let databasePath: string;
  let testDirectory: string;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-agent-api-'));
    databasePath = join(testDirectory, 'app.sqlite');
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    rmSync(testDirectory, { recursive: true, force: true });
  });

  async function createAuthenticatedApp(agentProvider?: AgentProvider): Promise<string> {
    app = await buildApp({
      databasePath,
      logger: false,
      ...(agentProvider ? { agentProvider } : {}),
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    expect(setup.statusCode).toBe(201);
    return readSessionToken(setup.headers['set-cookie']);
  }

  function createForeignSession(): void {
    const database = openDatabase(databasePath);
    database.pragma('foreign_keys = OFF');
    database
      .prepare(
        `insert into agent_sessions (id, owner_id, title, created_at, updated_at)
         values (?, ?, ?, ?, ?)`,
      )
      .run(
        foreignSessionId,
        '00000000-0000-4000-8000-000000000099',
        'Foreign session',
        '2026-08-10T00:00:00.000Z',
        '2026-08-10T00:00:00.000Z',
      );
    database.close();
  }

  it('requires authentication for every Agent route', async () => {
    app = await buildApp({ databasePath, logger: false });
    const requests = [
      { method: 'GET', url: '/v1/agent/capabilities' },
      { method: 'GET', url: '/v1/agent/sessions' },
      { method: 'POST', url: '/v1/agent/sessions', payload: {} },
      { method: 'GET', url: `/v1/agent/sessions/${missingSessionId}/messages` },
      {
        method: 'POST',
        url: `/v1/agent/sessions/${missingSessionId}/messages`,
        payload: { content: '请安排今天的任务' },
      },
    ] as const;

    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('does not expose Agent GET resources through authenticated HEAD requests', async () => {
    const token = await createAuthenticatedApp();
    const created = await app!.inject({
      method: 'POST',
      url: '/v1/agent/sessions',
      cookies: { ev_session: token },
      payload: { title: 'HEAD protection' },
    });
    const session = agentSessionResponseSchema.parse(created.json()).data;
    const urls = [
      '/v1/agent/capabilities',
      '/v1/agent/sessions',
      `/v1/agent/sessions/${session.id}/messages`,
    ];

    for (const url of urls) {
      const response = await app!.inject({
        method: 'HEAD',
        url,
        cookies: { ev_session: token },
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('authenticates malformed Agent POSTs before JSON parsing', async () => {
    app = await buildApp({ databasePath, logger: false });
    const requests = [
      { url: '/v1/agent/sessions' },
      { url: `/v1/agent/sessions/${missingSessionId}/messages` },
    ];

    for (const request of requests) {
      const response = await app.inject({
        method: 'POST',
        url: request.url,
        headers: { 'content-type': 'application/json' },
        payload: '{"content":',
      });
      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('reports provider-neutral conversation capability without invoking an injected provider', async () => {
    const provider = new FakeAgentProvider('This reply must not be generated');
    const token = await createAuthenticatedApp(provider);

    const response = await app!.inject({
      method: 'GET',
      url: '/v1/agent/capabilities',
      cookies: { ev_session: token },
    });

    expect(response.statusCode).toBe(200);
    const capability = agentCapabilityResponseSchema.parse(response.json()).data.items;
    expect(capability).toHaveLength(1);
    expect(capability[0]).toMatchObject({ key: 'CONVERSATION', availability: 'READY' });
    expect(Object.keys(capability[0]!).sort()).toEqual([
      'availability',
      'description',
      'key',
      'label',
    ]);
    expect(provider.calls).toBe(0);
  });

  it('creates owner session resources with the shared title default and paginates them', async () => {
    const token = await createAuthenticatedApp();

    const first = await app!.inject({
      method: 'POST',
      url: '/v1/agent/sessions',
      cookies: { ev_session: token },
      payload: {},
    });
    expect(first.statusCode).toBe(201);
    expect(agentSessionResponseSchema.parse(first.json()).data.title).toBe('新会话');

    const second = await app!.inject({
      method: 'POST',
      url: '/v1/agent/sessions',
      cookies: { ev_session: token },
      payload: { title: '学习计划' },
    });
    expect(second.statusCode).toBe(201);

    const defaultPage = await app!.inject({
      method: 'GET',
      url: '/v1/agent/sessions',
      cookies: { ev_session: token },
    });
    expect(defaultPage.statusCode).toBe(200);
    expect(agentSessionListResponseSchema.parse(defaultPage.json()).data.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
    });

    const secondPage = await app!.inject({
      method: 'GET',
      url: '/v1/agent/sessions?page=2&pageSize=1',
      cookies: { ev_session: token },
    });
    const parsedSecondPage = agentSessionListResponseSchema.parse(secondPage.json()).data;
    expect(parsedSecondPage.pagination).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
    expect(parsedSecondPage.items).toHaveLength(1);
    expect(parsedSecondPage.items[0]).not.toHaveProperty('ownerId');
  });

  it('returns validation errors for invalid Agent query, body, and path inputs', async () => {
    const token = await createAuthenticatedApp();
    const invalidRequests = [
      {
        method: 'GET',
        url: '/v1/agent/sessions?pageSize=101',
      },
      {
        method: 'POST',
        url: '/v1/agent/sessions',
        payload: { title: '   ' },
      },
      {
        method: 'GET',
        url: '/v1/agent/sessions/not-a-session-id/messages',
      },
      {
        method: 'POST',
        url: `/v1/agent/sessions/${missingSessionId}/messages`,
        payload: { content: '   ' },
      },
    ] as const;

    for (const request of invalidRequests) {
      const response = await app!.inject({ ...request, cookies: { ev_session: token } });
      expect(response.statusCode).toBe(422);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('hides missing and foreign owner sessions behind the same not-found response', async () => {
    const token = await createAuthenticatedApp();
    createForeignSession();
    const requests = [
      { method: 'GET', url: `/v1/agent/sessions/${missingSessionId}/messages` },
      {
        method: 'POST',
        url: `/v1/agent/sessions/${missingSessionId}/messages`,
        payload: { content: 'Does this exist?' },
      },
      { method: 'GET', url: `/v1/agent/sessions/${foreignSessionId}/messages` },
      {
        method: 'POST',
        url: `/v1/agent/sessions/${foreignSessionId}/messages`,
        payload: { content: 'Can another owner read this?' },
      },
    ] as const;

    for (const request of requests) {
      const response = await app!.inject({ ...request, cookies: { ev_session: token } });
      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('AGENT_SESSION_NOT_FOUND');
    }
  });

  it('does not persist a user message when the provider is not configured', async () => {
    const token = await createAuthenticatedApp();
    const capabilities = await app!.inject({
      method: 'GET',
      url: '/v1/agent/capabilities',
      cookies: { ev_session: token },
    });
    expect(agentCapabilityResponseSchema.parse(capabilities.json()).data.items).toMatchObject([
      { key: 'CONVERSATION', availability: 'NOT_CONFIGURED' },
    ]);

    const created = await app!.inject({
      method: 'POST',
      url: '/v1/agent/sessions',
      cookies: { ev_session: token },
      payload: { title: 'No provider' },
    });
    const session = agentSessionResponseSchema.parse(created.json()).data;

    const sent = await app!.inject({
      method: 'POST',
      url: `/v1/agent/sessions/${session.id}/messages`,
      cookies: { ev_session: token },
      payload: { content: '不要伪造回复' },
    });
    expect(sent.statusCode).toBe(503);
    expect(apiErrorSchema.parse(sent.json()).error.code).toBe('AGENT_PROVIDER_NOT_CONFIGURED');

    const messages = await app!.inject({
      method: 'GET',
      url: `/v1/agent/sessions/${session.id}/messages`,
      cookies: { ev_session: token },
    });
    expect(agentMessageListResponseSchema.parse(messages.json()).data).toEqual({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it('persists and returns the server-generated user and assistant message pair', async () => {
    const provider = new FakeAgentProvider('先完成课程预习，再安排项目时间。');
    const token = await createAuthenticatedApp(provider);
    const created = await app!.inject({
      method: 'POST',
      url: '/v1/agent/sessions',
      cookies: { ev_session: token },
      payload: { title: '学习安排' },
    });
    const session = agentSessionResponseSchema.parse(created.json()).data;

    const sent = await app!.inject({
      method: 'POST',
      url: `/v1/agent/sessions/${session.id}/messages`,
      cookies: { ev_session: token },
      payload: { content: '梳理今天的学习任务' },
    });
    expect(sent.statusCode).toBe(201);
    const pair = agentSendMessageResponseSchema.parse(sent.json()).data;
    expect(pair).toMatchObject({
      userMessage: {
        sessionId: session.id,
        role: 'USER',
        content: '梳理今天的学习任务',
      },
      assistantMessage: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: '先完成课程预习，再安排项目时间。',
      },
    });
    expect(pair.userMessage).not.toHaveProperty('ownerId');
    expect(pair.assistantMessage).not.toHaveProperty('ownerId');

    const messages = await app!.inject({
      method: 'GET',
      url: `/v1/agent/sessions/${session.id}/messages`,
      cookies: { ev_session: token },
    });
    const listed = agentMessageListResponseSchema.parse(messages.json()).data;
    expect(listed.items.map(({ role, content }) => [role, content])).toEqual([
      ['USER', '梳理今天的学习任务'],
      ['ASSISTANT', '先完成课程预习，再安排项目时间。'],
    ]);
    expect(listed.items.every((message) => !Object.hasOwn(message, 'ownerId'))).toBe(true);
  });

  it('does not expose a legacy generate alias', async () => {
    app = await buildApp({ databasePath, logger: false });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/generate',
      payload: { content: 'No alias' },
    });

    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });
});
