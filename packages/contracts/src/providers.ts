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

export const deepSeekCredentialWriteInputSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(512),
  })
  .strict();

export const deepSeekCredentialDeleteInputSchema = z
  .object({
    confirmation: z.literal('DELETE'),
  })
  .strict();

export const deepSeekCredentialStateSchema = z.enum(['NOT_CONFIGURED', 'CONFIGURED']);
export const deepSeekConnectionFailureCodeSchema = z.enum([
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'PROVIDER_UNAVAILABLE',
]);

export const deepSeekConnectionTestResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('SUCCEEDED') }).strict(),
  z
    .object({
      status: z.literal('FAILED'),
      failureCode: deepSeekConnectionFailureCodeSchema,
    })
    .strict(),
]);

export const deepSeekCredentialMetadataSchema = z
  .object({
    providerKey: z.literal('DEEPSEEK'),
    state: deepSeekCredentialStateSchema,
    updatedAt: z.iso.datetime().nullable(),
    lastConnectionTest: deepSeekConnectionTestResultSchema.nullable(),
  })
  .strict();

export const deepSeekCredentialStatusResponseSchema = z
  .object({ data: deepSeekCredentialMetadataSchema })
  .strict();

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
export type DeepSeekCredentialWriteInput = z.input<typeof deepSeekCredentialWriteInputSchema>;
export type DeepSeekCredentialDeleteInput = z.input<typeof deepSeekCredentialDeleteInputSchema>;
export type DeepSeekCredentialState = z.infer<typeof deepSeekCredentialStateSchema>;
export type DeepSeekConnectionFailureCode = z.infer<typeof deepSeekConnectionFailureCodeSchema>;
export type DeepSeekConnectionTestResult = z.infer<typeof deepSeekConnectionTestResultSchema>;
export type DeepSeekCredentialMetadata = z.infer<typeof deepSeekCredentialMetadataSchema>;
export type DeepSeekCredentialStatusResponse = z.infer<
  typeof deepSeekCredentialStatusResponseSchema
>;
export type AgentRunCapability = z.infer<typeof agentRunCapabilitySchema>;
export type AgentContextManifest = z.infer<typeof agentContextManifestSchema>;
export type AgentRunOutput = z.infer<typeof agentRunOutputSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type CreateAgentRunInput = z.input<typeof createAgentRunSchema>;
