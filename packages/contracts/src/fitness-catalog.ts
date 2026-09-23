import * as z from 'zod';
import { workoutGoalSchema, workoutIntensityCapSchema } from './fitness';

const externalSourceId = 'hasaneyldrm/exercises-dataset' as const;
const externalLicense = 'MIT' as const;
const externalNoticeRef = 'UPSTREAM_NOTICE_MEDIA_NOT_IMPORTED' as const;

const nonBlankText = (maximum: number) => z.string()
  .max(maximum)
  .refine((value) => value.trim().length > 0, '值不能为空白');
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/i).transform((value) => value.toLowerCase());
const upstreamIdSchema = z.string().regex(/^\d{4}$/);
const unknownOrTextSchema = z.union([z.literal('UNKNOWN'), nonBlankText(240)]);

export const externalCatalogSourceMetadataSchema = z.object({
  sourceId: z.literal(externalSourceId),
  license: z.literal(externalLicense),
  noticeRef: z.literal(externalNoticeRef),
}).strict();

export const externalKeySchema = z.object({
  sourceId: z.literal(externalSourceId),
  revision: revisionSchema,
  upstreamId: upstreamIdSchema,
}).strict();

export const externalExerciseCatalogItemSchema = z.object({
  upstreamId: upstreamIdSchema,
  name: nonBlankText(240),
  bodyPart: nonBlankText(240),
  equipment: nonBlankText(240),
  target: nonBlankText(240),
  secondaryMuscles: z.array(nonBlankText(120)).max(32),
  instructions: z.object({
    en: z.array(nonBlankText(2_000)).min(1).max(40),
    zh: z.array(nonBlankText(2_000)).min(1).max(40),
  }).strict(),
  safetyReview: z.literal('UNREVIEWED'),
}).strict().superRefine((item, context) => {
  const instructionCharacters = item.instructions.en.concat(item.instructions.zh)
    .reduce((total, step) => total + [...step].length, 0);
  if (instructionCharacters > 24_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['instructions'], message: '步骤文本超过上限' });
  }
});

export const externalExerciseCatalogSchema = z.object({
  sourceId: z.literal(externalSourceId),
  revision: revisionSchema,
  license: z.literal(externalLicense),
  items: z.array(externalExerciseCatalogItemSchema).min(1).max(2_000),
}).strict().superRefine((catalog, context) => {
  if (new Set(catalog.items.map((item) => item.upstreamId)).size !== catalog.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'upstreamId 不能重复' });
  }
});

export const externalExerciseRecordSchema = externalExerciseCatalogItemSchema.extend({
  sourceId: z.literal(externalSourceId),
  revision: revisionSchema,
  catalogHash: sha256Schema,
  itemHash: sha256Schema,
}).strict();

export const catalogQuerySchema = z.object({
  text: z.string().trim().min(1).max(120).optional(),
  equipment: z.string().trim().min(1).max(240).optional(),
  muscle: z.string().trim().min(1).max(240).optional(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(20),
}).strict();

export const exerciseReviewDecisionSchema = z.enum(['ELIGIBLE', 'REJECTED', 'REVOKED']);

export const exerciseReviewScopeSchema = z.object({
  applicablePopulation: unknownOrTextSchema,
  goals: z.array(workoutGoalSchema).min(1).max(4),
  equipment: z.array(nonBlankText(240)).min(1).max(5),
  intensityCap: workoutIntensityCapSchema,
  contraindicationLimitations: z.union([z.literal('UNKNOWN'), z.array(nonBlankText(240)).min(1).max(5)]),
}).strict();

export const exerciseParameterLimitsSchema = z.object({
  roundsMax: z.union([z.literal('UNKNOWN'), z.number().int().min(1).max(5)]),
  repsMax: z.union([z.literal('UNKNOWN'), z.number().int().min(1).max(50)]),
  durationSecondsMax: z.union([z.literal('UNKNOWN'), z.number().int().min(30).max(1_800)]),
  restSecondsMax: z.union([z.literal('UNKNOWN'), z.number().int().min(0).max(600)]),
}).strict();

function hasCompleteEligibilityEvidence(review: {
  qualificationRef: string;
  evidenceRef: string;
  impact: 'UNKNOWN' | 'LOW';
  scope: z.infer<typeof exerciseReviewScopeSchema>;
  parameterLimits: z.infer<typeof exerciseParameterLimitsSchema>;
}): boolean {
  return review.qualificationRef !== 'UNKNOWN'
    && review.evidenceRef !== 'UNKNOWN'
    && review.impact !== 'UNKNOWN'
    && review.scope.applicablePopulation !== 'UNKNOWN'
    && review.scope.contraindicationLimitations !== 'UNKNOWN'
    && Object.values(review.parameterLimits).every((value) => value !== 'UNKNOWN');
}

export const exerciseReviewRecordSchema = z.object({
  key: externalKeySchema,
  itemHash: sha256Schema,
  reviewId: z.uuid(),
  decision: exerciseReviewDecisionSchema,
  reviewerId: nonBlankText(120),
  qualificationRef: unknownOrTextSchema,
  evidenceRef: unknownOrTextSchema,
  reviewedAt: z.iso.datetime(),
  impact: z.enum(['UNKNOWN', 'LOW']),
  scope: exerciseReviewScopeSchema,
  parameterLimits: exerciseParameterLimitsSchema,
  supersedesReviewId: z.uuid().nullable(),
}).strict().superRefine((review, context) => {
  if (review.supersedesReviewId === review.reviewId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['supersedesReviewId'], message: 'REVIEW_CANNOT_SUPERSEDE_SELF' });
  }
  if (review.decision === 'REVOKED' && review.supersedesReviewId === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['supersedesReviewId'], message: 'REVOKED_REVIEW_REQUIRES_SUPERSEDES' });
  }
  if (review.decision === 'ELIGIBLE' && !hasCompleteEligibilityEvidence(review)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'ELIGIBLE_REVIEW_REQUIRES_COMPLETE_EVIDENCE' });
  }
});

const eligibleReviewScopeSchema = z.object({
  applicablePopulation: nonBlankText(240),
  goals: z.array(workoutGoalSchema).min(1).max(4),
  equipment: z.array(nonBlankText(240)).min(1).max(5),
  intensityCap: workoutIntensityCapSchema,
  contraindicationLimitations: z.array(nonBlankText(240)).min(1).max(5),
}).strict();

const eligibleParameterLimitsSchema = z.object({
  roundsMax: z.number().int().min(1).max(5),
  repsMax: z.number().int().min(1).max(50),
  durationSecondsMax: z.number().int().min(30).max(1_800),
  restSecondsMax: z.number().int().min(0).max(600),
}).strict();

export const planCandidateV2Schema = z.object({
  record: externalExerciseRecordSchema,
  review: z.object({
    reviewId: z.uuid(),
    qualificationRef: nonBlankText(240),
    evidenceRef: nonBlankText(240),
    reviewedAt: z.iso.datetime(),
    impact: z.literal('LOW'),
    scope: eligibleReviewScopeSchema,
    parameterLimits: eligibleParameterLimitsSchema,
  }).strict(),
  medicalSafety: z.literal('NOT_MEDICALLY_CERTIFIED'),
}).strict();

export const listEligibleCatalogInputSchema = z.object({
  goal: workoutGoalSchema,
  equipment: z.array(nonBlankText(240)).min(1).max(5),
  intensityCap: workoutIntensityCapSchema,
  limit: z.number().int().min(1).max(5),
}).strict();

export type ExternalCatalogSourceMetadata = z.infer<typeof externalCatalogSourceMetadataSchema>;
export type ExternalKey = z.infer<typeof externalKeySchema>;
export type ExternalExerciseCatalogItem = z.infer<typeof externalExerciseCatalogItemSchema>;
export type ExternalExerciseCatalog = z.infer<typeof externalExerciseCatalogSchema>;
export type ExternalExerciseRecord = z.infer<typeof externalExerciseRecordSchema>;
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type ExerciseReviewRecord = z.infer<typeof exerciseReviewRecordSchema>;
export type ExerciseReviewScope = z.infer<typeof exerciseReviewScopeSchema>;
export type ExerciseParameterLimits = z.infer<typeof exerciseParameterLimitsSchema>;
export type ListEligibleCatalogInput = z.infer<typeof listEligibleCatalogInputSchema>;
export type PlanCandidateV2 = z.infer<typeof planCandidateV2Schema>;
