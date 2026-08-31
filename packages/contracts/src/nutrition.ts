import * as z from 'zod';
import { localDateSchema } from './tasks';

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const canonicalDecimalSchema = z.string().regex(/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$/);
export const positiveCanonicalDecimalSchema = canonicalDecimalSchema.refine((value) => value !== '0', '必须大于零');
export const servingUnitSchema = z.enum(['GRAM', 'MILLILITER', 'ITEM']);

const paginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(50),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
}).strict();

const noDuplicate = (values: readonly string[], context: z.RefinementCtx, path: PropertyKey[]) => {
  if (new Set(values).size !== values.length) context.addIssue({ code: z.ZodIssueCode.custom, path, message: '值不能重复' });
};

export const nutritionDecimalTotalsSchema = z.object({
  energyKcalDecimal: canonicalDecimalSchema,
  proteinGramsDecimal: canonicalDecimalSchema,
  carbohydrateGramsDecimal: canonicalDecimalSchema,
  fatGramsDecimal: canonicalDecimalSchema,
}).strict();

export const nutritionSourceDescriptorSchema = z.discriminatedUnion('sourceKind', [
  z.object({
    sourceKind: z.literal('TEST_FIXTURE'),
    sourceId: z.string().trim().min(1).max(120),
    sourceVersion: z.string().trim().min(1).max(120),
    datasetHash: sha256Schema,
    redistribution: z.literal(false),
    licenseDecisionId: z.null(),
  }).strict(),
  z.object({
    sourceKind: z.literal('APPROVED_LOCAL_DATASET'),
    sourceId: z.string().trim().min(1).max(120),
    sourceVersion: z.string().trim().min(1).max(120),
    datasetHash: sha256Schema,
    redistribution: z.boolean(),
    licenseDecisionId: z.string().trim().min(1).max(120),
  }).strict(),
  z.object({
    sourceKind: z.literal('REMOTE_API'),
    sourceId: z.string().trim().min(1).max(120),
    sourceVersion: z.string().trim().min(1).max(120),
    datasetHash: sha256Schema,
    redistribution: z.boolean(),
    licenseDecisionId: z.string().trim().min(1).max(120),
  }).strict(),
]);

export const nutritionFoodRecordSchema = z.object({
  schemaVersion: z.literal('NUTRITION_RECORD_V1'),
  source: nutritionSourceDescriptorSchema,
  recordId: z.string().trim().min(1).max(200),
  recordHash: sha256Schema,
  displayName: z.string().trim().min(1).max(120),
  serving: z.object({ quantityDecimal: positiveCanonicalDecimalSchema, unit: servingUnitSchema }).strict(),
  nutrientsPerServing: nutritionDecimalTotalsSchema,
}).strict();

export const manualMealCandidateInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  quantityDecimal: positiveCanonicalDecimalSchema,
  unit: servingUnitSchema,
}).strict();

const uniqueManualCandidatesSchema = z.array(manualMealCandidateInputSchema).min(1).max(30).superRefine((candidates, context) => {
  const keys = candidates.map((candidate) => `${candidate.displayName.toLocaleLowerCase('en-US')}\n${candidate.quantityDecimal}\n${candidate.unit}`);
  noDuplicate(keys, context, []);
});

export const mealCandidateSchema = manualMealCandidateInputSchema.extend({
  candidateId: z.uuid(),
  included: z.boolean(),
  selectedFoodSnapshotId: z.uuid().nullable(),
  provenance: z.array(z.object({
    kind: z.enum(['MODEL_PARSE', 'OWNER_EDIT', 'DATA_MATCH']),
    capabilityRunId: z.uuid().nullable(),
    editedFields: z.array(z.string().trim().min(1).max(100)).max(30),
    capturedAt: z.iso.datetime(),
  }).strict()).min(1).max(10),
}).strict();

export const createMealDraftSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('MANUAL'), localDate: localDateSchema, candidates: uniqueManualCandidatesSchema }).strict(),
  z.object({ mode: z.literal('PARSE_TEXT'), localDate: localDateSchema, mealText: z.string().trim().min(1).max(1000), disclosureVersion: z.literal('HEALTH_DISCLOSURE_V1') }).strict(),
]);

export const mealDraftStateSchema = z.enum(['CANDIDATES_READY', 'MATCHES_READY', 'CONFIRMED']);
const mealDraftBase = z.object({
  id: z.uuid(), localDate: localDateSchema, mode: z.enum(['MANUAL', 'PARSE_TEXT']), originalText: z.string().min(1).max(1000).nullable(),
  currentRevisionId: z.uuid(), version: z.number().int().positive(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export const mealDraftSchema = z.discriminatedUnion('state', [
  mealDraftBase.extend({ state: z.literal('CANDIDATES_READY'), confirmedMealId: z.null() }).strict(),
  mealDraftBase.extend({ state: z.literal('MATCHES_READY'), confirmedMealId: z.null() }).strict(),
  mealDraftBase.extend({ state: z.literal('CONFIRMED'), confirmedMealId: z.uuid() }).strict(),
]);

export const mealRevisionSchema = z.object({
  id: z.uuid(), draftId: z.uuid(), parentRevisionId: z.uuid().nullable(), revisionNo: z.number().int().positive(),
  candidates: z.array(mealCandidateSchema).min(1).max(30).superRefine((candidates, context) => noDuplicate(candidates.map((candidate) => candidate.candidateId), context, [])),
  contentHash: sha256Schema, createdBy: z.enum(['PARSER', 'OWNER', 'DATA_PROVIDER']), capabilityRunId: z.uuid().nullable(), createdAt: z.iso.datetime(),
}).strict();

export const replaceMealCandidatesRevisionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  parentRevisionId: z.uuid(),
  operation: z.literal('REPLACE_CANDIDATES'),
  candidates: uniqueManualCandidatesSchema,
}).strict();
export const selectMealMatchesRevisionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  parentRevisionId: z.uuid(),
  operation: z.literal('SELECT_MATCHES'),
  candidates: z.array(z.object({ candidateId: z.uuid(), selectedFoodSnapshotId: z.uuid().nullable(), included: z.boolean() }).strict()).min(1).max(30)
    .superRefine((candidates, context) => noDuplicate(candidates.map((candidate) => candidate.candidateId), context, [])),
}).strict();
export const reviseMealDraftSchema = z.discriminatedUnion('operation', [replaceMealCandidatesRevisionSchema, selectMealMatchesRevisionSchema]);

export const nutritionFoodSnapshotSchema = z.object({
  id: z.uuid(), candidateId: z.uuid(), source: nutritionSourceDescriptorSchema, record: nutritionFoodRecordSchema,
  capabilityRunId: z.uuid(), createdAt: z.iso.datetime(),
}).strict();
export const mealCandidateMatchSchema = z.object({
  candidateId: z.uuid(), status: z.enum(['MATCHED', 'AMBIGUOUS', 'UNMATCHED']), snapshots: z.array(nutritionFoodSnapshotSchema).max(5),
}).strict();
export const matchMealDraftSchema = z.object({ expectedVersion: z.number().int().positive(), revisionId: z.uuid() }).strict();
export const confirmMealDraftSchema = z.object({ expectedVersion: z.number().int().positive(), revisionId: z.uuid() }).strict();

export const mealEntryV2Schema = z.object({
  candidateId: z.uuid(), foodSnapshotId: z.uuid(), displayName: z.string().trim().min(1).max(120), quantityDecimal: positiveCanonicalDecimalSchema, unit: servingUnitSchema,
  energyKcalDecimal: canonicalDecimalSchema, proteinGramsDecimal: canonicalDecimalSchema, carbohydrateGramsDecimal: canonicalDecimalSchema, fatGramsDecimal: canonicalDecimalSchema,
  lineage: z.array(z.object({ entityType: z.enum(['MEAL_DRAFT', 'MEAL_REVISION', 'FOOD_SNAPSHOT', 'MEAL']), entityId: z.uuid(), entityVersion: z.number().int().positive(), contentHash: sha256Schema.nullable() }).strict()).min(1).max(10),
}).strict();
export const mealV2Schema = z.object({
  id: z.uuid(), draftId: z.uuid(), localDate: localDateSchema, entries: z.array(mealEntryV2Schema).min(1).max(30), totals: nutritionDecimalTotalsSchema,
  calculationVersion: z.literal('DECIMAL_MICRO_V1'), version: z.literal(1), createdAt: z.iso.datetime(),
}).strict();

export const mealDraftPathParamsSchema = z.object({ id: z.uuid() }).strict();
export const mealPathParamsSchema = z.object({ id: z.uuid() }).strict();
export const mealDraftListQuerySchema = z.object({ state: mealDraftStateSchema.optional(), localDate: localDateSchema.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const mealV2ListQuerySchema = z.object({ localDate: localDateSchema.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const mealDraftCreateResponseSchema = z.object({ data: z.object({ draft: mealDraftSchema, revision: mealRevisionSchema, disclosure: z.unknown().nullable() }).strict() }).strict();
export const mealDraftRevisionResponseSchema = z.object({ data: z.object({ draft: mealDraftSchema, revision: mealRevisionSchema }).strict() }).strict();
export const mealDraftMatchResponseSchema = z.object({ data: z.object({ draft: mealDraftSchema, revision: mealRevisionSchema, matches: z.array(mealCandidateMatchSchema), source: nutritionSourceDescriptorSchema }).strict() }).strict();
export const mealConfirmResponseSchema = z.object({ data: z.object({ draft: mealDraftSchema, meal: mealV2Schema }).strict() }).strict();
export const mealDraftListResponseSchema = z.object({ data: z.object({ items: z.array(mealDraftSchema), pagination: paginationSchema }).strict() }).strict();
export const mealDraftDetailResponseSchema = z.object({ data: z.object({ draft: mealDraftSchema, revision: mealRevisionSchema, matches: z.array(mealCandidateMatchSchema), confirmedMeal: mealV2Schema.nullable() }).strict() }).strict();
export const mealV2ListResponseSchema = z.object({ data: z.object({ items: z.array(mealV2Schema), pagination: paginationSchema }).strict() }).strict();
export const mealV2ResponseSchema = z.object({ data: mealV2Schema }).strict();

/** @deprecated Legacy owner-confirmed unsourced numeric input. */
export const confirmedMealEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    grams: z.number().positive().max(5000),
    calories: z.number().nonnegative().max(20000),
    proteinGrams: z.number().nonnegative().max(1000),
    carbohydrateGrams: z.number().nonnegative().max(3000),
    fatGrams: z.number().nonnegative().max(1000),
  })
  .strict();

/** @deprecated Legacy owner-confirmed unsourced numeric input. */
export const createMealSchema = z
  .object({
    localDate: localDateSchema,
    entries: z.array(confirmedMealEntrySchema).min(1).max(30),
  })
  .strict();

/** @deprecated Legacy owner-confirmed unsourced numeric input. */
export const mealRecordSchema = z
  .object({
    id: z.uuid(),
    localDate: localDateSchema,
    entries: z.array(confirmedMealEntrySchema).min(1),
    totals: z
      .object({
        calories: z.number().nonnegative(),
        proteinGrams: z.number().nonnegative(),
        carbohydrateGrams: z.number().nonnegative(),
        fatGrams: z.number().nonnegative(),
      })
      .strict(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const mealRecordResponseSchema = z.object({ data: mealRecordSchema }).strict();

/** @deprecated Legacy owner-confirmed unsourced numeric input. */
export type CreateMealInput = z.infer<typeof createMealSchema>;
/** @deprecated Legacy owner-confirmed unsourced numeric input. */
export type MealRecord = z.infer<typeof mealRecordSchema>;
export type CanonicalDecimal = z.infer<typeof canonicalDecimalSchema>;
export type ServingUnit = z.infer<typeof servingUnitSchema>;
export type NutritionSourceDescriptor = z.infer<typeof nutritionSourceDescriptorSchema>;
export type NutritionFoodRecord = z.infer<typeof nutritionFoodRecordSchema>;
export type MealCandidate = z.infer<typeof mealCandidateSchema>;
export type MealDraft = z.infer<typeof mealDraftSchema>;
export type MealRevision = z.infer<typeof mealRevisionSchema>;
export type MealV2 = z.infer<typeof mealV2Schema>;
