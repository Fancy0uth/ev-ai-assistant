import { describe, expect, it } from 'vitest';
import {
  agentCapabilityResponseSchema,
  agentMessageListQuerySchema,
  agentMessageListResponseSchema,
  agentSendMessageResponseSchema,
  agentSessionListQuerySchema,
  agentSessionListResponseSchema,
  agentSessionResponseSchema,
  createAgentSessionSchema,
  createTaskSchema,
  credentialsSchema,
  healthResponseSchema,
  sendAgentMessageSchema,
  taskListQuerySchema,
  todaySnapshotSchema,
  updateTaskSchema,
} from '../src/index';

describe('healthResponseSchema', () => {
  it('rejects a health response without a service version', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});

describe('credentialsSchema', () => {
  it('rejects passwords shorter than twelve characters', () => {
    expect(
      credentialsSchema.safeParse({ username: 'codex', password: 'too-short' }).success,
    ).toBe(false);
  });

  it('accepts Unicode letters in a local owner username', () => {
    expect(
      credentialsSchema.safeParse({
        username: '本地主人',
        password: 'correct horse battery staple',
      }).success,
    ).toBe(true);
  });
});

describe('task contracts', () => {
  it('normalizes task titles and clamps list page size', () => {
    expect(
      createTaskSchema.parse({
        title: '  完成 Core 任务闭环  ',
        area: 'WORK',
        priority: 'HIGH',
        targetDate: '2026-08-07',
      }).title,
    ).toBe('完成 Core 任务闭环');
    expect(taskListQuerySchema.parse({ pageSize: '999' }).pageSize).toBe(100);
    expect(taskListQuerySchema.parse({ pageSize: '0' }).pageSize).toBe(1);
  });

  it('requires a version and at least one changed field for updates', () => {
    expect(updateTaskSchema.safeParse({ status: 'DONE' }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 1, status: 'DONE' }).success).toBe(true);
  });
});

describe('today snapshot contract', () => {
  it('rejects a snapshot that pretends an unconfigured Agent is ready', () => {
    expect(
      todaySnapshotSchema.safeParse({
        data: {
          date: '2026-08-07',
          status: {
            score: 78,
            level: 'STEADY',
            source: 'RULES_V1',
            reasons: ['今天没有待处理任务'],
            priorities: [],
          },
          tasks: [],
          yesterday: null,
          agents: { deepSeek: 'READY', codex: 'NOT_CONFIGURED' },
        },
      }).success,
    ).toBe(false);
  });
});

describe('agent contracts', () => {
  const session = {
    id: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c',
    title: '研究计划',
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
  };
  const userMessage = {
    id: '4c9ca70a-f3cf-4c0c-ae9d-e2bb4eb3f5b3',
    sessionId: session.id,
    role: 'USER',
    content: '梳理今天的学习任务',
    createdAt: '2026-08-10T09:01:00.000Z',
  };
  const assistantMessage = {
    id: 'c502a238-10c6-4b7b-bd87-6981095ad4bd',
    sessionId: session.id,
    role: 'ASSISTANT',
    content: '先完成课程预习，再安排项目时间。',
    createdAt: '2026-08-10T09:01:01.000Z',
  };

  it('accepts the provider-neutral capability response without exposing an owner', () => {
    expect(
      agentCapabilityResponseSchema.safeParse({
        data: {
          items: [
            {
              key: 'CONVERSATION',
              label: '对话',
              availability: 'NOT_CONFIGURED',
              description: '连接 API 后可以进行对话。',
            },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      agentCapabilityResponseSchema.safeParse({
        data: { items: [], ownerId: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c' },
      }).success,
    ).toBe(false);
  });

  it('uses bounded default pagination for sessions and messages', () => {
    expect(agentSessionListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(agentMessageListQuerySchema.parse({ page: '2', pageSize: '100' })).toEqual({
      page: 2,
      pageSize: 100,
    });
    expect(agentSessionListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(agentMessageListQuerySchema.safeParse({ pageSize: '20', extra: 'nope' }).success).toBe(
      false,
    );
  });

  it('accepts strict session list and create response resources', () => {
    expect(
      agentSessionListResponseSchema.safeParse({
        data: {
          items: [session],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      }).success,
    ).toBe(true);
    expect(agentSessionResponseSchema.safeParse({ data: session }).success).toBe(true);
    expect(
      agentSessionResponseSchema.safeParse({ data: { ...session, provider: 'deepseek' } }).success,
    ).toBe(false);
  });

  it('rejects invalid session titles while defaulting an omitted creation title', () => {
    expect(createAgentSessionSchema.parse({})).toEqual({ title: '新会话' });
    expect(createAgentSessionSchema.safeParse({ title: 'x'.repeat(81) }).success).toBe(false);
    expect(createAgentSessionSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createAgentSessionSchema.safeParse({ title: '计划', extra: true }).success).toBe(false);
  });

  it('accepts a strict paginated message response with only public message fields', () => {
    expect(
      agentMessageListResponseSchema.safeParse({
        data: {
          items: [userMessage, assistantMessage],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        },
      }).success,
    ).toBe(true);
    expect(
      agentMessageListResponseSchema.safeParse({
        data: {
          items: [{ ...userMessage, ownerId: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects blank, oversized, and unknown send-message input fields', () => {
    expect(sendAgentMessageSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(sendAgentMessageSchema.safeParse({ content: 'x'.repeat(8001) }).success).toBe(false);
    expect(
      sendAgentMessageSchema.safeParse({ content: '请安排健身任务', provider: 'vendor-name' }).success,
    ).toBe(false);
  });

  it('requires both persisted user and assistant messages after a successful send', () => {
    expect(
      agentSendMessageResponseSchema.safeParse({
        data: { userMessage, assistantMessage },
      }).success,
    ).toBe(true);
    expect(
      agentSendMessageResponseSchema.safeParse({ data: { userMessage } }).success,
    ).toBe(false);
    expect(
      agentSendMessageResponseSchema.safeParse({
        data: { userMessage, assistantMessage: { ...assistantMessage, role: 'USER' } },
      }).success,
    ).toBe(false);
  });
});
