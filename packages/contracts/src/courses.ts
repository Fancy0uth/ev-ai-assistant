import * as z from 'zod';
import { calendarRuleSchema, localTimeSchema } from './calendar';
import {
  capabilityDescriptorSchema,
  capabilityDisclosureVersionSchema,
} from './providers';
import { proposalSchema } from './proposals';

const titleSchema = z.string().trim().min(1).max(200);
const urlSchema = z.url().max(2000).refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  },
  '课程链接仅支持 HTTP 或 HTTPS',
);

export const courseSchema = z.object({
  id: z.uuid(), termId: z.uuid(), title: titleSchema, courseCode: z.string().max(80).nullable(),
  officialUrl: urlSchema.nullable(), version: z.number().int().positive(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
export const createCourseSchema = z.object({
  termId: z.uuid(), title: titleSchema, courseCode: z.string().trim().min(1).max(80).optional(), officialUrl: urlSchema.optional(),
}).strict();
export const coursePathParamsSchema = z.object({ id: z.uuid() }).strict();
export const courseResourceSchema = z.object({
  id: z.uuid(), courseId: z.uuid(), title: titleSchema, url: urlSchema, source: z.enum(['USER_PROVIDED', 'PUBLIC_SEARCH']), createdAt: z.iso.datetime(),
}).strict();
export const createCourseResourceSchema = z.object({ title: titleSchema, url: urlSchema }).strict();
export const courseResponseSchema = z.object({ data: courseSchema }).strict();
export const courseListResponseSchema = z.object({ data: z.array(courseSchema) }).strict();
export const courseResourceResponseSchema = z.object({ data: courseResourceSchema }).strict();
export const courseResourceListResponseSchema = z.object({ data: z.array(courseResourceSchema) }).strict();

const publicHttpsUrlSchema = z.url().max(2000).refine(
  (value) => new URL(value).protocol === 'https:',
  '公开资料仅支持 HTTPS',
);
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const courseLearningStageSchema = z.enum([
  'NOT_STARTED', 'PREPARING', 'IN_PROGRESS', 'REVIEWING', 'COMPLETE',
]);
export const courseLearningContextSchema = z.object({
  courseId: z.uuid(),
  stage: courseLearningStageSchema,
  progressNote: z.string().max(2000),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
export const updateCourseLearningContextSchema = z.object({
  expectedVersion: z.number().int().positive(),
  stage: courseLearningStageSchema,
  progressNote: z.string().max(2000),
}).strict();
export const courseSourceSchema = z.object({
  title: titleSchema,
  url: urlSchema,
}).strict();
export const courseResourceCitationSchema = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  courseResourceId: z.uuid(),
  searchRunId: z.uuid(),
  title: titleSchema,
  url: publicHttpsUrlSchema,
  publisher: z.string().trim().min(1).max(253),
  retrievedAt: z.iso.datetime(),
  contentHash: contentHashSchema,
  mediaType: z.enum(['text/html', 'text/plain']),
  createdAt: z.iso.datetime(),
}).strict();
export const courseResourceSearchStatusSchema = z.enum([
  'BLOCKED_PROVIDER', 'AWAITING_DISCLOSURE', 'SEARCHING', 'SUCCEEDED', 'FAILED',
]);
export const courseResourceSearchRunSchema = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  capabilityRunId: z.uuid(),
  query: z.string().trim().min(1).max(300),
  status: courseResourceSearchStatusSchema,
  citationCount: z.number().int().min(0).max(5),
  rejectedCount: z.number().int().min(0).max(5),
  failureCode: z.string().min(1).max(100).nullable(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
export const createCourseResourceSearchSchema = z.object({
  query: z.string().trim().min(1).max(300),
}).strict();
export const courseResourceSearchExecuteSchema = z.object({
  expectedVersion: z.number().int().positive(),
  disclosureVersion: capabilityDisclosureVersionSchema,
}).strict();
export const publicSearchResultSchema = z.object({
  title: titleSchema,
  publisherHint: z.string().trim().min(1).max(200).optional(),
  url: publicHttpsUrlSchema,
}).strict();
export const publicSearchResponseSchema = z.object({
  results: z.array(publicSearchResultSchema).min(1).max(5),
}).strict();
export const courseDetailSchema = z.object({
  course: courseSchema,
  rules: z.array(calendarRuleSchema),
  sources: z.object({
    official: z.array(courseSourceSchema).max(1),
    user: z.array(courseResourceSchema),
    public: z.array(courseResourceCitationSchema),
  }).strict(),
  learningContext: courseLearningContextSchema,
  actionCounts: z.object({
    open: z.number().int().min(0),
    completed: z.number().int().min(0),
  }).strict(),
}).strict();
export const courseDetailResponseSchema = z.object({ data: courseDetailSchema }).strict();
export const courseLearningContextResponseSchema = z.object({ data: courseLearningContextSchema }).strict();
export const courseResourceSearchCreateResponseSchema = z.object({
  data: z.object({ run: courseResourceSearchRunSchema, disclosure: capabilityDescriptorSchema }).strict(),
}).strict();
export const courseResourceSearchResponseSchema = z.object({
  data: z.object({ run: courseResourceSearchRunSchema, citations: z.array(courseResourceCitationSchema) }).strict(),
}).strict();

const citationIdSelectionSchema = z.array(z.uuid()).min(1).max(3).superRefine((citationIds, context) => {
  if (new Set(citationIds).size !== citationIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '引用不能重复' });
  }
});
const learningObjectiveSchema = z.string().trim().min(1).max(2_000);

export const createLearningRunSchema = z.object({
  searchRunId: z.uuid(),
  citationIds: citationIdSelectionSchema,
  objective: learningObjectiveSchema,
  targetDate: z.iso.date(),
  earliestStartLocalTime: localTimeSchema.nullable(),
  latestEndLocalTime: localTimeSchema.nullable(),
}).strict().superRefine((input, context) => {
  if (
    input.earliestStartLocalTime !== null
    && input.latestEndLocalTime !== null
    && input.latestEndLocalTime <= input.earliestStartLocalTime
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['latestEndLocalTime'], message: '最晚结束时间必须晚于最早开始时间' });
  }
});
export const learningRunStatusSchema = z.enum([
  'BLOCKED_PROVIDER', 'AWAITING_DISCLOSURE', 'GENERATING', 'PROPOSAL_PENDING', 'ACCEPTED', 'REJECTED', 'FAILED',
]);
export const learningRunSchema = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  searchRunId: z.uuid(),
  capabilityRunId: z.uuid(),
  citationIds: citationIdSelectionSchema,
  status: learningRunStatusSchema,
  proposalId: z.uuid().nullable(),
  failureCode: z.string().min(1).max(100).nullable(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
export const learningRunGenerateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  disclosureVersion: capabilityDisclosureVersionSchema,
}).strict();
export const citedLearningAdviceInputSchema = z.object({
  schemaVersion: z.literal('CITED_LEARNING_ADVICE_V1'),
  course: z.object({ id: z.uuid(), title: titleSchema, stage: courseLearningStageSchema }).strict(),
  objective: learningObjectiveSchema,
  materials: z.array(z.object({
    citationId: z.uuid(),
    title: titleSchema,
    publisher: z.string().trim().min(1).max(253),
    url: publicHttpsUrlSchema,
    contentHash: contentHashSchema,
    untrustedText: z.string().min(1).max(4_000),
  }).strict()).min(1).max(3),
}).strict();
export const citedLearningAdviceOutputSchema = z.object({
  schemaVersion: z.literal('CITED_LEARNING_ADVICE_V1'),
  title: titleSchema,
  rationale: z.string().trim().min(1).max(2_000),
  citationIds: citationIdSelectionSchema,
  durationMinutes: z.number().int().min(5).max(960),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
}).strict();
export const learningRunCreateResponseSchema = z.object({
  data: z.object({ run: learningRunSchema, disclosure: capabilityDescriptorSchema }).strict(),
}).strict();
export const learningRunResponseSchema = z.object({ data: learningRunSchema }).strict();
export const learningRunGenerateResponseSchema = z.object({
  data: z.object({ run: learningRunSchema, proposal: proposalSchema }).strict(),
}).strict();
export type Course = z.infer<typeof courseSchema>;
export type CourseResource = z.infer<typeof courseResourceSchema>;
export type CourseLearningStage = z.infer<typeof courseLearningStageSchema>;
export type CourseLearningContext = z.infer<typeof courseLearningContextSchema>;
export type CourseResourceCitation = z.infer<typeof courseResourceCitationSchema>;
export type CourseResourceSearchRun = z.infer<typeof courseResourceSearchRunSchema>;
export type CreateLearningRunInput = z.infer<typeof createLearningRunSchema>;
export type LearningRun = z.infer<typeof learningRunSchema>;
export type LearningRunStatus = z.infer<typeof learningRunStatusSchema>;
export type CitedLearningAdviceInput = z.infer<typeof citedLearningAdviceInputSchema>;
export type CitedLearningAdviceOutput = z.infer<typeof citedLearningAdviceOutputSchema>;
export type CourseDetail = z.infer<typeof courseDetailSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type CreateCourseResourceInput = z.infer<typeof createCourseResourceSchema>;
export type CreateCourseResourceSearchInput = z.infer<typeof createCourseResourceSearchSchema>;
export type UpdateCourseLearningContextInput = z.infer<typeof updateCourseLearningContextSchema>;
