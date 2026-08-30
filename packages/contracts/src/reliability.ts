import * as z from 'zod';

/** The only application version fact exposed by runtime contracts. */
export const APP_VERSION = '0.6.0' as const;

export const appVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );

export const idempotencyKeySchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/);

export const idempotencyOperationSchema = z.enum([
  'daily_plan.generate',
  'daily_plan.proposal.decision',
  'proposal.decision',
]);

export const deepSeekModelSchema = z.enum(['deepseek-v4-flash', 'deepseek-v4-pro']);

export const deepSeekFinishReasonSchema = z.enum([
  'stop',
  'length',
  'content_filter',
  'tool_calls',
  'insufficient_system_resource',
  'unknown',
]);

export const deepSeekUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type IdempotencyOperation = z.infer<typeof idempotencyOperationSchema>;
export type DeepSeekModel = z.infer<typeof deepSeekModelSchema>;
export type DeepSeekFinishReason = z.infer<typeof deepSeekFinishReasonSchema>;
export type DeepSeekUsage = z.infer<typeof deepSeekUsageSchema>;
