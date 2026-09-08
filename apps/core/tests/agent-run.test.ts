import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { DomainAgentProvider } from '../src/modules/agents/provider';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('provider-neutral Agent Runs', () => {
  let app: FastifyInstance | undefined;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-agent-run-'));
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function setup(provider?: DomainAgentProvider): Promise<string> {
    app = await buildApp({
      databasePath: join(directory, 'app.sqlite'),
      logger: false,
      ...(provider ? { domainAgentProvider: provider } : {}),
    });
    const response = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    return readSessionToken(response.headers['set-cookie']);
  }

  it('shows non-secret provider state and persists a BLOCKED run without fake output', async () => {
    const token = await setup();
    const providers = await app!.inject({ method: 'GET', url: '/v1/providers', cookies: { ev_session: token } });
    expect(providers.statusCode).toBe(200);
    expect(providers.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'DEEPSEEK', availability: 'NOT_CONFIGURED' }),
        expect.objectContaining({ key: 'CODEX_LOCAL', availability: 'NOT_CONFIGURED' }),
      ]),
    );

    const blocked = await app!.inject({
      method: 'POST',
      url: '/v1/agent-runs',
      cookies: { ev_session: token },
      payload: {
        providerKey: 'DEEPSEEK',
        capability: 'LIFE_PLANNING',
        context: { domains: ['SCHEDULE'], entityIds: [] },
      },
    });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error).toMatchObject({ code: 'AGENT_PROVIDER_NOT_CONFIGURED' });
    expect(JSON.stringify(blocked.json())).not.toMatch(/summary|output|ownerId|token|password/i);

    const runs = await app!.inject({ method: 'GET', url: '/v1/agent-runs', cookies: { ev_session: token } });
    expect(runs.statusCode).toBe(200);
    expect(runs.json().data).toEqual([
      expect.objectContaining({ status: 'BLOCKED', output: null, failureCode: 'PROVIDER_NOT_CONFIGURED' }),
    ]);
  });

  it('accepts only a typed Provider result and persists its context manifest', async () => {
    const provider: DomainAgentProvider = {
      key: 'DEEPSEEK',
      async run(input) {
        return {
          summary: `已读取 ${input.context.domains.join('、')} 上下文`,
          suggestedActions: ['确认今天的学习时间块'],
        };
      },
    };
    const token = await setup(provider);
    const completed = await app!.inject({
      method: 'POST',
      url: '/v1/agent-runs',
      cookies: { ev_session: token },
      payload: {
        providerKey: 'DEEPSEEK',
        capability: 'LIFE_PLANNING',
        context: { domains: ['SCHEDULE', 'FITNESS'], entityIds: [] },
      },
    });

    expect(completed.statusCode).toBe(201);
    expect(completed.json().data).toMatchObject({
      status: 'SUCCEEDED',
      context: { domains: ['SCHEDULE', 'FITNESS'] },
      output: { suggestedActions: ['确认今天的学习时间块'] },
    });
  });

  it('routes ready DeepSeek and local Codex providers independently', async () => {
    const deepSeek: DomainAgentProvider = {
      key: 'DEEPSEEK',
      async run() { return { summary: '生活任务已分析', suggestedActions: ['安排早餐'] }; },
    };
    const localCodex: DomainAgentProvider = {
      key: 'CODEX_LOCAL',
      async run() { return { summary: '项目快照已分析', suggestedActions: ['阅读 PRD'] }; },
    };
    app = await buildApp({
      databasePath: join(directory, 'app.sqlite'),
      logger: false,
      domainAgentProviders: { DEEPSEEK: deepSeek, CODEX_LOCAL: localCodex },
    });
    const setupResponse = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setupResponse.headers['set-cookie']);

    const profiles = await app.inject({ method: 'GET', url: '/v1/providers', cookies: { ev_session: token } });
    expect(profiles.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'DEEPSEEK', availability: 'READY' }),
      expect.objectContaining({ key: 'CODEX_LOCAL', availability: 'READY' }),
    ]));

    const run = await app.inject({
      method: 'POST', url: '/v1/agent-runs', cookies: { ev_session: token },
      payload: { providerKey: 'CODEX_LOCAL', capability: 'PROJECT_ANALYSIS', context: { domains: ['PROJECT'], entityIds: [] } },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().data.output).toMatchObject({ summary: '项目快照已分析' });
  });
});
