import * as z from 'zod';
import { localTimeSchema, signalSchema } from './calendar';
import { localDateSchema } from './tasks';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z.uuid();
const paginationSchema = (maximumPageSize: number) => z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(maximumPageSize),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
}).strict();

function hasNoDuplicates(values: readonly string[], context: z.RefinementCtx, path: PropertyKey[]): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message: '值不能重复' });
  }
}

export const workoutGoalSchema = z.enum(['MOBILITY', 'STRENGTH', 'ENDURANCE', 'RECOVERY']);
export const workoutPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const workoutIntensityCapSchema = z.enum(['LOW', 'MODERATE']);
export const workoutSafetyDecisionSchema = z.discriminatedUnion('eligibility', [
  z.object({
    eligibility: z.literal('BLOCKED'),
    notice: z.literal('STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP'),
    reasonCodes: z.array(z.enum(['SELF_REPORTED_PAIN', 'SELF_REPORTED_ACUTE_RISK'])).min(1).max(2),
    maxDurationMinutes: z.literal(0),
    intensityCap: z.literal('NONE'),
  }).strict(),
  z.object({
    eligibility: z.literal('ELIGIBLE'),
    notice: z.literal('NON_MEDICAL_RECOVERY_GUIDANCE'),
    reasonCodes: z.array(z.enum(['RECOVERY_READY', 'RECOVERY_MODERATE', 'RECOVERY_CAUTION'])).length(1),
    maxDurationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
    intensityCap: workoutIntensityCapSchema,
  }).strict(),
]);

export const createFitnessCheckInSchema = z.object({
  localDate: localDateSchema,
  sleepMinutes: z.number().int().min(0).max(1440),
  energyLevel: z.number().int().min(1).max(5),
  discomfortLevel: z.number().int().min(0).max(5),
  hasPain: z.boolean(),
  acuteRisk: z.boolean(),
}).strict();

export const fitnessCheckInSchema = createFitnessCheckInSchema.extend({
  id: uuidSchema,
  signalId: uuidSchema,
  recovery: z.object({
    score: z.number().min(0).max(100),
    level: z.enum(['READY', 'MODERATE', 'CAUTION']),
    reasonCodes: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
  }).strict(),
  safety: workoutSafetyDecisionSchema,
  policyVersion: z.literal('WORKOUT_SAFETY_V1'),
  version: z.literal(1),
  createdAt: z.iso.datetime(),
}).strict();

export const exerciseCatalogManifestSchema = z.object({
  schemaVersion: z.literal('EXERCISE_CATALOG_V1'),
  catalogId: z.literal('ev-ai-internal-starter'),
  catalogVersion: z.literal('2026.08.31.1'),
  source: z.object({
    kind: z.literal('FIRST_PARTY_INTERNAL'),
    name: z.literal('EV AI internal starter catalog'),
    licenseId: z.null(),
    redistribution: z.literal(false),
    medicalClaims: z.literal(false),
  }).strict(),
  contentSha256: sha256Schema,
  itemCount: z.literal(8),
}).strict();

export const exerciseCitationSchema = z.object({
  citationId: sha256Schema,
  catalogId: z.literal('ev-ai-internal-starter'),
  catalogVersion: z.literal('2026.08.31.1'),
  catalogHash: sha256Schema,
  exerciseId: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
  itemHash: sha256Schema,
  sourceKind: z.literal('FIRST_PARTY_INTERNAL'),
  redistribution: z.literal(false),
}).strict();

const catalogDefaultSchema = z.object({
  rounds: z.number().int().min(1).max(5),
  reps: z.number().int().min(1).max(50).nullable(),
  durationSeconds: z.number().int().min(30).max(1800).nullable(),
  restSeconds: z.number().int().min(0).max(600),
}).strict().superRefine((value, context) => {
  if ((value.reps === null) === (value.durationSeconds === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '每项必须且只能包含 reps 或 durationSeconds' });
  }
});

export const exerciseCatalogItemSchema = z.object({
  exerciseId: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
  name: z.string().trim().min(1).max(120),
  neutralTechniqueText: z.string().trim().min(1).max(240),
  goals: z.array(workoutGoalSchema).min(1).max(4),
  movementTags: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  equipment: z.array(z.string().trim().min(1).max(40)).max(5),
  impact: z.literal('LOW'),
  defaults: z.object({ LOW: catalogDefaultSchema, MODERATE: catalogDefaultSchema }).strict(),
}).strict().superRefine((item, context) => {
  hasNoDuplicates(item.goals, context, ['goals']);
  hasNoDuplicates(item.movementTags, context, ['movementTags']);
  hasNoDuplicates(item.equipment, context, ['equipment']);
});

export const exerciseCatalogSearchItemSchema = exerciseCatalogItemSchema.extend({ citation: exerciseCitationSchema }).strict();

export const workoutSchedulingInputSchema = z.object({
  targetDate: localDateSchema,
  durationMinutes: z.number().int().min(5).max(120),
  priority: workoutPrioritySchema,
  earliestStartLocalTime: localTimeSchema.nullable(),
  latestEndLocalTime: localTimeSchema.nullable(),
}).strict().superRefine((scheduling, context) => {
  if (scheduling.earliestStartLocalTime !== null
    && scheduling.latestEndLocalTime !== null
    && scheduling.latestEndLocalTime <= scheduling.earliestStartLocalTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['latestEndLocalTime'], message: '最晚结束时间必须晚于最早开始时间' });
  }
});

const citationIdsSchema = z.array(sha256Schema).min(1).max(5).superRefine((citationIds, context) => {
  hasNoDuplicates(citationIds, context, []);
});

const workoutCreationBase = {
  checkInId: uuidSchema,
  expectedCheckInVersion: z.literal(1),
  goal: workoutGoalSchema,
  availableEquipment: z.array(z.string().trim().min(1).max(40)).max(5).superRefine((equipment, context) => {
    hasNoDuplicates(equipment, context, []);
  }),
  scheduling: workoutSchedulingInputSchema,
};

export const createWorkoutSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('MANUAL'), ...workoutCreationBase, citationIds: citationIdsSchema }).strict(),
  z.object({ mode: z.literal('ASSISTED'), ...workoutCreationBase, disclosureVersion: z.literal('HEALTH_DISCLOSURE_V1') }).strict(),
]);

export const workoutPlanItemSchema = z.object({
  citation: exerciseCitationSchema,
  rounds: z.number().int().min(1).max(5),
  reps: z.number().int().min(1).max(50).nullable(),
  durationSeconds: z.number().int().min(30).max(1800).nullable(),
  restSeconds: z.number().int().min(0).max(600),
}).strict().superRefine((item, context) => {
  if ((item.reps === null) === (item.durationSeconds === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '每项必须且只能包含 reps 或 durationSeconds' });
  }
});

export const workoutProvenanceSchema = z.object({
  kind: z.enum(['RULES', 'OWNER_EDIT', 'MODEL_SELECTION']),
  capabilityRunId: uuidSchema.nullable(),
  editedFields: z.array(z.string().trim().min(1).max(100)).max(30),
  capturedAt: z.iso.datetime(),
}).strict();

export const workoutRevisionSchema = z.object({
  id: uuidSchema,
  workoutId: uuidSchema,
  parentRevisionId: uuidSchema.nullable(),
  revisionNo: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(1000),
  items: z.array(workoutPlanItemSchema).min(1).max(5).superRefine((items, context) => {
    hasNoDuplicates(items.map((item) => item.citation.citationId), context, []);
  }),
  scheduling: workoutSchedulingInputSchema,
  provenance: z.array(workoutProvenanceSchema).min(1).max(10),
  contentHash: sha256Schema,
  createdAt: z.iso.datetime(),
}).strict();

export const createWorkoutRevisionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  parentRevisionId: uuidSchema,
  title: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(1000),
  items: z.array(workoutPlanItemSchema).min(1).max(5).superRefine((items, context) => {
    hasNoDuplicates(items.map((item) => item.citation.citationId), context, []);
  }),
  scheduling: workoutSchedulingInputSchema,
}).strict();

const workoutBase = z.object({
  id: uuidSchema,
  checkInId: uuidSchema,
  signalId: uuidSchema,
  currentRevisionId: uuidSchema,
  generationMode: z.enum(['MANUAL', 'ASSISTED']),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const workoutStateSchema = z.enum(['DRAFT', 'PROPOSAL_PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'SKIPPED']);
export const workoutSchema = z.discriminatedUnion('state', [
  workoutBase.extend({ state: z.literal('DRAFT'), proposalId: z.null(), actionId: z.null(), timeRequestId: z.null(), feedbackId: z.null() }).strict(),
  workoutBase.extend({ state: z.literal('PROPOSAL_PENDING'), proposalId: uuidSchema, actionId: z.null(), timeRequestId: z.null(), feedbackId: z.null() }).strict(),
  workoutBase.extend({ state: z.literal('ACCEPTED'), proposalId: uuidSchema, actionId: uuidSchema, timeRequestId: uuidSchema, feedbackId: z.null() }).strict(),
  workoutBase.extend({ state: z.literal('REJECTED'), proposalId: uuidSchema, actionId: z.null(), timeRequestId: z.null(), feedbackId: z.null() }).strict(),
  workoutBase.extend({ state: z.literal('COMPLETED'), proposalId: uuidSchema, actionId: uuidSchema, timeRequestId: uuidSchema, feedbackId: uuidSchema }).strict(),
  workoutBase.extend({ state: z.literal('SKIPPED'), proposalId: uuidSchema, actionId: uuidSchema, timeRequestId: uuidSchema, feedbackId: uuidSchema }).strict(),
]);

const feedbackBase = {
  expectedVersion: z.number().int().positive(),
  hadPain: z.boolean(),
  note: z.string().trim().min(1).max(500).nullable(),
};

export const workoutFeedbackSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('COMPLETED'),
    ...feedbackBase,
    perceivedEffort: z.number().int().min(1).max(10).nullable(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
  }).strict().superRefine((feedback, context) => {
    const started = Date.parse(feedback.startedAt);
    const ended = Date.parse(feedback.endedAt);
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started || ended - started > 86_400_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['endedAt'], message: '完成时间必须晚于开始时间且不超过 24 小时' });
    }
  }),
  z.object({
    outcome: z.literal('SKIPPED'),
    ...feedbackBase,
    perceivedEffort: z.null(),
    startedAt: z.null(),
    endedAt: z.null(),
  }).strict(),
]);

export const createWorkoutProposalSchema = z.object({
  expectedVersion: z.number().int().positive(),
  revisionId: uuidSchema,
}).strict();

export const fitnessCheckInPathParamsSchema = z.object({ id: uuidSchema }).strict();
export const workoutPathParamsSchema = z.object({ id: uuidSchema }).strict();
export const fitnessCheckInListQuerySchema = z.object({
  localDate: localDateSchema.optional(),
  eligibility: z.enum(['BLOCKED', 'ELIGIBLE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const workoutListQuerySchema = z.object({
  state: workoutStateSchema.optional(),
  localDate: localDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const exerciseListQuerySchema = z.object({
  checkInId: uuidSchema,
  query: z.string().trim().min(1).max(120).optional(),
  goal: workoutGoalSchema.optional(),
  equipment: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5).default(5),
}).strict();

export const fitnessCheckInResponseSchema = z.object({ data: z.object({ checkIn: fitnessCheckInSchema, signal: signalSchema }).strict() }).strict();
export const fitnessCheckInListResponseSchema = z.object({ data: z.object({ items: z.array(fitnessCheckInSchema), pagination: paginationSchema(50) }).strict() }).strict();
export const exerciseListResponseSchema = z.object({ data: z.object({ safety: workoutSafetyDecisionSchema, manifest: exerciseCatalogManifestSchema, items: z.array(exerciseCatalogSearchItemSchema), pagination: paginationSchema(5) }).strict() }).strict();
export const workoutCreateResponseSchema = z.object({ data: z.object({ workout: workoutSchema, revision: workoutRevisionSchema, disclosure: z.unknown().nullable() }).strict() }).strict();
export const workoutRevisionResponseSchema = z.object({ data: z.object({ workout: workoutSchema, revision: workoutRevisionSchema }).strict() }).strict();
export const workoutListResponseSchema = z.object({ data: z.object({ items: z.array(workoutSchema), pagination: paginationSchema(50) }).strict() }).strict();
export const workoutDetailResponseSchema = z.object({ data: z.object({ workout: workoutSchema, checkIn: fitnessCheckInSchema, revision: workoutRevisionSchema, proposal: z.unknown().nullable(), action: z.unknown().nullable(), timeRequest: z.unknown().nullable(), feedback: z.unknown().nullable() }).strict() }).strict();
export const workoutProposalResponseSchema = z.object({ data: z.object({ workout: workoutSchema, proposal: z.unknown() }).strict() }).strict();
export const workoutFeedbackResponseSchema = z.object({ data: z.object({ workout: workoutSchema, feedback: z.unknown(), action: z.unknown(), activitySession: z.unknown().nullable(), safetyNotice: z.literal('STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP').nullable() }).strict() }).strict();

export type WorkoutGoal = z.infer<typeof workoutGoalSchema>;
export type WorkoutSafetyDecision = z.infer<typeof workoutSafetyDecisionSchema>;
export type CreateFitnessCheckInInput = z.infer<typeof createFitnessCheckInSchema>;
export type FitnessCheckIn = z.infer<typeof fitnessCheckInSchema>;
export type ExerciseCatalogManifest = z.infer<typeof exerciseCatalogManifestSchema>;
export type ExerciseCitation = z.infer<typeof exerciseCitationSchema>;
export type ExerciseCatalogItem = z.infer<typeof exerciseCatalogItemSchema>;
export type WorkoutSchedulingInput = z.infer<typeof workoutSchedulingInputSchema>;
export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>;
export type WorkoutPlanItem = z.infer<typeof workoutPlanItemSchema>;
export type WorkoutRevision = z.infer<typeof workoutRevisionSchema>;
export type Workout = z.infer<typeof workoutSchema>;
export type WorkoutFeedbackInput = z.infer<typeof workoutFeedbackSchema>;
export type WorkoutListQuery = z.infer<typeof workoutListQuerySchema>;
