import { describe, expect, it } from 'vitest';
import {
  dailyPlanContextManifestSchema,
  dailyPlanDecisionBatchInputSchema,
  dailyPlanModelOutputSchema,
  dailyPlanProposalItemSchema,
  dailyPlanProposalListQuerySchema,
  dailyPlanProposalResponseSchema,
  dailyPlanProposalSchema,
  dailyPlanReviewListResponseSchema,
  dailyPlanReviewResponseSchema,
  dailyPlanRunSchema,
  proposalSchema,
} from '../src/index';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const thirdId = '33333333-3333-4333-8333-333333333333';
const now = '2026-08-17T00:00:00.000Z';

const contextManifest = {
  contractVersion: 'DAILY_PLAN_V1',
  purpose: 'DAILY_PLAN_GENERATION',
  localDate: '2026-08-17',
  createdAt: now,
  sentAt: null,
  entries: [
    {
      category: 'OPEN_TIME_REQUESTS',
      fieldCategories: ['DURATION_MINUTES', 'PRIORITY', 'AVAILABILITY_WINDOW'],
      entityCount: 2,
    },
  ],
};

const scheduledAction = {
  operation: 'SCHEDULE_TIME_REQUEST',
  contextRef: 'TIME_REQUEST_1',
  startLocalTime: '09:00',
  endLocalTime: '10:00',
  rationale: '将高优先级请求安排在可用时间窗口内。',
};

const unschedulableAction = {
  operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE',
  contextRef: 'TIME_REQUEST_2',
  reasonCode: 'HARD_EVENT_CONFLICT',
  rationale: '全天被固定事件占用。',
};

const modelOutput = {
  schemaVersion: 'DAILY_PLAN_MODEL_V1',
  summary: '已生成可供审阅的今日安排。',
  actions: [scheduledAction, unschedulableAction],
};

describe('daily plan contracts', () => {
  it('accepts a privacy-preserving context manifest without entity content or identifiers', () => {
    expect(dailyPlanContextManifestSchema.parse(contextManifest)).toEqual(contextManifest);
  });

  it('rejects private or unbounded manifest fields so only categories and counts leave the Core', () => {
    const invalidManifests = [
      { ...contextManifest, entries: [{ ...contextManifest.entries[0], title: '力量训练' }] },
      { ...contextManifest, entries: [{ ...contextManifest.entries[0], entityId: firstId }] },
      { ...contextManifest, entries: [{ ...contextManifest.entries[0], healthNote: '膝盖不适' }] },
      { ...contextManifest, entries: [{ ...contextManifest.entries[0], entityCount: 501 }] },
      { ...contextManifest, sentAt: 'not-an-iso-time' },
    ];

    for (const manifest of invalidManifests) {
      expect(dailyPlanContextManifestSchema.safeParse(manifest).success).toBe(false);
    }
  });

  it('accepts the two permitted model actions as strict JSON suggestions', () => {
    expect(dailyPlanModelOutputSchema.parse(modelOutput)).toEqual(modelOutput);
  });

  it('rejects malformed, expanded, duplicate, or unbounded model suggestions before they become proposals', () => {
    const invalidOutputs = [
      '```json\n{}\n```',
      { ...modelOutput, summary: '   ' },
      { ...modelOutput, extra: 'not allowed' },
      {
        ...modelOutput,
        actions: [scheduledAction, { ...unschedulableAction, contextRef: 'TIME_REQUEST_1' }],
      },
      { ...modelOutput, actions: Array.from({ length: 25 }, () => scheduledAction) },
      {
        ...modelOutput,
        actions: [{ ...scheduledAction, operation: 'CREATE_EVENT' }],
      },
    ];

    for (const output of invalidOutputs) {
      expect(dailyPlanModelOutputSchema.safeParse(output).success).toBe(false);
    }
  });

  it('enforces time and reason exclusivity for the two model operations', () => {
    const invalidActions = [
      { ...scheduledAction, endLocalTime: '09:00' },
      { ...scheduledAction, reasonCode: 'HARD_EVENT_CONFLICT' },
      { ...unschedulableAction, startLocalTime: '10:00', endLocalTime: '11:00' },
      { ...unschedulableAction, reasonCode: 'NOT_A_REASON' },
    ];

    for (const action of invalidActions) {
      expect(
        dailyPlanModelOutputSchema.safeParse({
          ...modelOutput,
          actions: [action],
        }).success,
      ).toBe(false);
    }
  });

  it('enforces local proposal item time and reason consistency with versioned Time Requests', () => {
    const scheduledItem = {
      id: firstId,
      ordinal: 1,
      status: 'PENDING_REVIEW',
      operation: 'SCHEDULE_TIME_REQUEST',
      timeRequestId: secondId,
      timeRequestVersion: 3,
      startLocalTime: '09:00',
      endLocalTime: '10:00',
      reasonCode: null,
      rationale: '优先完成课程预习。',
    };
    const unschedulableItem = {
      ...scheduledItem,
      id: thirdId,
      ordinal: 2,
      operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE',
      startLocalTime: null,
      endLocalTime: null,
      reasonCode: 'CAPACITY_LIMIT',
    };

    expect(dailyPlanProposalItemSchema.parse(scheduledItem)).toEqual(scheduledItem);
    expect(dailyPlanProposalItemSchema.parse(unschedulableItem)).toEqual(unschedulableItem);

    for (const item of [
      { ...scheduledItem, timeRequestVersion: 0 },
      { ...scheduledItem, reasonCode: 'CAPACITY_LIMIT' },
      { ...unschedulableItem, startLocalTime: '11:00', endLocalTime: '12:00' },
      { ...unschedulableItem, reasonCode: null },
    ]) {
      expect(dailyPlanProposalItemSchema.safeParse(item).success).toBe(false);
    }
  });

  it('keeps proposal persistence review-only and versioned without executable proposal changes', () => {
    const scheduledItem = {
      id: thirdId,
      ordinal: 1,
      status: 'PENDING_REVIEW',
      operation: 'SCHEDULE_TIME_REQUEST',
      timeRequestId: secondId,
      timeRequestVersion: 4,
      startLocalTime: '09:00',
      endLocalTime: '10:00',
      reasonCode: null,
      rationale: '优先完成课程预习。',
    };
    const proposal = {
      id: firstId,
      contractVersion: 'DAILY_PLAN_V1',
      runId: secondId,
      localDate: '2026-08-17',
      status: 'PENDING_REVIEW',
      baseScheduleVersion: 4,
      summary: '已生成待审阅安排。',
      items: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    expect(dailyPlanProposalSchema.parse(proposal)).toEqual(proposal);
    expect(
      dailyPlanProposalSchema.safeParse({
        ...proposal,
        items: [{ ...scheduledItem, status: 'APPLIED' }],
      }).success,
    ).toBe(false);
    expect(dailyPlanProposalSchema.safeParse({ ...proposal, changes: [] }).success).toBe(false);
    expect(dailyPlanProposalSchema.safeParse({ ...proposal, baseScheduleVersion: 0 }).success).toBe(
      false,
    );
  });

  it('allows proposal linkage only for succeeded runs and requires a classified failed run', () => {
    const succeededRun = {
      id: firstId,
      contractVersion: 'DAILY_PLAN_V1',
      localDate: '2026-08-17',
      trigger: 'MANUAL',
      status: 'SUCCEEDED',
      contextManifest,
      proposalId: secondId,
      failureCode: null,
      createdAt: now,
      completedAt: now,
    };
    const failedRun = {
      ...succeededRun,
      id: thirdId,
      status: 'FAILED',
      proposalId: null,
      failureCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
    };

    expect(dailyPlanRunSchema.parse(succeededRun)).toEqual(succeededRun);
    expect(dailyPlanRunSchema.parse(failedRun)).toEqual(failedRun);

    for (const run of [
      { ...succeededRun, proposalId: null },
      { ...succeededRun, failureCode: 'DAILY_PLAN_MODEL_OUTPUT_INVALID' },
      { ...failedRun, proposalId: secondId },
      { ...failedRun, failureCode: null },
      { ...succeededRun, completedAt: null },
      { ...failedRun, completedAt: null },
      { ...succeededRun, completedAt: '2026-08-16T23:59:59.999Z' },
      { ...succeededRun, status: 'GENERATING', proposalId: null, completedAt: now },
    ]) {
      expect(dailyPlanRunSchema.safeParse(run).success).toBe(false);
    }

    const inProgressRun = {
      ...succeededRun,
      status: 'GENERATING',
      proposalId: null,
      completedAt: null,
    };

    expect(dailyPlanRunSchema.parse(inProgressRun)).toEqual(inProgressRun);
  });

  it('leaves the existing executable proposal contract unchanged', () => {
    const legacyProposal = {
      id: firstId,
      kind: 'SCHEDULE',
      status: 'PENDING',
      source: 'DAILY_SCHEDULER',
      title: '原有可执行日程提案',
      changes: [
        {
          operation: 'CREATE_EVENT',
          event: {
            id: secondId,
            calendarRuleId: null,
            title: '固定课程',
            kind: 'COURSE',
            localDate: '2026-08-17',
            startLocalTime: '09:00',
            endLocalTime: '10:00',
            isHard: true,
            status: 'CONFIRMED',
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
      version: 1,
      createdAt: now,
      expiresAt: null,
    };

    expect(proposalSchema.parse(legacyProposal)).toEqual(legacyProposal);
  });

  it('accepts unedited and edited APPLY decisions, unschedulable APPLY decisions, and concise rejections', () => {
    const validDecisionBatches = [
      {
        expectedProposalVersion: 1,
        decisions: [{ itemId: firstId, decision: 'APPLY' }],
      },
      {
        expectedProposalVersion: 1,
        decisions: [
          {
            itemId: firstId,
            decision: 'APPLY',
            startLocalTime: '10:00',
            endLocalTime: '11:00',
          },
        ],
      },
      {
        expectedProposalVersion: 1,
        decisions: [{ itemId: secondId, decision: 'APPLY' }],
      },
      {
        expectedProposalVersion: 1,
        decisions: [{ itemId: thirdId, decision: 'REJECT', reason: '今天不安排这项任务。' }],
      },
    ];

    for (const batch of validDecisionBatches) {
      expect(dailyPlanDecisionBatchInputSchema.parse(batch)).toEqual(batch);
    }

    expect(
      dailyPlanDecisionBatchInputSchema.parse({
        expectedProposalVersion: 1,
        decisions: [{ itemId: thirdId, decision: 'REJECT', reason: '  今天不安排这项任务。  ' }],
      }).decisions[0],
    ).toEqual({ itemId: thirdId, decision: 'REJECT', reason: '今天不安排这项任务。' });
  });

  it('rejects duplicate, incomplete, expanded, or empty daily-plan decision batches', () => {
    const invalidDecisionBatches = [
      {
        expectedProposalVersion: 1,
        decisions: [
          { itemId: firstId, decision: 'APPLY' },
          { itemId: firstId, decision: 'REJECT' },
        ],
      },
      {
        expectedProposalVersion: 1,
        decisions: [{ itemId: firstId, decision: 'APPLY', startLocalTime: '10:00' }],
      },
      {
        expectedProposalVersion: 1,
        decisions: [
          {
            itemId: firstId,
            decision: 'REJECT',
            startLocalTime: '10:00',
            endLocalTime: '11:00',
          },
        ],
      },
      { expectedProposalVersion: 1, decisions: [] },
      { expectedProposalVersion: 1, decisions: [{ itemId: firstId, decision: 'APPLY', extra: true }] },
      {
        expectedProposalVersion: 1,
        decisions: [{ itemId: firstId, decision: 'REJECT', reason: ' '.repeat(241) }],
      },
    ];

    for (const batch of invalidDecisionBatches) {
      expect(dailyPlanDecisionBatchInputSchema.safeParse(batch).success).toBe(false);
    }
  });

  it('rejects equal and reverse APPLY time overrides', () => {
    const results = [
      { startLocalTime: '10:00', endLocalTime: '10:00' },
      { startLocalTime: '11:00', endLocalTime: '10:00' },
    ].map((timeOverride) =>
      dailyPlanDecisionBatchInputSchema.safeParse({
        expectedProposalVersion: 1,
        decisions: [{ itemId: firstId, decision: 'APPLY', ...timeOverride }],
      }).success,
    );

    expect(results).toEqual([false, false]);
  });

  it('uses bounded date-filtered pages for daily-plan reviews', () => {
    expect(dailyPlanProposalListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(dailyPlanProposalListQuerySchema.parse({ localDate: '2026-08-17', page: '2' })).toEqual({
      localDate: '2026-08-17',
      page: 2,
      pageSize: 20,
    });

    for (const query of [
      { localDate: '2026-08-35' },
      { localDate: '2026/08/17' },
      { page: '0' },
      { pageSize: '101' },
      { extra: 'not allowed' },
    ]) {
      expect(dailyPlanProposalListQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('returns strict, stably ordered paginated daily-plan reviews without changing generation responses', () => {
    const scheduledItem = {
      id: thirdId,
      ordinal: 1,
      status: 'PENDING_REVIEW',
      operation: 'SCHEDULE_TIME_REQUEST',
      timeRequestId: secondId,
      timeRequestVersion: 1,
      startLocalTime: '09:00',
      endLocalTime: '10:00',
      reasonCode: null,
      rationale: '优先完成课程预习。',
    };
    const latestReview = {
      proposal: {
        id: firstId,
        contractVersion: 'DAILY_PLAN_V1',
        runId: secondId,
        localDate: '2026-08-17',
        status: 'PENDING_REVIEW',
        baseScheduleVersion: 1,
        summary: '已生成待审阅安排。',
        items: [scheduledItem],
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      decisions: [{ itemId: thirdId, decision: 'APPLY' }],
    };
    const earlierReview = {
      proposal: {
        ...latestReview.proposal,
        id: thirdId,
        runId: thirdId,
        updatedAt: '2026-08-16T00:00:00.000Z',
      },
      decisions: [],
    };
    const sameTimeLaterIdReview = {
      proposal: {
        ...latestReview.proposal,
        id: secondId,
        runId: thirdId,
      },
      decisions: [],
    };
    const listResponse = {
      data: {
        items: [latestReview, sameTimeLaterIdReview, earlierReview],
        pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
      },
    };

    expect(dailyPlanReviewResponseSchema.parse({ data: latestReview })).toEqual({ data: latestReview });
    expect(dailyPlanReviewListResponseSchema.parse(listResponse)).toEqual(listResponse);
    expect(
      dailyPlanReviewListResponseSchema.safeParse({
        ...listResponse,
        data: { ...listResponse.data, items: [earlierReview, latestReview, sameTimeLaterIdReview] },
      }).success,
    ).toBe(false);
    expect(
      dailyPlanReviewListResponseSchema.safeParse({
        ...listResponse,
        data: { ...listResponse.data, items: [sameTimeLaterIdReview, latestReview, earlierReview] },
      }).success,
    ).toBe(false);
    expect(dailyPlanReviewResponseSchema.safeParse({ data: { ...latestReview, extra: true } }).success).toBe(
      false,
    );
  });

  it('keeps pending reviews empty while rejecting duplicate or unbounded response decisions', () => {
    const pendingReview = {
      proposal: {
        id: firstId,
        contractVersion: 'DAILY_PLAN_V1',
        runId: secondId,
        localDate: '2026-08-17',
        status: 'PENDING_REVIEW',
        baseScheduleVersion: 1,
        summary: '等待用户审阅。',
        items: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      decisions: [],
    };
    const decisions = Array.from({ length: 25 }, (_, index) => ({
      itemId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      decision: 'APPLY' as const,
    }));

    expect(dailyPlanReviewResponseSchema.parse({ data: pendingReview })).toEqual({ data: pendingReview });
    expect([
      dailyPlanReviewResponseSchema.safeParse({
        data: {
          ...pendingReview,
          decisions: [
            { itemId: thirdId, decision: 'APPLY' },
            { itemId: thirdId, decision: 'REJECT' },
          ],
        },
      }).success,
      dailyPlanReviewResponseSchema.safeParse({
        data: { ...pendingReview, decisions },
      }).success,
    ]).toEqual([false, false]);
  });

  it('keeps the exact daily-plan generation response contract parseable', () => {
    const generationResponse = {
      data: {
        id: firstId,
        contractVersion: 'DAILY_PLAN_V1',
        runId: secondId,
        localDate: '2026-08-17',
        status: 'PENDING_REVIEW',
        baseScheduleVersion: 1,
        summary: '已生成待审阅安排。',
        items: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    };

    expect(dailyPlanProposalResponseSchema.parse(generationResponse)).toEqual(generationResponse);
  });
});
