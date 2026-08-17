import { describe, expect, it } from 'vitest';
import {
  dailyPlanContextManifestSchema,
  dailyPlanModelOutputSchema,
  dailyPlanProposalItemSchema,
  dailyPlanProposalSchema,
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
});
