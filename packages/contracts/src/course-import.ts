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

const candidateConfidenceFieldsSchema = z.object({
  title: z.number().min(0).max(1), location: z.number().min(0).max(1), weekday: z.number().min(0).max(1),
  startLocalTime: z.number().min(0).max(1), endLocalTime: z.number().min(0).max(1), weekStart: z.number().min(0).max(1),
  weekEnd: z.number().min(0).max(1), weekPattern: z.number().min(0).max(1),
}).strict();
const candidateFieldsSchema = z.object({
  title: z.string().min(1).max(200).refine((value) => value.trim().length > 0),
  location: z.string().min(1).max(200).nullable(),
  weekday: z.number().int().min(1).max(7),
  startLocalTime: localTimeSchema,
  endLocalTime: localTimeSchema,
  weekStart: z.number().int().min(1).max(53),
  weekEnd: z.number().int().min(1).max(53),
  weekPattern: teachingWeekPatternSchema,
}).strict();
const candidateTimingRefinement = (candidate: z.infer<typeof candidateFieldsSchema>, context: z.RefinementCtx) => {
  if (candidate.weekEnd < candidate.weekStart) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['weekEnd'], message: '结束周不能早于开始周' });
  }
  if (candidate.endLocalTime <= candidate.startLocalTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endLocalTime'], message: '结束时间必须晚于开始时间' });
  }
};
export const visionCourseScheduleCandidateSchema = candidateFieldsSchema.extend({
  confidence: z.object({ overall: z.number().min(0).max(1), fields: candidateConfidenceFieldsSchema }).strict(),
}).strict().superRefine(candidateTimingRefinement);
export const courseScheduleCandidateSchema = candidateFieldsSchema.extend({
  candidateId: z.uuid(),
  included: z.boolean(),
  confidence: z.object({ overall: z.number().min(0).max(1), fields: candidateConfidenceFieldsSchema }).strict(),
  provenance: z.array(z.object({
    kind: z.enum(['VISION_OUTPUT', 'OWNER_EDIT']), providerId: z.string().min(1).max(120).nullable(),
    capabilityRunId: z.uuid().nullable(), editedFields: z.array(z.string().min(1).max(80)).max(12), capturedAt: z.iso.datetime(),
  }).strict()).min(1).max(16),
}).strict().superRefine(candidateTimingRefinement);
export const courseScheduleExtractionSchema = z.object({
  candidates: z.array(courseScheduleCandidateSchema).min(1).max(80),
}).strict();
export const visionCourseScheduleExtractionSchema = z.object({
  candidates: z.array(visionCourseScheduleCandidateSchema).min(1).max(80),
}).strict();
export const courseImportRevisionSchema = z.object({
  id: z.uuid(), importId: z.uuid(), parentRevisionId: z.uuid().nullable(), revisionNo: z.number().int().positive(),
  candidates: z.array(courseScheduleCandidateSchema).min(1).max(80), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdBy: z.enum(['VISION', 'OWNER']), createdAt: z.iso.datetime(),
}).strict();
export const extractCourseImportSchema = z.object({ expectedVersion: z.number().int().positive(), disclosureVersion: z.literal('CAPABILITY_DISCLOSURE_V1') }).strict();
export const saveCourseImportRevisionSchema = z.object({
  expectedVersion: z.number().int().positive(), parentRevisionId: z.uuid(),
  candidates: z.array(candidateFieldsSchema.extend({ candidateId: z.uuid(), included: z.boolean() }).strict().superRefine(candidateTimingRefinement)).min(1).max(80),
}).strict();
export const confirmCourseImportSchema = z.object({ expectedVersion: z.number().int().positive(), revisionId: z.uuid() }).strict();

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
  data: z.object({ import: courseImportSchema, disclosure: externalDisclosureSchema, revision: courseImportRevisionSchema.nullable().optional() }).strict(),
}).strict();

/** Deprecated compatibility type: raw images are not represented in JSON contracts. */
export type CourseImportImage = never;
export type CourseScheduleImageMediaType = z.infer<typeof courseScheduleImageMediaTypeSchema>;
export type LocalArtifact = z.infer<typeof localArtifactSchema>;
export type CourseScheduleCandidate = z.infer<typeof courseScheduleCandidateSchema>;
export type CourseScheduleExtraction = z.infer<typeof courseScheduleExtractionSchema>;
export type VisionCourseScheduleExtraction = z.infer<typeof visionCourseScheduleExtractionSchema>;
export type CourseImportRevision = z.infer<typeof courseImportRevisionSchema>;
export type CourseImport = z.infer<typeof courseImportSchema>;
export type ExternalDisclosure = z.infer<typeof externalDisclosureSchema>;
export type CreateCourseImportInput = z.input<typeof createCourseImportSchema>;
