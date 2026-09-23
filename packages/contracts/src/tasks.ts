import * as z from 'zod';
import { localTimeSchema } from './calendar';

export const taskAreaSchema = z.enum(['WORK', 'STUDY', 'LIFE']);
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const taskStatusSchema = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'DONE',
  'DEFERRED',
  'CANCELLED',
]);
export const taskDateScopeSchema = z.enum(['FUTURE', 'UNDATED']);

export const taskTitleSchema = z.string().trim().min(1).max(200);
export const localDateSchema = z.iso.date();

export const taskSchedulingInputSchema = z
  .object({
    durationMinutes: z.number().int().min(5).max(960),
    earliestStartLocalTime: localTimeSchema.nullable(),
    latestEndLocalTime: localTimeSchema.nullable(),
    isFixed: z.boolean(),
  })
  .strict()
  .superRefine((scheduling, context) => {
    if (
      scheduling.earliestStartLocalTime !== null &&
      scheduling.latestEndLocalTime !== null &&
      scheduling.latestEndLocalTime <= scheduling.earliestStartLocalTime
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latestEndLocalTime'],
        message: '最晚结束时间必须晚于最早开始时间',
      });
    }
  });

export type TaskSchedulingInput = z.infer<typeof taskSchedulingInputSchema>;

export const taskSchema = z
  .object({
    id: z.uuid(),
    title: taskTitleSchema,
    area: taskAreaSchema,
    priority: taskPrioritySchema,
    status: taskStatusSchema,
    targetDate: localDateSchema.nullable(),
    completedAt: z.iso.datetime().nullable(),
    scheduling: taskSchedulingInputSchema.nullable().optional().default(null),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const createTaskSchema = z
  .object({
    title: taskTitleSchema,
    area: taskAreaSchema,
    priority: taskPrioritySchema,
    targetDate: localDateSchema.nullable().optional(),
    scheduling: taskSchedulingInputSchema.nullable().optional().default(null),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    version: z.number().int().positive(),
    title: taskTitleSchema.optional(),
    area: taskAreaSchema.optional(),
    priority: taskPrioritySchema.optional(),
    status: taskStatusSchema.optional(),
    targetDate: localDateSchema.nullable().optional(),
    scheduling: taskSchedulingInputSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (input) => Object.keys(input).some((key) => key !== 'version'),
    '至少需要提供一个待更新字段',
  );

export const taskListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .transform((value) => Math.min(100, Math.max(1, value)))
      .default(20),
    area: taskAreaSchema.optional(),
    status: taskStatusSchema.optional(),
    targetDate: localDateSchema.optional(),
    dateScope: taskDateScopeSchema.optional(),
    referenceDate: localDateSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.targetDate !== undefined && input.dateScope !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateScope'],
        message: 'targetDate 与 dateScope 不能同时提供',
      });
    }

    if (input.dateScope === 'FUTURE' && input.referenceDate === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceDate'],
        message: 'dateScope=FUTURE 时必须提供 referenceDate',
      });
    }

    if (input.dateScope !== 'FUTURE' && input.referenceDate !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceDate'],
        message: 'referenceDate 仅可与 dateScope=FUTURE 一起提供',
      });
    }
  });

export const taskPathParamsSchema = z.object({ id: z.uuid() }).strict();

export const taskResponseSchema = z.object({ data: taskSchema }).strict();

export const taskListResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(taskSchema),
        pagination: z
          .object({
            page: z.number().int().positive(),
            pageSize: z.number().int().min(1).max(100),
            total: z.number().int().nonnegative(),
            totalPages: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const taskVersionConflictDetailsSchema = z
  .object({ currentTask: taskSchema })
  .strict();

export type TaskArea = z.infer<typeof taskAreaSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskDateScope = z.infer<typeof taskDateScopeSchema>;
export type Task = z.input<typeof taskSchema>;
export type NormalizedTask = z.output<typeof taskSchema>;
export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskVersionConflictDetails = z.infer<typeof taskVersionConflictDetailsSchema>;
