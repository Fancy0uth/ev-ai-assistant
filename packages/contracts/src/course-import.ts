import * as z from 'zod';
import { localTimeSchema, teachingWeekPatternSchema } from './calendar';
import { proposalSchema } from './proposals';

const imageBase64Schema = z
  .string()
  .min(4)
  .max(7_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, '图片内容必须是 Base64');

export const courseImportImageSchema = z
  .object({
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    base64: imageBase64Schema,
  })
  .strict();

export const courseScheduleCandidateSchema = z
  .object({
    title: z.string().min(1).max(200).refine((value) => value.trim().length > 0),
    weekday: z.number().int().min(1).max(7),
    startLocalTime: localTimeSchema,
    endLocalTime: localTimeSchema,
    weekStart: z.number().int().min(1).max(53),
    weekEnd: z.number().int().min(1).max(53),
    weekPattern: teachingWeekPatternSchema,
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.weekEnd < candidate.weekStart) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekEnd'],
        message: '结束周不能早于开始周',
      });
    }
    if (candidate.endLocalTime <= candidate.startLocalTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLocalTime'],
        message: '结束时间必须晚于开始时间',
      });
    }
  });

export const courseScheduleExtractionSchema = z
  .object({
    candidates: z.array(courseScheduleCandidateSchema).min(1).max(80),
  })
  .strict();

export const courseImportRunStatusSchema = z.enum([
  'BLOCKED',
  'REVIEW_REQUIRED',
  'PROPOSED',
  'FAILED',
]);

export const courseImportRunSchema = z
  .object({
    id: z.uuid(),
    termId: z.uuid(),
    status: courseImportRunStatusSchema,
    imageMimeType: courseImportImageSchema.shape.mimeType,
    imageByteSize: z.number().int().positive().max(5_000_000),
    imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    candidateCount: z.number().int().nonnegative().max(80),
    candidates: z.array(courseScheduleCandidateSchema),
    proposalId: z.uuid().nullable(),
    failureCode: z.string().min(1).max(100).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const createCourseImportSchema = z
  .object({
    termId: z.uuid(),
    image: courseImportImageSchema,
  })
  .strict();

export const courseImportPathParamsSchema = z.object({ id: z.uuid() }).strict();

export const courseImportResponseSchema = z
  .object({
    data: z
      .object({
        run: courseImportRunSchema,
        proposal: proposalSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type CourseImportImage = z.input<typeof courseImportImageSchema>;
export type CourseScheduleCandidate = z.infer<typeof courseScheduleCandidateSchema>;
export type CourseScheduleExtraction = z.infer<typeof courseScheduleExtractionSchema>;
export type CourseImportRun = z.infer<typeof courseImportRunSchema>;
export type CreateCourseImportInput = z.input<typeof createCourseImportSchema>;
