import * as z from 'zod';

export const taskAreaSchema = z.enum(['WORK', 'STUDY', 'LIFE']);
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const taskStatusSchema = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'DONE',
  'DEFERRED',
  'CANCELLED',
]);

export const taskTitleSchema = z.string().trim().min(1).max(200);
export const localDateSchema = z.iso.date();

export const taskSchema = z
  .object({
    id: z.uuid(),
    title: taskTitleSchema,
    area: taskAreaSchema,
    priority: taskPrioritySchema,
    status: taskStatusSchema,
    targetDate: localDateSchema.nullable(),
    completedAt: z.iso.datetime().nullable(),
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
      .default(50),
    targetDate: localDateSchema.optional(),
  })
  .strict();

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

export type TaskArea = z.infer<typeof taskAreaSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Task = z.infer<typeof taskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
