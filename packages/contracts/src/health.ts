import * as z from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('ev-core'),
  version: z.string().min(1),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
