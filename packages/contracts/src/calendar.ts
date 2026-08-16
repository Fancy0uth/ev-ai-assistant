import * as z from 'zod';

export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间必须是 HH:mm');
export const teachingWeekPatternSchema = z.enum(['EVERY_WEEK', 'ODD_WEEKS', 'EVEN_WEEKS']);
export const eventKindSchema = z.enum([
  'COURSE',
  'MEETING',
  'PERSONAL',
  'WORK_BLOCK',
  'WORKOUT',
  'STUDY',
]);
export const eventStatusSchema = z.enum(['CONFIRMED', 'CANCELLED']);
export const actionKindSchema = z.enum(['WORK', 'STUDY', 'FITNESS', 'NUTRITION', 'LIFE']);
export const actionStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'DEFERRED', 'CANCELLED']);
export const activitySessionKindSchema = z.enum(['PROJECT', 'STUDY', 'WORKOUT', 'LIFE']);
export const signalKindSchema = z.enum(['RECOVERY', 'ENERGY', 'SLEEP', 'DISCOMFORT']);
export const timeRequestSourceSchema = z.enum([
  'SCHEDULE_COORDINATOR',
  'FITNESS_AGENT',
  'LEARNING_AGENT',
  'PROJECT_AGENT',
  'NUTRITION_AGENT',
]);

const nonBlankTitleSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0, '标题不能为空');

export const calendarRuleSchema = z
  .object({
    id: z.uuid(),
    termId: z.uuid(),
    title: z.string().min(1).max(200),
    weekday: z.number().int().min(1).max(7),
    startLocalTime: localTimeSchema,
    endLocalTime: localTimeSchema,
    weekStart: z.number().int().positive().max(53),
    weekEnd: z.number().int().positive().max(53),
    weekPattern: teachingWeekPatternSchema,
    isHard: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.weekEnd < rule.weekStart) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekEnd'],
        message: '结束周不能早于开始周',
      });
    }

    if (rule.endLocalTime <= rule.startLocalTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLocalTime'],
        message: '结束时间必须晚于开始时间',
      });
    }
  });

export const eventSchema = z
  .object({
    id: z.uuid(),
    ownerId: z.uuid(),
    calendarRuleId: z.uuid().nullable(),
    title: nonBlankTitleSchema,
    kind: eventKindSchema,
    localDate: z.iso.date(),
    startLocalTime: localTimeSchema,
    endLocalTime: localTimeSchema,
    isHard: z.boolean(),
    status: eventStatusSchema,
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.endLocalTime <= event.startLocalTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLocalTime'],
        message: '结束时间必须晚于开始时间',
      });
    }
  });

export const actionSchema = z
  .object({
    id: z.uuid(),
    ownerId: z.uuid(),
    eventId: z.uuid().nullable(),
    title: nonBlankTitleSchema,
    kind: actionKindSchema,
    status: actionStatusSchema,
    targetDate: z.iso.date().nullable(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const activitySessionSchema = z
  .object({
    id: z.uuid(),
    ownerId: z.uuid(),
    actionId: z.uuid().nullable(),
    kind: activitySessionKindSchema,
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    summary: z.string().max(4000).nullable(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((session, context) => {
    if (session.endedAt !== null && session.endedAt <= session.startedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedAt'],
        message: '结束时间必须晚于开始时间',
      });
    }
  });

export const signalSchema = z
  .object({
    id: z.uuid(),
    ownerId: z.uuid(),
    localDate: z.iso.date(),
    kind: signalKindSchema,
    value: z.number().min(0).max(100),
    source: z.enum(['CHECK_IN', 'RULES', 'AGENT']),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const timeRequestSchema = z
  .object({
    id: z.uuid(),
    ownerId: z.uuid(),
    source: timeRequestSourceSchema,
    title: nonBlankTitleSchema,
    targetDate: z.iso.date(),
    durationMinutes: z.number().int().min(5).max(960),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    earliestStartLocalTime: localTimeSchema.nullable(),
    latestEndLocalTime: localTimeSchema.nullable(),
    isFixed: z.boolean(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.earliestStartLocalTime !== null &&
      request.latestEndLocalTime !== null &&
      request.latestEndLocalTime <= request.earliestStartLocalTime
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latestEndLocalTime'],
        message: '最晚结束时间必须晚于最早开始时间',
      });
    }
  });

export type LocalTime = z.infer<typeof localTimeSchema>;
export type TeachingWeekPattern = z.infer<typeof teachingWeekPatternSchema>;
export type CalendarRule = z.infer<typeof calendarRuleSchema>;
export type EventKind = z.infer<typeof eventKindSchema>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export type Event = z.infer<typeof eventSchema>;
export type ActionKind = z.infer<typeof actionKindSchema>;
export type ActionStatus = z.infer<typeof actionStatusSchema>;
export type Action = z.infer<typeof actionSchema>;
export type ActivitySessionKind = z.infer<typeof activitySessionKindSchema>;
export type ActivitySession = z.infer<typeof activitySessionSchema>;
export type SignalKind = z.infer<typeof signalKindSchema>;
export type Signal = z.infer<typeof signalSchema>;
export type TimeRequestSource = z.infer<typeof timeRequestSourceSchema>;
export type TimeRequest = z.infer<typeof timeRequestSchema>;
