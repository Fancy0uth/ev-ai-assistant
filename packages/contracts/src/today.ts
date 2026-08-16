import * as z from 'zod';
import { eventSchema, signalSchema } from './calendar';
import { proposalSchema } from './proposals';
import { localDateSchema, taskAreaSchema, taskPrioritySchema, taskSchema, taskStatusSchema } from './tasks';

export const dailyStatusLevelSchema = z.enum(['STEADY', 'TIGHT', 'OVERLOADED']);

export const dailyPrioritySchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(200),
    area: taskAreaSchema,
    priority: taskPrioritySchema,
    status: taskStatusSchema,
  })
  .strict();

export const dailyStatusSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    level: dailyStatusLevelSchema,
    source: z.literal('RULES_V1'),
    reasons: z.array(z.string().min(1)).max(3),
    priorities: z.array(dailyPrioritySchema).max(3),
  })
  .strict();

export const yesterdaySummarySchema = z
  .object({
    taskCompletion: z.number().min(0).max(1),
    studyCompletion: z.number().min(0).max(1),
  })
  .strict();

export const todayQuerySchema = z.object({ date: localDateSchema }).strict();

export const dayPathParamsSchema = z.object({ date: localDateSchema }).strict();

export const dayViewSchema = z
  .object({
    date: localDateSchema,
    status: dailyStatusSchema,
    events: z.array(eventSchema),
    tasks: z.array(taskSchema),
    signals: z.array(signalSchema),
    pendingProposals: z.array(proposalSchema),
  })
  .strict();

export const dayViewResponseSchema = z.object({ data: dayViewSchema }).strict();

export const todaySnapshotSchema = z
  .object({
    data: z
      .object({
        date: localDateSchema,
        status: dailyStatusSchema,
        tasks: z.array(taskSchema),
        yesterday: yesterdaySummarySchema.nullable(),
        agents: z
          .object({
            deepSeek: z.literal('NOT_CONFIGURED'),
            codex: z.literal('NOT_CONFIGURED'),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type DailyStatus = z.infer<typeof dailyStatusSchema>;
export type TodaySnapshot = z.infer<typeof todaySnapshotSchema>;
export type DayView = z.infer<typeof dayViewSchema>;
