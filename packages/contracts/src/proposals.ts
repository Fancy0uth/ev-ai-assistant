import * as z from 'zod';
import { calendarRuleSchema, eventSchema } from './calendar';

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

export const scheduleProposalChangeSchema = z.discriminatedUnion('operation', [
  createCalendarRuleChangeSchema,
  createEventChangeSchema,
]);

export const proposalChangeSchema = scheduleProposalChangeSchema;

const proposalTitleSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0, '标题不能为空');

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
  .strict();

export const createProposalSchema = z
  .object({
    kind: proposalKindSchema,
    source: proposalSourceSchema,
    title: proposalTitleSchema.transform((value) => value.trim()),
    changes: z.array(proposalChangeSchema).min(1),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const proposalDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    decision: z.enum(['ACCEPT', 'REJECT']),
  })
  .strict();

export type ProposalKind = z.infer<typeof proposalKindSchema>;
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type ProposalSource = z.infer<typeof proposalSourceSchema>;
export type ScheduleProposalChange = z.infer<typeof scheduleProposalChangeSchema>;
export type ProposalChange = z.infer<typeof proposalChangeSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type CreateProposalInput = z.input<typeof createProposalSchema>;
export type ProposalDecisionInput = z.infer<typeof proposalDecisionSchema>;
