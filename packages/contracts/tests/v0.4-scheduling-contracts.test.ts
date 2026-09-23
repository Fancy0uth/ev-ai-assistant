import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as z from 'zod';
import * as contracts from '../src/index';
import type { CreateTaskInput, NormalizedTask, Task, TaskSchedulingInput } from '../src/index';

const id = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const now = '2026-08-23T00:00:00.000Z';

const task = {
  id,
  title: 'Prepare architecture review',
  area: 'WORK' as const,
  priority: 'HIGH' as const,
  status: 'OPEN' as const,
  targetDate: '2026-08-24',
  completedAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
};

const scheduling = {
  durationMinutes: 45,
  earliestStartLocalTime: '09:00',
  latestEndLocalTime: '11:00',
  isFixed: false,
};

const legacyTimeRequest = {
  id,
  source: 'PROJECT_AGENT' as const,
  title: 'Prepare architecture review',
  targetDate: '2026-08-24',
  durationMinutes: 45,
  priority: 'HIGH' as const,
  earliestStartLocalTime: '09:00',
  latestEndLocalTime: '11:00',
  isFixed: false,
  version: 1,
  createdAt: now,
  updatedAt: now,
};

type Parser = {
  parse(input: unknown): unknown;
  safeParse(input: unknown): { success: boolean };
};

const v04Contracts = contracts as typeof contracts & Record<string, Parser>;

describe('v0.4 scheduling contracts', () => {
  it('normalizes a legacy Task payload to null scheduling without weakening strictness', () => {
    expect(contracts.taskSchema.parse(task)).toEqual({ ...task, scheduling: null });
    expect(contracts.taskSchema.safeParse({ ...task, ownerId: id }).success).toBe(false);
  });

  it('keeps Task create and update scheduling optional while accepting explicit cancellation', () => {
    expect(
      contracts.createTaskSchema.parse({
        title: task.title,
        area: task.area,
        priority: task.priority,
      }),
    ).toEqual({
      title: task.title,
      area: task.area,
      priority: task.priority,
      scheduling: null,
    });
    expect(
      contracts.createTaskSchema.safeParse({
        title: task.title,
        area: task.area,
        priority: task.priority,
        targetDate: task.targetDate,
        scheduling,
      }).success,
    ).toBe(true);
    expect(
      contracts.createTaskSchema.safeParse({
        title: task.title,
        area: task.area,
        priority: task.priority,
        scheduling: null,
      }).success,
    ).toBe(true);
    expect(
      contracts.updateTaskSchema.safeParse({ version: 1, title: task.title, scheduling }).success,
    ).toBe(true);
    expect(contracts.updateTaskSchema.safeParse({ version: 1, scheduling: null }).success).toBe(true);
  });

  it('derives compatible Task input and normalized output aliases from the schemas', () => {
    const legacyTask: Task = task;
    const createWithoutScheduling: CreateTaskInput = {
      title: task.title,
      area: task.area,
      priority: task.priority,
    };

    expect(legacyTask.scheduling).toBeUndefined();
    expect(createWithoutScheduling.scheduling).toBeUndefined();
    expectTypeOf<Task>().toEqualTypeOf<z.input<typeof contracts.taskSchema>>();
    expectTypeOf<NormalizedTask>().toEqualTypeOf<z.output<typeof contracts.taskSchema>>();
    expectTypeOf<CreateTaskInput>().toEqualTypeOf<z.input<typeof contracts.createTaskSchema>>();
    expectTypeOf<Task['scheduling']>().toEqualTypeOf<TaskSchedulingInput | null | undefined>();
    expectTypeOf<NormalizedTask['scheduling']>().toEqualTypeOf<TaskSchedulingInput | null>();
  });

  it('rejects malformed, expanded, and reverse Task scheduling windows', () => {
    for (const invalidScheduling of [
      { ...scheduling, durationMinutes: 4 },
      { ...scheduling, latestEndLocalTime: '09:00' },
      { ...scheduling, earliestStartLocalTime: '11:00', latestEndLocalTime: '09:00' },
      { ...scheduling, ownerId: id },
    ]) {
      expect(
        contracts.createTaskSchema.safeParse({
          title: task.title,
          area: task.area,
          priority: task.priority,
          scheduling: invalidScheduling,
        }).success,
      ).toBe(false);
    }
  });

  it('normalizes legacy TimeRequest lifecycle fields to an active request', () => {
    expect(contracts.timeRequestSchema.parse(legacyTimeRequest)).toEqual({
      ...legacyTimeRequest,
      origin: null,
      lifecycleStatus: 'ACTIVE',
      closedAt: null,
      closedReason: null,
    });
  });

  it('accepts closed TimeRequests only with complete origins and closure evidence', () => {
    const closedRequest = {
      ...legacyTimeRequest,
      origin: { kind: 'TASK', entityId: runId, entityVersion: 3 },
      lifecycleStatus: 'CLOSED',
      closedAt: now,
      closedReason: 'COMPLETED',
    };

    expect(contracts.timeRequestSchema.safeParse(closedRequest).success).toBe(true);

    for (const invalidRequest of [
      { ...closedRequest, origin: { kind: 'TASK', entityId: runId } },
      { ...closedRequest, lifecycleStatus: 'ACTIVE' },
      { ...closedRequest, closedAt: null },
      { ...closedRequest, closedReason: 'UNKNOWN' },
      { ...closedRequest, providerKey: 'must-not-be-accepted' },
    ]) {
      expect(contracts.timeRequestSchema.safeParse(invalidRequest).success).toBe(false);
    }
  });

  it('defines strict public preflight inputs, outputs, and privacy-preserving items', () => {
    const {
      dailyPlanPreflightSchema,
      dailyPlanPreflightPrepareInputSchema,
      dailyPlanPreflightApproveInputSchema,
      dailyPlanPreflightGenerateInputSchema,
      dailyPlanPreflightPathParamsSchema,
      dailyPlanPreflightResponseSchema,
    } = v04Contracts;

    expect(dailyPlanPreflightSchema).toBeDefined();
    expect(dailyPlanPreflightPrepareInputSchema).toBeDefined();
    expect(dailyPlanPreflightApproveInputSchema).toBeDefined();
    expect(dailyPlanPreflightGenerateInputSchema).toBeDefined();
    expect(dailyPlanPreflightPathParamsSchema).toBeDefined();
    expect(dailyPlanPreflightResponseSchema).toBeDefined();

    if (
      dailyPlanPreflightSchema === undefined ||
      dailyPlanPreflightPrepareInputSchema === undefined ||
      dailyPlanPreflightApproveInputSchema === undefined ||
      dailyPlanPreflightGenerateInputSchema === undefined ||
      dailyPlanPreflightPathParamsSchema === undefined ||
      dailyPlanPreflightResponseSchema === undefined
    ) {
      return;
    }

    const preflight = {
      id,
      runId,
      contractVersion: 'DAILY_PLAN_PREFLIGHT_V1',
      localDate: '2026-08-24',
      status: 'AWAITING_APPROVAL',
      baseScheduleVersion: 2,
      items: [
        {
          contextRef: 'TIME_REQUEST_1',
          safeTitle: '  Architecture review  ',
          domain: 'WORK',
          deadlineLocalDate: null,
          durationMinutes: 45,
          priority: 'HIGH',
          availability: {
            earliestStartLocalTime: '09:00',
            latestEndLocalTime: '11:00',
          },
          isFixed: false,
          included: true,
        },
      ],
      version: 1,
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      claimedAt: null,
      consumedAt: null,
    };

    expect(dailyPlanPreflightSchema.parse(preflight)).toEqual({
      ...preflight,
      items: [{ ...preflight.items[0], safeTitle: 'Architecture review' }],
    });
    expect(dailyPlanPreflightPrepareInputSchema.parse({ localDate: '2026-08-24' })).toEqual({
      localDate: '2026-08-24',
    });
    expect(
      dailyPlanPreflightApproveInputSchema.parse({
        expectedPreflightVersion: 1,
        items: [
          {
            contextRef: 'TIME_REQUEST_1',
            safeTitle: 'Architecture review',
            domain: 'WORK',
            deadlineLocalDate: null,
            included: true,
          },
        ],
      }),
    ).toEqual({
      expectedPreflightVersion: 1,
      items: [
        {
          contextRef: 'TIME_REQUEST_1',
          safeTitle: 'Architecture review',
          domain: 'WORK',
          deadlineLocalDate: null,
          included: true,
        },
      ],
    });
    expect(
      dailyPlanPreflightGenerateInputSchema.parse({ preflightId: id, expectedPreflightVersion: 1 }),
    ).toEqual({ preflightId: id, expectedPreflightVersion: 1 });
    expect(dailyPlanPreflightPathParamsSchema.parse({ id })).toEqual({ id });
    expect(dailyPlanPreflightResponseSchema.parse({ data: preflight }).data.items[0]?.safeTitle).toBe(
      'Architecture review',
    );

    for (const invalidValue of [
      {
        ...preflight,
        items: [
          ...preflight.items,
          { ...preflight.items[0], contextRef: 'TIME_REQUEST_1', safeTitle: 'Another item' },
        ],
      },
      {
        ...preflight,
        items: [
          {
            ...preflight.items[0],
            availability: { earliestStartLocalTime: '11:00', latestEndLocalTime: '09:00' },
          },
        ],
      },
      {
        expectedPreflightVersion: 1,
        items: [
          {
            contextRef: 'TIME_REQUEST_1',
            safeTitle: 'Architecture review',
            domain: 'WORK',
            deadlineLocalDate: null,
            included: true,
            durationMinutes: 45,
          },
        ],
      },
      { localDate: '2026-08-24', ownerId: id },
    ]) {
      const schema = 'localDate' in invalidValue
        ? dailyPlanPreflightPrepareInputSchema
        : 'expectedPreflightVersion' in invalidValue
          ? dailyPlanPreflightApproveInputSchema
          : dailyPlanPreflightSchema;
      expect(schema.safeParse(invalidValue).success).toBe(false);
    }
  });

  it('enforces the binding preflight status matrix and timestamp monotonicity', () => {
    const basePreflight = {
      id,
      runId,
      contractVersion: 'DAILY_PLAN_PREFLIGHT_V1',
      localDate: '2026-08-24',
      baseScheduleVersion: 1,
      items: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      claimedAt: null,
      consumedAt: null,
    };
    const approvedAt = '2026-08-23T01:00:00.000Z';
    const claimedAt = '2026-08-23T02:00:00.000Z';
    const consumedAt = '2026-08-23T03:00:00.000Z';

    for (const validPreflight of [
      { ...basePreflight, status: 'AWAITING_APPROVAL' },
      { ...basePreflight, status: 'APPROVED', approvedAt },
      { ...basePreflight, status: 'CLAIMED', approvedAt, claimedAt },
      { ...basePreflight, status: 'CONSUMED', approvedAt, claimedAt, consumedAt },
      { ...basePreflight, status: 'STALE' },
      { ...basePreflight, status: 'STALE', approvedAt },
      { ...basePreflight, status: 'STALE', approvedAt, claimedAt },
    ]) {
      expect(contracts.dailyPlanPreflightSchema.safeParse(validPreflight).success).toBe(true);
    }

    for (const invalidPreflight of [
      { ...basePreflight, status: 'AWAITING_APPROVAL', approvedAt },
      { ...basePreflight, status: 'APPROVED' },
      { ...basePreflight, status: 'CLAIMED', approvedAt },
      { ...basePreflight, status: 'CONSUMED', approvedAt, claimedAt },
      { ...basePreflight, status: 'STALE', claimedAt },
      { ...basePreflight, status: 'STALE', consumedAt },
      { ...basePreflight, status: 'APPROVED', approvedAt: '2026-08-22T23:59:59.999Z' },
      { ...basePreflight, status: 'CLAIMED', approvedAt, claimedAt: now },
      { ...basePreflight, status: 'CONSUMED', approvedAt, claimedAt, consumedAt: approvedAt },
      { ...basePreflight, status: 'AWAITING_APPROVAL', updatedAt: '2026-08-22T23:59:59.999Z' },
    ]) {
      expect(contracts.dailyPlanPreflightSchema.safeParse(invalidPreflight).success).toBe(false);
    }
  });

  it('defines strict safe Event Proposal input and Event HTTP schemas', () => {
    const eventProposal = {
      title: '  Team review  ',
      kind: 'MEETING',
      localDate: '2026-08-24',
      startLocalTime: '14:00',
      endLocalTime: '15:00',
      isHard: true,
    };
    const event = {
      id,
      calendarRuleId: null,
      title: 'Team review',
      kind: 'MEETING' as const,
      localDate: '2026-08-24',
      startLocalTime: '14:00',
      endLocalTime: '15:00',
      isHard: true,
      status: 'CONFIRMED' as const,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    expect(contracts.createEventProposalInputSchema.parse(eventProposal)).toEqual({
      ...eventProposal,
      title: 'Team review',
    });
    expect(contracts.eventPathParamsSchema.parse({ id })).toEqual({ id });
    expect(contracts.eventResponseSchema.parse({ data: event })).toEqual({ data: event });

    for (const invalidInput of [
      { ...eventProposal, endLocalTime: '14:00' },
      { ...eventProposal, endLocalTime: '13:59' },
      { ...eventProposal, ownerId: id },
      { ...eventProposal, source: 'DAILY_SCHEDULER' },
      { ...eventProposal, provider: 'deepseek' },
      { ...eventProposal, id },
      { ...eventProposal, calendarRuleId: id },
      { ...eventProposal, status: 'CONFIRMED' },
      { ...eventProposal, version: 1 },
      { ...eventProposal, createdAt: now },
      { ...eventProposal, updatedAt: now },
      { ...eventProposal, expiresAt: now },
      { ...eventProposal, kind: 'SCHEDULE' },
      { ...eventProposal, changes: [] },
      { ...eventProposal, event },
    ]) {
      expect(contracts.createEventProposalInputSchema.safeParse(invalidInput).success).toBe(false);
    }

    expect(contracts.eventPathParamsSchema.safeParse({ id, ownerId: id }).success).toBe(false);
    expect(contracts.eventResponseSchema.safeParse({ data: { ...event, ownerId: id } }).success).toBe(false);
  });

  it('exposes awaiting context approval as a no-proposal Today state', () => {
    expect(
      contracts.todayDailyPlanSummarySchema.safeParse({
        status: 'AWAITING_CONTEXT_APPROVAL',
        proposalId: null,
        pendingItemCount: 0,
      }).success,
    ).toBe(true);

    for (const invalidSummary of [
      {
        status: 'AWAITING_CONTEXT_APPROVAL',
        proposalId: id,
        pendingItemCount: 0,
      },
      {
        status: 'AWAITING_CONTEXT_APPROVAL',
        proposalId: null,
        pendingItemCount: 1,
      },
    ]) {
      expect(contracts.todayDailyPlanSummarySchema.safeParse(invalidSummary).success).toBe(false);
    }
  });
});
