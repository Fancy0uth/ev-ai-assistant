import * as z from 'zod';
import { localDateSchema } from './tasks';
import { signalSchema } from './calendar';

export const recoveryLevelSchema = z.enum(['READY', 'MODERATE', 'CAUTION']);

export const checkInSchema = z
  .object({
    localDate: localDateSchema,
    sleepHours: z.number().min(0).max(24),
    energy: z.number().int().min(1).max(5),
    discomfort: z.number().int().min(0).max(5),
  })
  .strict();

export const recoveryAssessmentSchema = z
  .object({
    score: z.number().int().min(25).max(100),
    level: recoveryLevelSchema,
    reasons: z.array(z.string().min(1)).max(3),
  })
  .strict();

export const checkInResponseSchema = z
  .object({ data: z.object({ signal: signalSchema, assessment: recoveryAssessmentSchema }).strict() })
  .strict();

export type CheckInInput = z.infer<typeof checkInSchema>;
