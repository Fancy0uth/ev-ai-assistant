import * as z from 'zod';

export const agentCapabilityKeySchema = z.enum(['CONVERSATION']);
export const agentCapabilityAvailabilitySchema = z.enum([
  'READY',
  'NOT_CONFIGURED',
  'UNAVAILABLE',
]);

export const agentCapabilitySchema = z
  .object({
    key: agentCapabilityKeySchema,
    label: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => value.trim().length > 0, '标签不能为空'),
    availability: agentCapabilityAvailabilitySchema,
    description: z
      .string()
      .min(1)
      .max(8000)
      .refine((value) => value.trim().length > 0, '描述不能为空'),
  })
  .strict();

export const agentSessionTitleSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value.trim().length > 0, '标题不能为空');

export const agentSessionSchema = z
  .object({
    id: z.uuid(),
    title: agentSessionTitleSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const agentMessageRoleSchema = z.enum(['USER', 'ASSISTANT']);
export const agentMessageContentSchema = z
  .string()
  .min(1)
  .max(8000)
  .refine((value) => value.trim().length > 0, '内容不能为空');

export const agentMessageSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    role: agentMessageRoleSchema,
    content: agentMessageContentSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();

export const agentPaginationSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();

const agentListQueryShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const agentSessionListQuerySchema = z.object(agentListQueryShape).strict();
export const agentMessageListQuerySchema = z.object(agentListQueryShape).strict();

const normalizedAgentSessionTitleSchema = agentSessionTitleSchema.transform((value) => value.trim());
const normalizedAgentMessageContentSchema = agentMessageContentSchema.transform((value) => value.trim());

export const createAgentSessionSchema = z
  .object({
    title: normalizedAgentSessionTitleSchema.default('新会话'),
  })
  .strict();

export const sendAgentMessageSchema = z
  .object({
    content: normalizedAgentMessageContentSchema,
  })
  .strict();

export const agentCapabilityResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(agentCapabilitySchema),
      })
      .strict(),
  })
  .strict();

export const agentSessionListResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(agentSessionSchema),
        pagination: agentPaginationSchema,
      })
      .strict(),
  })
  .strict();

export const agentSessionResponseSchema = z
  .object({
    data: agentSessionSchema,
  })
  .strict();

export const agentMessageListResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(agentMessageSchema),
        pagination: agentPaginationSchema,
      })
      .strict(),
  })
  .strict();

const agentUserMessageSchema = agentMessageSchema.extend({ role: z.literal('USER') }).strict();
const agentAssistantMessageSchema = agentMessageSchema
  .extend({ role: z.literal('ASSISTANT') })
  .strict();

export const agentSendMessageResponseSchema = z
  .object({
    data: z
      .object({
        userMessage: agentUserMessageSchema,
        assistantMessage: agentAssistantMessageSchema,
      })
      .strict(),
  })
  .strict();

export type AgentCapabilityKey = z.infer<typeof agentCapabilityKeySchema>;
export type AgentCapabilityAvailability = z.infer<typeof agentCapabilityAvailabilitySchema>;
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type AgentMessageRole = z.infer<typeof agentMessageRoleSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentPagination = z.infer<typeof agentPaginationSchema>;
export type AgentSessionListQuery = z.input<typeof agentSessionListQuerySchema>;
export type AgentMessageListQuery = z.input<typeof agentMessageListQuerySchema>;
export type CreateAgentSessionInput = z.input<typeof createAgentSessionSchema>;
export type SendAgentMessageInput = z.input<typeof sendAgentMessageSchema>;
