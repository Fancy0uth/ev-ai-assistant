import { describe, expect, it } from 'vitest';
import type {
  AgentMessageListQuery,
  AgentSessionListQuery,
  CreateAgentSessionInput,
  Task,
  TaskVersionConflictDetails,
} from '../src/index';
import * as contracts from '../src/index';
import {
  agentCapabilityResponseSchema,
  agentMessageListQuerySchema,
  agentMessageListResponseSchema,
  agentSendMessageResponseSchema,
  agentSessionListQuerySchema,
  agentSessionListResponseSchema,
  agentSessionPathParamsSchema,
  agentSessionResponseSchema,
  apiErrorSchema,
  createAgentSessionSchema,
  createTaskSchema,
  credentialsSchema,
  dailyPlanReviewExplanationResponseSchema,
  healthResponseSchema,
  sendAgentMessageSchema,
  sessionResponseSchema,
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

describe('sessionResponseSchema', () => {
  const owner = {
    id: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c',
    username: '本地主人',
  };

  it('accepts explicit authenticated and unauthenticated session probes', () => {
    expect(
      sessionResponseSchema.safeParse({ data: { authenticated: true, owner } }).success,
    ).toBe(true);
    expect(sessionResponseSchema.safeParse({ data: { authenticated: false } }).success).toBe(true);
  });

  it('rejects an owner on an unauthenticated session probe', () => {
    expect(
      sessionResponseSchema.safeParse({ data: { authenticated: false, owner } }).success,
    ).toBe(false);
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

  it('defaults an omitted task list page size to twenty', () => {
    expect(taskListQuerySchema.parse({}).pageSize).toBe(20);
  });

  it('requires a version and at least one changed field for updates', () => {
    expect(updateTaskSchema.safeParse({ status: 'DONE' }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 1, status: 'DONE' }).success).toBe(true);
  });

  it('preserves exact target-date queries while accepting the new unambiguous filters', () => {
    expect(taskListQuerySchema.parse({ targetDate: '2026-08-10' })).toMatchObject({
      targetDate: '2026-08-10',
    });
    expect(
      taskListQuerySchema.parse({
        area: 'WORK',
        status: 'IN_PROGRESS',
        targetDate: '2026-08-10',
      }),
    ).toMatchObject({ area: 'WORK', status: 'IN_PROGRESS', targetDate: '2026-08-10' });
    expect(
      taskListQuerySchema.parse({
        area: 'STUDY',
        status: 'OPEN',
        dateScope: 'FUTURE',
        referenceDate: '2026-08-10',
      }),
    ).toMatchObject({
      area: 'STUDY',
      status: 'OPEN',
      dateScope: 'FUTURE',
      referenceDate: '2026-08-10',
    });
    expect(taskListQuerySchema.parse({ dateScope: 'UNDATED' })).toMatchObject({
      dateScope: 'UNDATED',
    });
  });

  it('rejects invalid task date-filter combinations and unknown fields', () => {
    const invalidQueries = [
      { targetDate: '2026-08-10', dateScope: 'FUTURE', referenceDate: '2026-08-10' },
      { dateScope: 'FUTURE' },
      { dateScope: 'UNDATED', referenceDate: '2026-08-10' },
      { referenceDate: '2026-08-10' },
      { dateScope: 'UNDATED', extra: 'unexpected' },
    ];

    for (const query of invalidQueries) {
      expect(taskListQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('exports strict, typed details for task version conflicts', () => {
    const currentTask: Task = {
      id: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c',
      title: '完成 Core 任务闭环',
      area: 'WORK',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      targetDate: '2026-08-10',
      completedAt: null,
      scheduling: null,
      version: 3,
      createdAt: '2026-08-10T09:00:00.000Z',
      updatedAt: '2026-08-10T10:00:00.000Z',
    };
    const response = apiErrorSchema.parse({
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Task version is stale',
        details: { currentTask },
      },
    });
    const conflictDetailsSchema = contracts.taskVersionConflictDetailsSchema;

    expect(conflictDetailsSchema).toBeDefined();
    if (!conflictDetailsSchema) return;

    const details: TaskVersionConflictDetails = conflictDetailsSchema.parse(response.error.details);
    expect(details.currentTask).toEqual(currentTask);
    expect(
      conflictDetailsSchema.safeParse({ currentTask, replacementTask: currentTask }).success,
    ).toBe(false);
    expect(conflictDetailsSchema.safeParse({}).success).toBe(false);
  });
});

describe('today snapshot contract', () => {
  it('exposes a strict, local-only summary for the current daily plan', () => {
    const parsed = todaySnapshotSchema.parse({
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
        agents: { deepSeek: 'NOT_CONFIGURED', codex: 'NOT_CONFIGURED' },
        dailyPlan: {
          status: 'PENDING_REVIEW',
          proposalId: '00000000-0000-4000-8000-000000000123',
          pendingItemCount: 2,
        },
      },
    });

    expect(parsed.data.dailyPlan).toEqual({
      status: 'PENDING_REVIEW',
      proposalId: '00000000-0000-4000-8000-000000000123',
      pendingItemCount: 2,
    });
    expect(
      todaySnapshotSchema.safeParse({
        ...parsed,
        data: {
          ...parsed.data,
          dailyPlan: {
            status: 'PENDING_REVIEW',
            proposalId: null,
            pendingItemCount: 1,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      todaySnapshotSchema.safeParse({
        ...parsed,
        data: {
          ...parsed.data,
          dailyPlan: {
            status: 'PENDING_REVIEW',
            proposalId: '00000000-0000-4000-8000-000000000123',
            pendingItemCount: 0,
          },
        },
      }).success,
    ).toBe(true);
  });

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

describe('daily plan explanation contract', () => {
  it('accepts a local-only explanation and rejects an unexpected credential field', () => {
    const payload = {
      data: {
        proposalId: '00000000-0000-4000-8000-000000000301',
        localDate: '2026-08-18',
        baseScheduleVersion: 1,
        currentScheduleVersion: 2,
        contextManifest: {
          contractVersion: 'DAILY_PLAN_V1',
          purpose: 'DAILY_PLAN_GENERATION',
          localDate: '2026-08-18',
          createdAt: '2026-08-18T01:00:00.000Z',
          sentAt: '2026-08-18T01:00:01.000Z',
          entries: [
            {
              category: 'OPEN_TIME_REQUESTS',
              fieldCategories: ['TIME_RANGE', 'DURATION_MINUTES', 'PRIORITY', 'AVAILABILITY_WINDOW'],
              entityCount: 1,
            },
          ],
        },
        items: [
          {
            itemId: '00000000-0000-4000-8000-000000000302',
            ordinal: 1,
            timeRequest: {
              id: '00000000-0000-4000-8000-000000000303',
              title: '完成本地验证',
              source: 'PROJECT_AGENT',
              durationMinutes: 60,
              priority: 'HIGH',
              earliestStartLocalTime: '10:00',
              latestEndLocalTime: '17:00',
              isFixed: false,
              version: 1,
            },
            verification: {
              status: 'SCHEDULE_VERSION_CHANGED',
              conflicts: [],
            },
          },
        ],
      },
    };

    expect(dailyPlanReviewExplanationResponseSchema.parse(payload)).toEqual(payload);
    expect(
      dailyPlanReviewExplanationResponseSchema.safeParse({
        data: { ...payload.data, apiKey: 'must-never-be-public' },
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

  it('accepts only a strict UUID session path parameter', () => {
    expect(
      agentSessionPathParamsSchema.parse({ id: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c' }),
    ).toEqual({ id: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c' });
    expect(agentSessionPathParamsSchema.safeParse({ id: 'not-a-session-id' }).success).toBe(false);
    expect(
      agentSessionPathParamsSchema.safeParse({
        id: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c',
        extra: 'unexpected',
      }).success,
    ).toBe(false);
  });

  it('accepts the provider-neutral capability response without exposing an owner', () => {
    const capability = {
      key: 'CONVERSATION',
      label: '  对话  ',
      availability: 'NOT_CONFIGURED',
      description: '  连接 API 后可以进行对话。  ',
    };

    expect(
      agentCapabilityResponseSchema.safeParse({
        data: {
          items: [capability],
        },
      }).success,
    ).toBe(true);
    expect(agentCapabilityResponseSchema.parse({ data: { items: [capability] } }).data.items).toEqual([
      capability,
    ]);
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

  it('accepts ergonomic request input types before parsing defaults and query strings', () => {
    const createSessionInput: CreateAgentSessionInput = {};
    const sessionListInput: AgentSessionListQuery = { page: '2', pageSize: '100' };
    const messageListInput: AgentMessageListQuery = {};

    expect([createSessionInput, sessionListInput, messageListInput]).toHaveLength(3);
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

  it('rejects raw oversized request values before normalizing message content and session titles', () => {
    expect(sendAgentMessageSchema.safeParse({ content: ` ${'x'.repeat(8000)}` }).success).toBe(
      false,
    );
    expect(createAgentSessionSchema.safeParse({ title: ` ${'x'.repeat(80)}` }).success).toBe(false);
    expect(sendAgentMessageSchema.parse({ content: '  安排健身任务  ' })).toEqual({
      content: '安排健身任务',
    });
    expect(createAgentSessionSchema.parse({ title: '  研究计划  ' })).toEqual({ title: '研究计划' });
  });

  it('preserves whitespace when parsing persisted session and message resources', () => {
    const persistedTitle = '  研究计划  ';
    const persistedMessageContent = '  梳理今天的学习任务  ';

    expect(
      agentSessionResponseSchema.parse({ data: { ...session, title: persistedTitle } }).data.title,
    ).toBe(persistedTitle);
    expect(
      agentMessageListResponseSchema.parse({
        data: {
          items: [{ ...userMessage, content: persistedMessageContent }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      }).data.items,
    ).toEqual([{ ...userMessage, content: persistedMessageContent }]);
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
