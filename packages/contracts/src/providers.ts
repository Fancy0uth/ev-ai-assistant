import * as z from 'zod';

export const providerKeySchema = z.enum(['DEEPSEEK', 'CODEX_LOCAL']);
export const providerAvailabilitySchema = z.enum(['READY', 'NOT_CONFIGURED', 'UNAVAILABLE']);

export const providerProfileSchema = z
  .object({
    key: providerKeySchema,
    label: z.string().min(1).max(80),
    availability: providerAvailabilitySchema,
    acceptsSecrets: z.literal(false),
  })
  .strict();

export const providerListResponseSchema = z.object({ data: z.array(providerProfileSchema) }).strict();

export const agentRunCapabilitySchema = z.enum([
  'LIFE_PLANNING',
  'FITNESS_COACHING',
  'LEARNING_SUPPORT',
  'PROJECT_ANALYSIS',
]);
export const agentContextDomainSchema = z.enum([
  'SCHEDULE',
  'FITNESS',
  'NUTRITION',
  'LEARNING',
  'PROJECT',
  'MEMORY',
]);

export const agentContextManifestSchema = z
  .object({
    domains: z.array(agentContextDomainSchema).min(1).max(6),
    entityIds: z.array(z.uuid()).max(100),
  })
  .strict();

export const agentRunOutputSchema = z
  .object({
    summary: z.string().min(1).max(2000).refine((value) => value.trim().length > 0),
    suggestedActions: z
      .array(z.string().min(1).max(200).refine((value) => value.trim().length > 0))
      .max(20),
  })
  .strict();

export const agentRunStatusSchema = z.enum(['BLOCKED', 'SUCCEEDED', 'FAILED']);

export const agentRunSchema = z
  .object({
    id: z.uuid(),
    providerKey: providerKeySchema,
    capability: agentRunCapabilitySchema,
    status: agentRunStatusSchema,
    context: agentContextManifestSchema,
    output: agentRunOutputSchema.nullable(),
    failureCode: z.string().min(1).max(100).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const createAgentRunSchema = z
  .object({
    providerKey: providerKeySchema,
    capability: agentRunCapabilitySchema,
    context: agentContextManifestSchema,
  })
  .strict();

export const agentRunResponseSchema = z.object({ data: agentRunSchema }).strict();
export const agentRunListResponseSchema = z.object({ data: z.array(agentRunSchema) }).strict();

export type ProviderKey = z.infer<typeof providerKeySchema>;
export type ProviderProfile = z.infer<typeof providerProfileSchema>;
export type AgentRunCapability = z.infer<typeof agentRunCapabilitySchema>;
export type AgentContextManifest = z.infer<typeof agentContextManifestSchema>;
export type AgentRunOutput = z.infer<typeof agentRunOutputSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type CreateAgentRunInput = z.input<typeof createAgentRunSchema>;
