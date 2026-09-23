import * as z from 'zod';
import {
  workoutGoalSchema,
  workoutIntensityCapSchema,
  workoutProvenanceSchema,
  workoutSafetyDecisionSchema,
  workoutSchedulingInputSchema,
} from './fitness';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z.uuid();
const plainTextSchema = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[<>]/.test(value), 'HTML is not allowed');

function hasNoDuplicates(values: readonly string[], context: z.RefinementCtx, path: PropertyKey[]): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message: 'Values must be unique' });
  }
}

function hasSameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function utf8ByteLength(value: string): number {
  let byteLength = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    byteLength += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return byteLength;
}

const technicalLimitSchema = (minimum: number, maximum: number) => z.union([
  z.literal('UNKNOWN'),
  z.number().int().min(minimum).max(maximum),
]);

const planningAllowedFieldsSchema = z.array(z.enum([
  'PROFILE_GOALS',
  'PROFILE_EXPERIENCE',
  'PROFILE_EQUIPMENT',
  'PROFILE_BODY_MEASUREMENTS',
  'PROFILE_FITNESS_DESCRIPTION',
  'PROFILE_LIMITATIONS',
  'CHECK_IN',
  'RECENT_FEEDBACK',
  'FITNESS_MEMORY',
  'CANDIDATES',
  'SCHEDULING',
])).min(1).max(11).superRefine((fields, context) => {
  hasNoDuplicates(fields, context, []);
});

export const workoutPlanningCandidateSourceKindSchema = z.enum(['INTERNAL_STARTER', 'EXTERNAL_DATASET']);
export const workoutPlanningCandidateEligibilitySchema = z.object({
  status: z.enum(['ELIGIBLE', 'REVOKED', 'UNREVIEWED']),
  limitations: z.union([z.literal('UNKNOWN'), z.array(plainTextSchema(200)).max(5)]),
  reviewRef: plainTextSchema(240).nullable(),
  policyRef: plainTextSchema(240).nullable(),
}).strict().superRefine((eligibility, context) => {
  if ((eligibility.reviewRef === null) === (eligibility.policyRef === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one review or policy reference is required' });
  }
});

export const workoutPlanningParameterLimitsV2Schema = z.object({
  roundsMax: technicalLimitSchema(1, 5),
  repsMax: technicalLimitSchema(1, 50),
  durationSecondsMax: technicalLimitSchema(30, 1_800),
  secondsPerRepMax: technicalLimitSchema(1, 10),
  restSecondsMax: technicalLimitSchema(0, 600),
  transitionSecondsMax: technicalLimitSchema(0, 120),
}).strict();

export const workoutPlanningCandidateV2Schema = z.object({
  citationId: sha256Schema,
  sourceKind: workoutPlanningCandidateSourceKindSchema,
  source: plainTextSchema(240),
  version: plainTextSchema(120),
  hash: sha256Schema,
  itemHash: sha256Schema,
  technicalSummary: plainTextSchema(600),
  goals: z.array(workoutGoalSchema).min(1).max(4).superRefine((goals, context) => {
    hasNoDuplicates(goals, context, []);
  }),
  equipment: z.array(plainTextSchema(40)).max(5).superRefine((equipment, context) => {
    hasNoDuplicates(equipment, context, []);
  }),
  intensityCap: workoutIntensityCapSchema,
  parameterLimits: workoutPlanningParameterLimitsV2Schema,
  eligibility: workoutPlanningCandidateEligibilitySchema,
  publicGuidance: z.object({
    basisKind: z.literal('PUBLIC_GUIDANCE_NOT_INDIVIDUAL_REVIEW'),
    scopeVersion: z.literal('GENERAL_ADULT_19_64_V1'),
    phases: z.array(z.enum(['WARMUP', 'MAIN', 'COOLDOWN'])).min(1).max(3),
    rounds: z.number().int().min(1).max(3),
    reps: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).strict().nullable(),
    durationSeconds: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).strict().nullable(),
    sources: z.array(z.object({ publisher: plainTextSchema(100), url: z.url().startsWith('https://'), reviewedAt: z.iso.date(), accessedAt: z.iso.date(), summary: plainTextSchema(600), summaryHash: sha256Schema }).strict()).min(1).max(3),
    engineeringEstimates: plainTextSchema(400),
  }).strict().optional(),
}).strict().superRefine((candidate, context) => {
  if (candidate.sourceKind === 'INTERNAL_STARTER' && candidate.eligibility.policyRef === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['eligibility', 'policyRef'], message: 'Internal starter candidates require a policy reference' });
  }
  if (candidate.sourceKind === 'EXTERNAL_DATASET' && candidate.eligibility.reviewRef === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['eligibility', 'reviewRef'], message: 'External dataset candidates require a review reference' });
  }
});

export const workoutPlanningCandidateReferenceV2Schema = z.object({
  citationId: sha256Schema,
  sourceKind: workoutPlanningCandidateSourceKindSchema,
  source: plainTextSchema(240),
  version: plainTextSchema(120),
  hash: sha256Schema,
  itemHash: sha256Schema,
}).strict();

export const workoutPlanningSchedulingV2Schema = workoutSchedulingInputSchema.superRefine((scheduling, context) => {
  const hasEarliest = scheduling.earliestStartLocalTime !== null;
  const hasLatest = scheduling.latestEndLocalTime !== null;
  if (hasEarliest !== hasLatest) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A planning time window requires both endpoints' });
  }
});

const bodyMeasurementSchema = z.object({
  value: z.number().finite().positive().max(1_000),
  unit: z.enum(['KG', 'LB', 'CM', 'IN']),
}).strict();

export const workoutPlanningProfileV2Schema = z.object({
  version: z.number().int().positive(),
  goals: z.array(workoutGoalSchema).min(1).max(4).superRefine((goals, context) => {
    hasNoDuplicates(goals, context, []);
  }),
  experience: z.enum(['UNKNOWN', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  weeklyTrainingDays: z.number().int().min(0).max(14),
  availableEquipment: z.array(plainTextSchema(40)).max(5).superRefine((equipment, context) => {
    hasNoDuplicates(equipment, context, []);
  }),
  bodyMeasurements: z.object({
    weight: bodyMeasurementSchema.nullable(),
    height: bodyMeasurementSchema.nullable(),
  }).strict(),
  fitnessDescription: plainTextSchema(500).nullable(),
  limitations: z.union([z.literal('UNKNOWN'), z.array(plainTextSchema(200)).max(5)]),
  limitationsComplete: z.boolean(),
  generalExerciseScope: z.literal('GENERAL_ADULT_19_64_V1').nullable().optional(),
}).strict().superRefine((profile, context) => {
  if (profile.limitations === 'UNKNOWN' && profile.limitationsComplete) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['limitationsComplete'], message: 'Unknown limitations cannot be complete' });
  }
  if (profile.bodyMeasurements.weight?.unit === 'CM' || profile.bodyMeasurements.weight?.unit === 'IN') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bodyMeasurements', 'weight', 'unit'], message: 'Weight requires KG or LB' });
  }
  if (profile.bodyMeasurements.height?.unit === 'KG' || profile.bodyMeasurements.height?.unit === 'LB') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bodyMeasurements', 'height', 'unit'], message: 'Height requires CM or IN' });
  }
});

export const workoutPlanningAuthorizationV2Schema = z.object({
  disclosureVersion: z.literal('HEALTH_DISCLOSURE_V2'),
  allowedFields: planningAllowedFieldsSchema,
  selectedFitnessMemoryIds: z.array(uuidSchema).max(2).superRefine((ids, context) => {
    hasNoDuplicates(ids, context, []);
  }),
}).strict();

export const workoutPlanningCheckInV2Schema = z.object({
  id: uuidSchema,
  version: z.number().int().positive(),
  localDate: z.iso.date(),
  hasPain: z.boolean(),
  acuteRisk: z.boolean(),
  safety: workoutSafetyDecisionSchema,
}).strict();

export const workoutPlanningFeedbackContextV2Schema = z.object({
  workoutId: uuidSchema,
  revisionId: uuidSchema,
  feedbackId: uuidSchema,
  outcome: z.enum(['COMPLETED', 'SKIPPED']),
  perceivedEffort: z.number().int().min(1).max(10).nullable(),
  hadPain: z.boolean(),
  actualDurationSeconds: z.number().int().min(0).max(86_400).nullable(),
  note: plainTextSchema(200).nullable(),
}).strict();

export const workoutPlanningMemoryContextV2Schema = z.object({
  id: uuidSchema,
  content: plainTextSchema(2_000),
}).strict();

export const workoutPlanningInputV2Schema = z.object({
  schemaVersion: z.literal('WORKOUT_PLANNING_V2'),
  policyVersion: plainTextSchema(120),
  goal: workoutGoalSchema,
  scheduling: workoutPlanningSchedulingV2Schema,
  checkIn: workoutPlanningCheckInV2Schema,
  profile: workoutPlanningProfileV2Schema,
  authorization: workoutPlanningAuthorizationV2Schema,
  recentFeedback: z.array(workoutPlanningFeedbackContextV2Schema).max(5).default([]),
  selectedFitnessMemory: z.array(workoutPlanningMemoryContextV2Schema).max(2).default([]),
  candidates: z.array(workoutPlanningCandidateV2Schema).min(1).max(5).superRefine((candidates, context) => {
    hasNoDuplicates(candidates.map((candidate) => candidate.citationId), context, []);
  }),
}).strict().superRefine((input, context) => {
  if (!input.profile.goals.includes(input.goal)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['goal'], message: 'Goal must be selected by the profile' });
  }
  const allowedFields = input.authorization.allowedFields;
  if (!allowedFields.includes('PROFILE_GOALS')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorization', 'allowedFields'], message: 'Profile goals must be authorized for workout planning' });
  }
  if (!allowedFields.includes('PROFILE_EQUIPMENT')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorization', 'allowedFields'], message: 'Profile equipment must be authorized for workout planning' });
  }
  if (!allowedFields.includes('PROFILE_BODY_MEASUREMENTS')
    && (input.profile.bodyMeasurements.weight !== null || input.profile.bodyMeasurements.height !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profile', 'bodyMeasurements'], message: 'Unauthorized body measurements must be omitted' });
  }
  if (!allowedFields.includes('PROFILE_FITNESS_DESCRIPTION') && input.profile.fitnessDescription !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profile', 'fitnessDescription'], message: 'Unauthorized fitness description must be omitted' });
  }
  // `0` is the disclosure-safe sentinel for an unprovided weekly training count, never an inferred frequency.
  if (!allowedFields.includes('PROFILE_EXPERIENCE')
    && (input.profile.experience !== 'UNKNOWN' || input.profile.weeklyTrainingDays !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profile'], message: 'Unauthorized experience must be UNKNOWN with a zero weekly training count' });
  }
  if (input.selectedFitnessMemory.some((memory) => !input.authorization.selectedFitnessMemoryIds.includes(memory.id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedFitnessMemory'], message: 'Memory must be explicitly selected' });
  }
  if (input.selectedFitnessMemory.length > 0 && !input.authorization.allowedFields.includes('FITNESS_MEMORY')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorization', 'allowedFields'], message: 'Fitness memory was not authorized' });
  }
  if (input.recentFeedback.length > 0 && !input.authorization.allowedFields.includes('RECENT_FEEDBACK')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorization', 'allowedFields'], message: 'Recent feedback was not authorized' });
  }
  const memoryCharacters = input.selectedFitnessMemory.reduce((total, memory) => total + [...memory.content].length, 0);
  if (memoryCharacters > 2_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedFitnessMemory'], message: 'Fitness memory exceeds the context limit' });
  }
  if (utf8ByteLength(JSON.stringify(input)) > 24_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Planning context exceeds the UTF-8 byte limit' });
  }
});

export const workoutPlanPhaseV2Schema = z.enum(['WARMUP', 'MAIN', 'COOLDOWN']);
export const workoutPlanIntensityV2Schema = z.enum(['LOW', 'MODERATE']);

const workoutPlanItemV2Base = {
  citationId: sha256Schema,
  phase: workoutPlanPhaseV2Schema,
  rounds: z.number().int().min(1).max(5),
  restSeconds: z.number().int().min(0).max(600),
  transitionSeconds: z.number().int().min(0).max(120),
  intensity: workoutPlanIntensityV2Schema,
  reason: plainTextSchema(240),
};

export const workoutPlanItemV2Schema = z.union([
  z.object({
    ...workoutPlanItemV2Base,
    reps: z.number().int().min(1).max(50),
    durationSeconds: z.null(),
    secondsPerRep: z.number().int().min(1).max(10),
  }).strict(),
  z.object({
    ...workoutPlanItemV2Base,
    reps: z.null(),
    durationSeconds: z.number().int().min(30).max(1_800),
    secondsPerRep: z.null(),
  }).strict(),
]);

export const workoutPlanAlternativeV2Schema = z.object({
  replacesItemIndex: z.number().int().min(0).max(7),
  item: workoutPlanItemV2Schema,
  reason: plainTextSchema(240),
}).strict();

function validatePlanStructure(
  items: readonly { citationId: string; phase: string }[],
  alternatives: readonly { replacesItemIndex: number; item: { citationId: string; phase: string } }[],
  context: z.RefinementCtx,
): void {
  for (const phase of ['WARMUP', 'MAIN', 'COOLDOWN']) {
    if (!items.some((item) => item.phase === phase)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: `Plan requires ${phase}` });
    }
  }

  const phaseCitations = new Set<string>();
  for (const item of [...items, ...alternatives.map((alternative) => alternative.item)]) {
    const key = `${item.phase}\u0000${item.citationId}`;
    if (phaseCitations.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'A citation cannot repeat in the same phase' });
    }
    phaseCitations.add(key);
  }

  const replacedIndexes = alternatives.map((alternative) => alternative.replacesItemIndex);
  hasNoDuplicates(replacedIndexes.map(String), context, ['alternatives']);
  for (const alternative of alternatives) {
    const replaced = items[alternative.replacesItemIndex];
    if (replaced === undefined || alternative.item.phase !== replaced.phase || alternative.item.citationId === replaced.citationId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['alternatives'], message: 'Alternative must replace one item in the same phase with another citation' });
    }
  }

  const citationIds = [...items.map((item) => item.citationId), ...alternatives.map((alternative) => alternative.item.citationId)];
  if (new Set(citationIds).size > 5) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Plan cannot use more than five citations' });
  }
}

export const workoutPlanningOutputV2Schema = z.object({
  schemaVersion: z.literal('WORKOUT_PLAN_V2'),
  title: plainTextSchema(200),
  rationale: plainTextSchema(1_000),
  goal: workoutGoalSchema,
  items: z.array(workoutPlanItemV2Schema).min(3).max(8),
  alternatives: z.array(workoutPlanAlternativeV2Schema).max(2),
  totalDurationSeconds: z.number().int().min(1).max(7_200),
}).strict().superRefine((output, context) => {
  validatePlanStructure(output.items, output.alternatives, context);
});

const workoutContextReceiptV2Fields = {
  schemaVersion: z.literal('WORKOUT_PLANNING_V2'),
  contextHash: sha256Schema,
  disclosureVersion: z.literal('HEALTH_DISCLOSURE_V2'),
  allowedFields: planningAllowedFieldsSchema,
  checkInId: uuidSchema,
  checkInVersion: z.number().int().positive(),
  profileVersion: z.number().int().positive(),
  candidateReferences: z.array(workoutPlanningCandidateReferenceV2Schema).min(1).max(5).superRefine((candidates, context) => {
    hasNoDuplicates(candidates.map((candidate) => candidate.citationId), context, []);
  }),
};

export const workoutContextPreviewReceiptV2Schema = z.object({
  ...workoutContextReceiptV2Fields,
  previewedAt: z.iso.datetime(),
}).strict();

export const workoutContextReceiptV2Schema = z.object({
  ...workoutContextReceiptV2Fields,
  consentedAt: z.iso.datetime(),
}).strict();

export const previewWorkoutContextV2Schema = z.object({
  schemaVersion: z.literal('WORKOUT_PLANNING_V2'),
  goal: workoutGoalSchema,
  scheduling: workoutPlanningSchedulingV2Schema,
  checkInId: uuidSchema,
  expectedCheckInVersion: z.number().int().positive(),
  expectedProfileVersion: z.number().int().positive(),
  authorization: workoutPlanningAuthorizationV2Schema,
  candidateCitationIds: z.array(sha256Schema).min(1).max(5).superRefine((citationIds, context) => {
    hasNoDuplicates(citationIds, context, []);
  }),
}).strict();

export const workoutContextPreviewV2Schema = z.object({
  schemaVersion: z.literal('WORKOUT_PLANNING_V2'),
  payload: workoutPlanningInputV2Schema,
  contextHash: sha256Schema,
  previewReceipt: workoutContextPreviewReceiptV2Schema,
  fieldCounts: z.object({
    feedback: z.number().int().min(0).max(5),
    fitnessMemory: z.number().int().min(0).max(2),
    candidates: z.number().int().min(1).max(5),
    utf8Bytes: z.number().int().min(1).max(24_000),
  }).strict(),
}).strict().superRefine((preview, context) => {
  if (preview.contextHash !== preview.previewReceipt.contextHash) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['previewReceipt', 'contextHash'], message: 'Preview receipt hash must match preview hash' });
  }
  if (preview.previewReceipt.disclosureVersion !== preview.payload.authorization.disclosureVersion
    || !hasSameValues(preview.previewReceipt.allowedFields, preview.payload.authorization.allowedFields)
    || preview.previewReceipt.checkInId !== preview.payload.checkIn.id
    || preview.previewReceipt.checkInVersion !== preview.payload.checkIn.version
    || preview.previewReceipt.profileVersion !== preview.payload.profile.version) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['previewReceipt'], message: 'Preview receipt must match the payload authorization and versions' });
  }
  if (preview.fieldCounts.feedback !== preview.payload.recentFeedback.length
    || preview.fieldCounts.fitnessMemory !== preview.payload.selectedFitnessMemory.length
    || preview.fieldCounts.candidates !== preview.payload.candidates.length
    || preview.fieldCounts.utf8Bytes !== utf8ByteLength(JSON.stringify(preview.payload))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['fieldCounts'], message: 'Preview counts must match the actual payload' });
  }
  const candidatesByCitation = new Map(preview.payload.candidates.map((candidate) => [candidate.citationId, candidate]));
  if (preview.previewReceipt.candidateReferences.length !== preview.payload.candidates.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['previewReceipt', 'candidateReferences'], message: 'Preview receipt must include every frozen candidate' });
  }
  for (const reference of preview.previewReceipt.candidateReferences) {
    const candidate = candidatesByCitation.get(reference.citationId);
    if (candidate === undefined
      || candidate.sourceKind !== reference.sourceKind
      || candidate.source !== reference.source
      || candidate.version !== reference.version
      || candidate.hash !== reference.hash
      || candidate.itemHash !== reference.itemHash) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['previewReceipt', 'candidateReferences'], message: 'Preview receipt candidates must match the frozen payload' });
    }
  }
});

export const createDetailedWorkoutV2Schema = z.object({
  schemaVersion: z.literal('WORKOUT_PLANNING_V2'),
  goal: workoutGoalSchema,
  scheduling: workoutPlanningSchedulingV2Schema,
  checkInId: uuidSchema,
  expectedCheckInVersion: z.number().int().positive(),
  expectedProfileVersion: z.number().int().positive(),
  disclosureVersion: z.literal('HEALTH_DISCLOSURE_V2'),
  contextHash: sha256Schema,
  allowedFields: planningAllowedFieldsSchema,
  consentedAt: z.iso.datetime(),
}).strict();

export const workoutRevisionV2Schema = z.object({
  id: uuidSchema,
  workoutId: uuidSchema,
  parentRevisionId: uuidSchema.nullable(),
  revisionNo: z.number().int().positive(),
  schemaVersion: z.literal('WORKOUT_PLAN_V2'),
  title: plainTextSchema(200),
  rationale: plainTextSchema(1_000),
  goal: workoutGoalSchema,
  items: z.array(workoutPlanItemV2Schema).min(3).max(8),
  alternatives: z.array(workoutPlanAlternativeV2Schema).max(2),
  scheduling: workoutPlanningSchedulingV2Schema,
  provenance: z.array(workoutProvenanceSchema).min(1).max(10),
  contextReceipt: workoutContextReceiptV2Schema,
  policyVersion: plainTextSchema(120),
  contentHash: sha256Schema,
  createdAt: z.iso.datetime(),
}).strict().superRefine((revision, context) => {
  validatePlanStructure(revision.items, revision.alternatives, context);
});

export const reviseDetailedWorkoutV2Schema = z.object({
  expectedVersion: z.number().int().positive(),
  parentRevisionId: uuidSchema,
  title: plainTextSchema(200),
  rationale: plainTextSchema(1_000),
  goal: workoutGoalSchema,
  items: z.array(workoutPlanItemV2Schema).min(3).max(8),
  alternatives: z.array(workoutPlanAlternativeV2Schema).max(2),
  scheduling: workoutPlanningSchedulingV2Schema,
  contextReceipt: workoutContextReceiptV2Schema,
  policyVersion: plainTextSchema(120),
}).strict().superRefine((revision, context) => {
  validatePlanStructure(revision.items, revision.alternatives, context);
});

export const detailedWorkoutResultV2Schema = z.object({
  workoutId: uuidSchema,
  revision: workoutRevisionV2Schema,
  totalDurationSeconds: z.number().int().min(1).max(7_200),
}).strict();

export type WorkoutPlanningCandidateSourceKind = z.infer<typeof workoutPlanningCandidateSourceKindSchema>;
export type WorkoutPlanningCandidateEligibility = z.infer<typeof workoutPlanningCandidateEligibilitySchema>;
export type WorkoutPlanningParameterLimitsV2 = z.infer<typeof workoutPlanningParameterLimitsV2Schema>;
export type WorkoutPlanningCandidateV2 = z.infer<typeof workoutPlanningCandidateV2Schema>;
export type WorkoutPlanningCandidateReferenceV2 = z.infer<typeof workoutPlanningCandidateReferenceV2Schema>;
export type WorkoutPlanningSchedulingV2 = z.infer<typeof workoutPlanningSchedulingV2Schema>;
export type WorkoutPlanningProfileV2 = z.infer<typeof workoutPlanningProfileV2Schema>;
export type WorkoutPlanningAuthorizationV2 = z.infer<typeof workoutPlanningAuthorizationV2Schema>;
export type WorkoutPlanningCheckInV2 = z.infer<typeof workoutPlanningCheckInV2Schema>;
export type WorkoutPlanningFeedbackContextV2 = z.infer<typeof workoutPlanningFeedbackContextV2Schema>;
export type WorkoutPlanningMemoryContextV2 = z.infer<typeof workoutPlanningMemoryContextV2Schema>;
export type WorkoutPlanningInputV2 = z.infer<typeof workoutPlanningInputV2Schema>;
export type WorkoutPlanPhaseV2 = z.infer<typeof workoutPlanPhaseV2Schema>;
export type WorkoutPlanIntensityV2 = z.infer<typeof workoutPlanIntensityV2Schema>;
export type WorkoutPlanItemV2 = z.infer<typeof workoutPlanItemV2Schema>;
export type WorkoutPlanAlternativeV2 = z.infer<typeof workoutPlanAlternativeV2Schema>;
export type WorkoutPlanningOutputV2 = z.infer<typeof workoutPlanningOutputV2Schema>;
export type WorkoutContextPreviewReceiptV2 = z.infer<typeof workoutContextPreviewReceiptV2Schema>;
export type WorkoutContextReceiptV2 = z.infer<typeof workoutContextReceiptV2Schema>;
export type PreviewWorkoutContextV2 = z.infer<typeof previewWorkoutContextV2Schema>;
export type WorkoutContextPreviewV2 = z.infer<typeof workoutContextPreviewV2Schema>;
export type CreateDetailedWorkoutV2 = z.infer<typeof createDetailedWorkoutV2Schema>;
export type WorkoutRevisionV2 = z.infer<typeof workoutRevisionV2Schema>;
export type ReviseDetailedWorkoutV2 = z.infer<typeof reviseDetailedWorkoutV2Schema>;
export type DetailedWorkoutResultV2 = z.infer<typeof detailedWorkoutResultV2Schema>;
