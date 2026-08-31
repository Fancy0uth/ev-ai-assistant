import * as z from 'zod';
import { calendarRuleSchema, eventSchema, localTimeSchema } from './calendar';

export const proposalKindSchema = z.enum(['SCHEDULE', 'WORKOUT', 'NUTRITION', 'LEARNING', 'PROJECT']);
export const proposalStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
export const proposalSourceSchema = z.enum([
  'COURSE_IMPORT',
  'DAILY_SCHEDULER',
  'FITNESS_AGENT',
  'NUTRITION_AGENT',
  'LEARNING_AGENT',
  'PROJECT_AGENT',
]);

export const createCalendarRuleChangeSchema = z
  .object({
    operation: z.literal('CREATE_CALENDAR_RULE'),
    rule: calendarRuleSchema,
  })
  .strict();

export const createEventChangeSchema = z
  .object({
    operation: z.literal('CREATE_EVENT'),
    event: eventSchema,
  })
  .strict();

export const expandCalendarRuleChangeSchema = z.object({
  operation: z.literal('EXPAND_CALENDAR_RULE'),
  calendarRuleId: z.uuid(),
  expectedRuleVersion: z.number().int().positive(),
}).strict();

const learningCitationIdsSchema = z.array(z.uuid()).min(1).max(3).superRefine((citationIds, context) => {
  if (new Set(citationIds).size !== citationIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '引用不能重复' });
  }
});
export const createLearningActionChangeSchema = z.object({
  operation: z.literal('CREATE_LEARNING_ACTION'),
  action: z.object({
    id: z.uuid(),
    courseId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    targetDate: z.iso.date(),
    status: z.literal('OPEN'),
    kind: z.literal('STUDY'),
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }).strict(),
  scheduling: z.object({
    timeRequestId: z.uuid(),
    durationMinutes: z.number().int().min(5).max(960),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    earliestStartLocalTime: localTimeSchema.nullable(),
    latestEndLocalTime: localTimeSchema.nullable(),
    isFixed: z.literal(false),
  }).strict(),
  citationIds: learningCitationIdsSchema,
}).strict().superRefine((change, context) => {
  if (
    change.scheduling.earliestStartLocalTime !== null
    && change.scheduling.latestEndLocalTime !== null
    && change.scheduling.latestEndLocalTime <= change.scheduling.earliestStartLocalTime
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduling', 'latestEndLocalTime'], message: '最晚结束时间必须晚于最早开始时间' });
  }
});

const workoutCitationIdsSchema = z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(5).superRefine((citationIds, context) => {
  if (new Set(citationIds).size !== citationIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '引用不能重复' });
  }
});

export const createWorkoutActionChangeSchema = z.object({
  operation: z.literal('CREATE_WORKOUT_ACTION'),
  workout: z.object({
    workoutId: z.uuid(),
    revisionId: z.uuid(),
    expectedWorkoutVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  action: z.object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(200),
    targetDate: z.iso.date(),
    status: z.literal('OPEN'),
    kind: z.literal('FITNESS'),
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }).strict(),
  scheduling: z.object({
    timeRequestId: z.uuid(),
    durationMinutes: z.number().int().min(5).max(120),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    earliestStartLocalTime: localTimeSchema.nullable(),
    latestEndLocalTime: localTimeSchema.nullable(),
    isFixed: z.literal(false),
  }).strict(),
  citationIds: workoutCitationIdsSchema,
}).strict().superRefine((change, context) => {
  if (change.scheduling.earliestStartLocalTime !== null
    && change.scheduling.latestEndLocalTime !== null
    && change.scheduling.latestEndLocalTime <= change.scheduling.earliestStartLocalTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduling', 'latestEndLocalTime'], message: '最晚结束时间必须晚于最早开始时间' });
  }
});

export const scheduleProposalChangeSchema = z.discriminatedUnion('operation', [
  createCalendarRuleChangeSchema,
  createEventChangeSchema,
  expandCalendarRuleChangeSchema,
]);

export const proposalChangeSchema = z.discriminatedUnion('operation', [
  createCalendarRuleChangeSchema,
  createEventChangeSchema,
  expandCalendarRuleChangeSchema,
  createLearningActionChangeSchema,
  createWorkoutActionChangeSchema,
]);

const proposalTitleSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0, '标题不能为空');

function validateProposalChanges(
  proposal: { kind: z.infer<typeof proposalKindSchema>; source: z.infer<typeof proposalSourceSchema>; changes: z.infer<typeof proposalChangeSchema>[] },
  context: z.RefinementCtx,
): void {
  const containsLearningAction = proposal.changes.some((change) => change.operation === 'CREATE_LEARNING_ACTION');
  const containsWorkoutAction = proposal.changes.some((change) => change.operation === 'CREATE_WORKOUT_ACTION');
  if (proposal.kind === 'LEARNING') {
    if (proposal.source !== 'LEARNING_AGENT') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: '学习提案必须由学习 Agent 创建' });
    }
    if (!containsLearningAction || proposal.changes.some((change) => change.operation !== 'CREATE_LEARNING_ACTION')) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: '学习提案只能创建引用学习 Action' });
    }
  } else if (containsLearningAction) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: '非学习提案不能创建学习 Action' });
  }

  if (proposal.kind === 'WORKOUT') {
    if (proposal.source !== 'FITNESS_AGENT') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: '训练提案必须由健身 Agent 创建' });
    }
    if (proposal.changes.length !== 1 || !containsWorkoutAction) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: '训练提案必须且只能创建一个 Fitness Action' });
    }
  } else if (containsWorkoutAction) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: '非训练提案不能创建 Fitness Action' });
  }
}

export const proposalSchema = z
  .object({
    id: z.uuid(),
    kind: proposalKindSchema,
    status: proposalStatusSchema,
    source: proposalSourceSchema,
    title: proposalTitleSchema,
    changes: z.array(proposalChangeSchema).min(1),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine(validateProposalChanges);

export const createProposalSchema = z
  .object({
    kind: proposalKindSchema,
    source: proposalSourceSchema,
    title: proposalTitleSchema.transform((value) => value.trim()),
    changes: z.array(proposalChangeSchema).min(1),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .superRefine(validateProposalChanges);

export const proposalDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    decision: z.enum(['ACCEPT', 'REJECT']),
  })
  .strict();

export const proposalPathParamsSchema = z.object({ id: z.uuid() }).strict();

export const proposalListQuerySchema = z
  .object({
    status: z.literal('PENDING').default('PENDING'),
  })
  .strict();

export const proposalResponseSchema = z.object({ data: proposalSchema }).strict();

export const proposalListResponseSchema = z
  .object({
    data: z.array(proposalSchema),
  })
  .strict();

export const proposalVersionConflictDetailsSchema = z
  .object({ currentProposal: proposalSchema })
  .strict();

export type ProposalKind = z.infer<typeof proposalKindSchema>;
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type ProposalSource = z.infer<typeof proposalSourceSchema>;
export type ScheduleProposalChange = z.infer<typeof scheduleProposalChangeSchema>;
export type CreateLearningActionChange = z.infer<typeof createLearningActionChangeSchema>;
export type CreateWorkoutActionChange = z.infer<typeof createWorkoutActionChangeSchema>;
export type ProposalChange = z.infer<typeof proposalChangeSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type CreateProposalInput = z.input<typeof createProposalSchema>;
export type ProposalDecisionInput = z.infer<typeof proposalDecisionSchema>;
