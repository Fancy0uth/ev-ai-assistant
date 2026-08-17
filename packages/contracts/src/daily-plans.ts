import * as z from 'zod';
import { localTimeSchema } from './calendar';

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
export type DailyPlanRun = z.infer<typeof dailyPlanRunSchema>;
