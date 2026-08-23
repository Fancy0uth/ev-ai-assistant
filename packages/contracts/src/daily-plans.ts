import * as z from 'zod';
import { localTimeSchema, timeRequestSourceSchema } from './calendar';

const nonBlankText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum);

const positiveVersionSchema = z.number().int().positive();

export const dailyPlanContractVersionSchema = z.literal('DAILY_PLAN_V1');
export const dailyPlanModelSchemaVersionSchema = z.literal('DAILY_PLAN_MODEL_V1');

export const dailyPlanTriggerSchema = z.enum([
  'MANUAL',
  'SCHEDULED_0700',
  'FIRST_VISIT_RECOVERY',
]);

export const dailyPlanRunStatusSchema = z.enum([
  'CREATED',
  'CONTEXT_READY',
  'GENERATING',
  'SUCCEEDED',
  'FAILED',
]);

export const dailyPlanProposalStatusSchema = z.enum([
  'PENDING_REVIEW',
  'PARTIALLY_APPLIED',
  'APPLIED',
  'REJECTED',
  'STALE',
]);

export const dailyPlanItemStatusSchema = z.enum([
  'PENDING_REVIEW',
  'APPLIED',
  'REJECTED',
  'INVALIDATED',
]);

export const dailyPlanFailureCodeSchema = z.enum([
  'DAILY_PLAN_PROVIDER_NOT_CONFIGURED',
  'DAILY_PLAN_PROVIDER_UNAVAILABLE',
  'DAILY_PLAN_CONTEXT_INVALID',
  'DAILY_PLAN_MODEL_OUTPUT_INVALID',
  'DAILY_PLAN_UNSUPPORTED_ACTION',
  'DAILY_PLAN_CONTEXT_REFERENCE_UNKNOWN',
  'DAILY_PLAN_VALIDATION_FAILED',
  'DAILY_PLAN_BASE_VERSION_STALE',
  'DAILY_PLAN_RUN_STATE_CONFLICT',
  'DAILY_PLAN_PROPOSAL_NOT_REVIEWABLE',
]);

export const dailyPlanContextCategorySchema = z.enum([
  'FIXED_EVENTS',
  'CONFIRMED_SOFT_BLOCKS',
  'OPEN_TIME_REQUESTS',
  'RECOVERY_CONSTRAINTS',
  'SCHEDULE_PREFERENCES',
]);

export const dailyPlanContextFieldSchema = z.enum([
  'LOCAL_DATE',
  'TIME_RANGE',
  'DURATION_MINUTES',
  'PRIORITY',
  'STATUS',
  'TARGET_DATE',
  'AVAILABILITY_WINDOW',
  'RECOVERY_LEVEL',
  'PREFERENCE_WINDOW',
]);

export const dailyPlanContextEntrySchema = z
  .object({
    category: dailyPlanContextCategorySchema,
    fieldCategories: z.array(dailyPlanContextFieldSchema).min(1).max(8),
    entityCount: z.number().int().min(0).max(500),
  })
  .strict();

export const dailyPlanContextManifestSchema = z
  .object({
    contractVersion: dailyPlanContractVersionSchema,
    purpose: z.literal('DAILY_PLAN_GENERATION'),
    localDate: z.iso.date(),
    createdAt: z.iso.datetime(),
    sentAt: z.iso.datetime().nullable(),
    entries: z.array(dailyPlanContextEntrySchema).min(1).max(5),
  })
  .strict()
  .superRefine((manifest, context) => {
    const categories = new Set<string>();

    for (const [index, entry] of manifest.entries.entries()) {
      if (categories.has(entry.category)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'category'],
          message: '每个上下文类别最多只能出现一次',
        });
      }
      categories.add(entry.category);
    }
  });

const contextRefSchema = z.string().regex(/^TIME_REQUEST_[1-9]\d{0,2}$/).max(20);

export const dailyPlanUnschedulableReasonCodeSchema = z.enum([
  'HARD_EVENT_CONFLICT',
  'OUTSIDE_AVAILABILITY',
  'INSUFFICIENT_TIME',
  'CAPACITY_LIMIT',
]);

export const scheduleTimeRequestModelActionSchema = z
  .object({
    operation: z.literal('SCHEDULE_TIME_REQUEST'),
    contextRef: contextRefSchema,
    startLocalTime: localTimeSchema,
    endLocalTime: localTimeSchema,
    rationale: nonBlankText(400),
  })
  .strict()
  .superRefine((action, context) => {
    if (action.endLocalTime <= action.startLocalTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLocalTime'],
        message: '结束时间必须晚于开始时间',
      });
    }
  });

export const markTimeRequestUnschedulableModelActionSchema = z
  .object({
    operation: z.literal('MARK_TIME_REQUEST_UNSCHEDULABLE'),
    contextRef: contextRefSchema,
    reasonCode: dailyPlanUnschedulableReasonCodeSchema,
    rationale: nonBlankText(240),
  })
  .strict();

export const dailyPlanModelActionSchema = z.discriminatedUnion('operation', [
  scheduleTimeRequestModelActionSchema,
  markTimeRequestUnschedulableModelActionSchema,
]);

export const dailyPlanModelOutputSchema = z
  .object({
    schemaVersion: dailyPlanModelSchemaVersionSchema,
    summary: nonBlankText(800),
    actions: z.array(dailyPlanModelActionSchema).max(24),
  })
  .strict()
  .superRefine((output, context) => {
    const contextRefs = new Set<string>();

    for (const [index, action] of output.actions.entries()) {
      if (contextRefs.has(action.contextRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['actions', index, 'contextRef'],
          message: '同一 Time Request 只能被建议一次',
        });
      }
      contextRefs.add(action.contextRef);
    }
  });

export const scheduleTimeRequestProposalItemSchema = z
  .object({
    id: z.uuid(),
    ordinal: z.number().int().min(1).max(24),
    status: dailyPlanItemStatusSchema,
    operation: z.literal('SCHEDULE_TIME_REQUEST'),
    timeRequestId: z.uuid(),
    timeRequestVersion: positiveVersionSchema,
    startLocalTime: localTimeSchema,
    endLocalTime: localTimeSchema,
    reasonCode: z.null(),
    rationale: nonBlankText(400),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.endLocalTime <= item.startLocalTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLocalTime'],
        message: '结束时间必须晚于开始时间',
      });
    }
  });

export const markTimeRequestUnschedulableProposalItemSchema = z
  .object({
    id: z.uuid(),
    ordinal: z.number().int().min(1).max(24),
    status: dailyPlanItemStatusSchema,
    operation: z.literal('MARK_TIME_REQUEST_UNSCHEDULABLE'),
    timeRequestId: z.uuid(),
    timeRequestVersion: positiveVersionSchema,
    startLocalTime: z.null(),
    endLocalTime: z.null(),
    reasonCode: dailyPlanUnschedulableReasonCodeSchema,
    rationale: nonBlankText(400),
  })
  .strict();

export const dailyPlanProposalItemSchema = z.discriminatedUnion('operation', [
  scheduleTimeRequestProposalItemSchema,
  markTimeRequestUnschedulableProposalItemSchema,
]);

export const dailyPlanProposalSchema = z
  .object({
    id: z.uuid(),
    contractVersion: dailyPlanContractVersionSchema,
    runId: z.uuid(),
    localDate: z.iso.date(),
    status: dailyPlanProposalStatusSchema,
    baseScheduleVersion: positiveVersionSchema,
    summary: nonBlankText(800),
    items: z.array(dailyPlanProposalItemSchema).max(24),
    version: positiveVersionSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.status !== 'PENDING_REVIEW') {
      return;
    }

    for (const [index, item] of proposal.items.entries()) {
      if (item.status !== 'PENDING_REVIEW') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'status'],
          message: '待审阅草案只能包含待审阅项目',
        });
      }
    }
  });

export const dailyPlanGenerationInputSchema = z
  .object({
    localDate: z.iso.date(),
  })
  .strict();

export const dailyPlanProposalResponseSchema = z
  .object({
    data: dailyPlanProposalSchema,
  })
  .strict();

const dailyPlanApplyDecisionInputSchema = z
  .object({
    itemId: z.uuid(),
    decision: z.literal('APPLY'),
    startLocalTime: localTimeSchema.optional(),
    endLocalTime: localTimeSchema.optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if ((decision.startLocalTime === undefined) !== (decision.endLocalTime === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [decision.startLocalTime === undefined ? 'startLocalTime' : 'endLocalTime'],
        message: '调整时间必须同时提供开始和结束时间',
      });
    }

    if (
      decision.startLocalTime !== undefined &&
      decision.endLocalTime !== undefined &&
      decision.endLocalTime <= decision.startLocalTime
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLocalTime'],
        message: '结束时间必须晚于开始时间',
      });
    }
  });

const dailyPlanRejectDecisionInputSchema = z
  .object({
    itemId: z.uuid(),
    decision: z.literal('REJECT'),
    reason: nonBlankText(240).optional(),
  })
  .strict();

export const dailyPlanDecisionInputSchema = z.discriminatedUnion('decision', [
  dailyPlanApplyDecisionInputSchema,
  dailyPlanRejectDecisionInputSchema,
]);

const dailyPlanApplyDecisionRecordSchema = z
  .object({
    itemId: z.uuid(),
    decision: z.literal('APPLY'),
    scheduledEventId: z.uuid().nullable().default(null),
    startLocalTime: localTimeSchema.nullable().default(null),
    endLocalTime: localTimeSchema.nullable().default(null),
    reason: z.null().default(null),
  })
  .strict()
  .superRefine((decision, context) => {
    const startLocalTime = decision.startLocalTime;
    const endLocalTime = decision.endLocalTime;
    const hasStartTime = startLocalTime !== null;
    const hasEndTime = endLocalTime !== null;

    if (hasStartTime !== hasEndTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStartTime ? 'endLocalTime' : 'startLocalTime'],
        message: '实际采用时间必须同时提供开始和结束时间',
      });
    }

    if (startLocalTime !== null && endLocalTime !== null && endLocalTime <= startLocalTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLocalTime'],
        message: '实际结束时间必须晚于开始时间',
      });
    }

  });

const dailyPlanRejectDecisionRecordSchema = z
  .object({
    itemId: z.uuid(),
    decision: z.literal('REJECT'),
    scheduledEventId: z.null().default(null),
    startLocalTime: z.null().default(null),
    endLocalTime: z.null().default(null),
    reason: nonBlankText(240).nullable().default(null),
  })
  .strict();

export const dailyPlanDecisionRecordSchema = z.discriminatedUnion('decision', [
  dailyPlanApplyDecisionRecordSchema,
  dailyPlanRejectDecisionRecordSchema,
]);

export const dailyPlanDecisionBatchInputSchema = z
  .object({
    expectedProposalVersion: positiveVersionSchema,
    decisions: z.array(dailyPlanDecisionInputSchema).min(1).max(24),
  })
  .strict()
  .superRefine((input, context) => {
    const itemIds = new Set<string>();

    for (const [index, decision] of input.decisions.entries()) {
      if (itemIds.has(decision.itemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['decisions', index, 'itemId'],
          message: '同一草案项只能决定一次',
        });
      }
      itemIds.add(decision.itemId);
    }
  });

export const dailyPlanReviewSchema = z
  .object({
    proposal: dailyPlanProposalSchema,
    decisions: z.array(dailyPlanDecisionRecordSchema).max(24),
  })
  .strict()
  .superRefine((review, context) => {
    const itemIds = new Set<string>();

    for (const [index, decision] of review.decisions.entries()) {
      if (itemIds.has(decision.itemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['decisions', index, 'itemId'],
          message: '同一草案项只能决定一次',
        });
      }
      itemIds.add(decision.itemId);
    }
  });

export const dailyPlanProposalListQuerySchema = z
  .object({
    localDate: z.iso.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const dailyPlanProposalListPaginationSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();

export const dailyPlanReviewResponseSchema = z
  .object({
    data: dailyPlanReviewSchema,
  })
  .strict();

export const dailyPlanReviewExplanationVerificationStatusSchema = z.enum([
  'CURRENT',
  'SCHEDULE_VERSION_CHANGED',
  'TIME_REQUEST_MISSING',
  'TIME_REQUEST_VERSION_CHANGED',
  'DURATION_MISMATCH',
  'OUTSIDE_AVAILABILITY',
  'HARD_EVENT_CONFLICT',
  'CONFIRMED_EVENT_CONFLICT',
]);

export const dailyPlanReviewExplanationConflictSchema = z
  .object({
    eventId: z.uuid(),
    kind: z.enum(['HARD_EVENT', 'CONFIRMED_EVENT']),
    startLocalTime: localTimeSchema,
    endLocalTime: localTimeSchema,
  })
  .strict();

const dailyPlanReviewExplanationTimeRequestSchema = z
  .object({
    id: z.uuid(),
    title: nonBlankText(200),
    source: timeRequestSourceSchema,
    durationMinutes: z.number().int().positive().max(24 * 60),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    earliestStartLocalTime: localTimeSchema.nullable(),
    latestEndLocalTime: localTimeSchema.nullable(),
    isFixed: z.boolean(),
    version: positiveVersionSchema,
  })
  .strict();

export const dailyPlanReviewExplanationSchema = z
  .object({
    proposalId: z.uuid(),
    localDate: z.iso.date(),
    baseScheduleVersion: positiveVersionSchema,
    currentScheduleVersion: positiveVersionSchema,
    contextManifest: dailyPlanContextManifestSchema,
    items: z
      .array(
        z
          .object({
            itemId: z.uuid(),
            ordinal: z.number().int().min(1).max(24),
            timeRequest: dailyPlanReviewExplanationTimeRequestSchema.nullable(),
            verification: z
              .object({
                status: dailyPlanReviewExplanationVerificationStatusSchema,
                conflicts: z.array(dailyPlanReviewExplanationConflictSchema).max(48),
              })
              .strict(),
          })
          .strict(),
      )
      .max(24),
  })
  .strict();

export const dailyPlanReviewExplanationResponseSchema = z
  .object({
    data: dailyPlanReviewExplanationSchema,
  })
  .strict();

export const dailyPlanReviewListResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(dailyPlanReviewSchema),
        pagination: dailyPlanProposalListPaginationSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    for (let index = 1; index < response.data.items.length; index += 1) {
      const previousReview = response.data.items[index - 1];
      const currentReview = response.data.items[index];

      if (previousReview === undefined || currentReview === undefined) {
        continue;
      }

      const previousProposal = previousReview.proposal;
      const currentProposal = currentReview.proposal;
      const previousUpdatedAt = Date.parse(previousProposal.updatedAt);
      const currentUpdatedAt = Date.parse(currentProposal.updatedAt);
      const isOutOfOrder =
        previousUpdatedAt < currentUpdatedAt ||
        (previousUpdatedAt === currentUpdatedAt && previousProposal.id > currentProposal.id);

      if (isOutOfOrder) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['data', 'items', index, 'proposal'],
          message: '草案列表必须按 updatedAt 降序、id 升序排序',
        });
      }
    }
  });

export const dailyPlanDecisionBatchResponseSchema = dailyPlanReviewResponseSchema;

export const dailyPlanRunSchema = z
  .object({
    id: z.uuid(),
    contractVersion: dailyPlanContractVersionSchema,
    localDate: z.iso.date(),
    trigger: dailyPlanTriggerSchema,
    status: dailyPlanRunStatusSchema,
    contextManifest: dailyPlanContextManifestSchema,
    proposalId: z.uuid().nullable(),
    failureCode: dailyPlanFailureCodeSchema.nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    const expectsProposal = run.status === 'SUCCEEDED';
    const expectsFailure = run.status === 'FAILED';

    if (expectsProposal !== (run.proposalId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposalId'],
        message: '只有成功的运行可以关联草案',
      });
    }

    if (expectsFailure !== (run.failureCode !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failureCode'],
        message: '只有失败的运行必须包含失败分类',
      });
    }

    const isTerminal = expectsProposal || expectsFailure;
    if (isTerminal !== (run.completedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completedAt'],
        message: '只有终态运行必须包含完成时间',
      });
    }

    if (run.completedAt !== null && Date.parse(run.completedAt) < Date.parse(run.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completedAt'],
        message: '完成时间不能早于创建时间',
      });
    }
  });

export type DailyPlanContractVersion = z.infer<typeof dailyPlanContractVersionSchema>;
export type DailyPlanModelSchemaVersion = z.infer<typeof dailyPlanModelSchemaVersionSchema>;
export type DailyPlanTrigger = z.infer<typeof dailyPlanTriggerSchema>;
export type DailyPlanRunStatus = z.infer<typeof dailyPlanRunStatusSchema>;
export type DailyPlanProposalStatus = z.infer<typeof dailyPlanProposalStatusSchema>;
export type DailyPlanItemStatus = z.infer<typeof dailyPlanItemStatusSchema>;
export type DailyPlanFailureCode = z.infer<typeof dailyPlanFailureCodeSchema>;
export type DailyPlanContextManifest = z.infer<typeof dailyPlanContextManifestSchema>;
export type DailyPlanModelAction = z.infer<typeof dailyPlanModelActionSchema>;
export type DailyPlanModelOutput = z.infer<typeof dailyPlanModelOutputSchema>;
export type DailyPlanProposalItem = z.infer<typeof dailyPlanProposalItemSchema>;
export type DailyPlanProposal = z.infer<typeof dailyPlanProposalSchema>;
export type DailyPlanGenerationInput = z.input<typeof dailyPlanGenerationInputSchema>;
export type DailyPlanProposalResponse = z.infer<typeof dailyPlanProposalResponseSchema>;
export type DailyPlanDecisionInput = z.input<typeof dailyPlanDecisionInputSchema>;
export type DailyPlanDecisionRecord = z.infer<typeof dailyPlanDecisionRecordSchema>;
export type DailyPlanReview = z.infer<typeof dailyPlanReviewSchema>;
export type DailyPlanReviewExplanation = z.infer<typeof dailyPlanReviewExplanationSchema>;
export type DailyPlanRun = z.infer<typeof dailyPlanRunSchema>;
