import * as z from 'zod';
import { localTimeSchema, teachingWeekPatternSchema } from './calendar';

export const courseScheduleImageMediaTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export const localArtifactStateSchema = z.enum(['ACTIVE', 'DELETE_PENDING', 'DELETED']);
export const localArtifactSchema = z.object({
  id: z.uuid(),
  kind: z.literal('COURSE_SCHEDULE_IMAGE'),
  mediaType: courseScheduleImageMediaTypeSchema,
  byteSize: z.number().int().positive().max(5_000_000),
  width: z.number().int().positive().max(12_000),
  height: z.number().int().positive().max(12_000),
  pixelCount: z.number().int().positive().max(40_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  state: localArtifactStateSchema,
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  deleteRequestedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
}).strict();
export const courseArtifactResponseSchema = z.object({
  data: z.object({ artifact: localArtifactSchema, deduplicated: z.boolean() }).strict(),
}).strict();
export const courseArtifactPathParamsSchema = z.object({ id: z.uuid() }).strict();

export const courseScheduleCandidateSchema = z.object({
  title: z.string().min(1).max(200).refine((value) => value.trim().length > 0),
  weekday: z.number().int().min(1).max(7),
  startLocalTime: localTimeSchema,
  endLocalTime: localTimeSchema,
  weekStart: z.number().int().min(1).max(53),
  weekEnd: z.number().int().min(1).max(53),
  weekPattern: teachingWeekPatternSchema,
  confidence: z.number().min(0).max(1),
}).strict().superRefine((candidate, context) => {
  if (candidate.weekEnd < candidate.weekStart) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['weekEnd'], message: '结束周不能早于开始周' });
  }
  if (candidate.endLocalTime <= candidate.startLocalTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endLocalTime'], message: '结束时间必须晚于开始时间' });
  }
});
export const courseScheduleExtractionSchema = z.object({
  candidates: z.array(courseScheduleCandidateSchema).min(1).max(80),
}).strict();

export const courseImportV2StatusSchema = z.enum([
  'BLOCKED_PROVIDER', 'AWAITING_DISCLOSURE', 'EXTRACTING', 'REVIEW_REQUIRED',
  'SCHEDULE_PROPOSAL_PENDING', 'CONFIRMED', 'SCHEDULE_REJECTED', 'FAILED',
]);
export const courseImportSchema = z.object({
  id: z.uuid(), termId: z.uuid(), artifactId: z.uuid(), capabilityRunId: z.uuid(),
  status: courseImportV2StatusSchema, currentRevisionId: z.uuid().nullable(),
  scheduleProposalId: z.uuid().nullable(), failureCode: z.string().min(1).max(100).nullable(),
  version: z.number().int().min(1), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
export const externalDisclosureSchema = z.object({
  version: z.literal('CAPABILITY_DISCLOSURE_V1'),
  purpose: z.string().min(1).max(120),
  selectedData: z.array(z.string().min(1).max(120)).min(1).max(10),
  providerId: z.string().min(1).max(120).nullable(),
  providerLabel: z.string().min(1).max(120),
  adapterKind: z.enum(['NONE', 'TEST_FAKE', 'PRODUCTION_ADAPTER']),
  evidenceKind: z.enum(['NONE', 'AUTOMATED_FAKE', 'REAL_PROVIDER']),
}).strict();
export const createCourseImportSchema = z.object({ termId: z.uuid(), artifactId: z.uuid() }).strict();
export const courseImportPathParamsSchema = z.object({ id: z.uuid() }).strict();
export const courseImportResponseSchema = z.object({
  data: z.object({ import: courseImportSchema, disclosure: externalDisclosureSchema }).strict(),
}).strict();

/** Deprecated compatibility type: raw images are not represented in JSON contracts. */
export type CourseImportImage = never;
export type CourseScheduleImageMediaType = z.infer<typeof courseScheduleImageMediaTypeSchema>;
export type LocalArtifact = z.infer<typeof localArtifactSchema>;
export type CourseScheduleCandidate = z.infer<typeof courseScheduleCandidateSchema>;
export type CourseScheduleExtraction = z.infer<typeof courseScheduleExtractionSchema>;
export type CourseImport = z.infer<typeof courseImportSchema>;
export type ExternalDisclosure = z.infer<typeof externalDisclosureSchema>;
export type CreateCourseImportInput = z.input<typeof createCourseImportSchema>;
