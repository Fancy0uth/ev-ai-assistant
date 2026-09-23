import * as z from 'zod';
import { eventKindSchema, localTimeSchema } from './calendar';

const nonBlankTextSchema = z.string()
  .trim()
  .min(1, '事项描述不能为空')
  .max(1_000, '事项描述不能超过 1000 个字符');

export const eventLanguageCandidateSchema = z.object({
  title: z.string().trim().min(1).max(200).nullable(),
  kind: eventKindSchema.nullable(),
  localDate: z.iso.date().nullable(),
  startLocalTime: localTimeSchema.nullable(),
  endLocalTime: localTimeSchema.nullable(),
  isHard: z.boolean().nullable(),
}).strict().superRefine((candidate, context) => {
  if (
    candidate.startLocalTime !== null
    && candidate.endLocalTime !== null
    && candidate.endLocalTime <= candidate.startLocalTime
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endLocalTime'],
      message: '结束时间必须晚于开始时间',
    });
  }
});

export const eventLanguageMissingFieldSchema = z.enum([
  'title',
  'kind',
  'localDate',
  'startLocalTime',
  'endLocalTime',
  'isHard',
]);

export const eventLanguageParseInputSchema = z.object({
  text: nonBlankTextSchema,
  referenceDate: z.iso.date(),
  timezone: z.literal('Asia/Shanghai'),
  externalProcessingConfirmed: z.boolean(),
}).strict();

export const eventLanguageProviderOutputSchema = z.object({
  schemaVersion: z.literal('EVENT_LANGUAGE_PARSE_V1'),
  candidate: eventLanguageCandidateSchema,
}).strict();

export const eventLanguageConflictSchema = z.object({
  eventId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  startLocalTime: localTimeSchema,
  endLocalTime: localTimeSchema,
  isHard: z.boolean(),
  reason: z.string().trim().min(1).max(300),
}).strict();

export const eventLanguageParseResultSchema = z.object({
  reference: z.object({
    localDate: z.iso.date(),
    timezone: z.literal('Asia/Shanghai'),
  }).strict(),
  candidate: eventLanguageCandidateSchema,
  missingFields: z.array(eventLanguageMissingFieldSchema).max(6),
  conflicts: z.array(eventLanguageConflictSchema).max(100),
}).strict();

export const eventLanguageParseResponseSchema = z.object({
  data: eventLanguageParseResultSchema,
}).strict();

export type EventLanguageCandidate = z.output<typeof eventLanguageCandidateSchema>;
export type EventLanguageMissingField = z.output<typeof eventLanguageMissingFieldSchema>;
export type EventLanguageParseInput = z.output<typeof eventLanguageParseInputSchema>;
export type EventLanguageProviderOutput = z.output<typeof eventLanguageProviderOutputSchema>;
export type EventLanguageConflict = z.output<typeof eventLanguageConflictSchema>;
export type EventLanguageParseResult = z.output<typeof eventLanguageParseResultSchema>;
