import * as z from 'zod';
import { positiveCanonicalDecimalSchema, servingUnitSchema } from './nutrition';

export const healthCapabilityKindSchema = z.enum(['WORKOUT_TEXT_SELECTION', 'MEAL_CANDIDATE_PARSE', 'NUTRITION_DATA_LOOKUP']);
export const healthAdapterKindSchema = z.enum(['NONE', 'TEST_FIXTURE', 'APPROVED_LOCAL_DATASET', 'PRODUCTION_ADAPTER']);
export const healthEvidenceKindSchema = z.enum(['NONE', 'AUTOMATED_TEST_FIXTURE', 'APPROVED_LOCAL_DATASET', 'REAL_PROVIDER']);
export const healthCapabilityAvailabilitySchema = z.enum(['READY', 'NOT_CONFIGURED']);
export const healthDisclosureVersionSchema = z.literal('HEALTH_DISCLOSURE_V1');
export const healthCapabilityPolicyVersionSchema = z.literal('HEALTH_CAPABILITY_POLICY_V1');
export const realEvidenceStatusSchema = z.enum(['NOT_RUN_APPROVAL_REQUIRED', 'AVAILABLE']);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const providerDescriptorSchema = z.object({
  providerId: z.string().trim().min(1).max(120).nullable(),
  providerLabel: z.string().trim().min(1).max(120),
  adapterKind: healthAdapterKindSchema,
  evidenceKind: healthEvidenceKindSchema,
}).strict();

export const healthCapabilityDescriptorSchema = providerDescriptorSchema.extend({
  capability: healthCapabilityKindSchema,
  availability: healthCapabilityAvailabilitySchema,
  disclosureVersion: healthDisclosureVersionSchema,
  policyVersion: healthCapabilityPolicyVersionSchema,
  realEvidenceStatus: realEvidenceStatusSchema,
}).strict().superRefine((descriptor, context) => {
  if (descriptor.availability === 'NOT_CONFIGURED'
    && (descriptor.providerId !== null || descriptor.adapterKind !== 'NONE' || descriptor.evidenceKind !== 'NONE')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '未配置能力不能声明 Provider 或证据' });
  }
  if (descriptor.availability === 'READY' && descriptor.providerId === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['providerId'], message: '可用能力必须声明 Provider' });
  }
});

const capabilityFor = (capability: z.infer<typeof healthCapabilityKindSchema>) => healthCapabilityDescriptorSchema.refine(
  (descriptor) => descriptor.capability === capability,
  `能力必须是 ${capability}`,
);

export const healthCapabilitiesResponseSchema = z.object({
  data: z.tuple([
    capabilityFor('WORKOUT_TEXT_SELECTION'),
    capabilityFor('MEAL_CANDIDATE_PARSE'),
    capabilityFor('NUTRITION_DATA_LOOKUP'),
  ]),
}).strict();

export const workoutTextSelectionInputSchema = z.object({
  schemaVersion: z.literal('WORKOUT_TEXT_SELECTION_V1'),
  goal: z.enum(['MOBILITY', 'STRENGTH', 'ENDURANCE', 'RECOVERY']),
  maxDurationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  intensityCap: z.enum(['LOW', 'MODERATE']),
  catalog: z.array(z.object({
    citationId: sha256Schema,
    name: z.string().trim().min(1).max(120),
    neutralTechniqueText: z.string().trim().min(1).max(600),
    tags: z.array(z.string().trim().min(1).max(40)).max(8),
  }).strict()).min(1).max(5),
}).strict();

export const workoutTextSelectionOutputSchema = z.object({
  schemaVersion: z.literal('WORKOUT_TEXT_SELECTION_V1'),
  title: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(1000),
  orderedCitationIds: z.array(sha256Schema).min(1).max(5).superRefine((citationIds, context) => {
    if (new Set(citationIds).size !== citationIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '引用不能重复' });
  }),
}).strict();

export const mealCandidateParseInputSchema = z.object({
  schemaVersion: z.literal('MEAL_CANDIDATE_PARSE_V1'),
  mealText: z.string().trim().min(1).max(1000),
  allowedUnits: z.tuple([z.literal('GRAM'), z.literal('MILLILITER'), z.literal('ITEM')]),
  maxCandidates: z.literal(30),
}).strict();

export const mealCandidateParseOutputSchema = z.object({
  schemaVersion: z.literal('MEAL_CANDIDATE_PARSE_V1'),
  candidates: z.array(z.object({
    displayName: z.string().trim().min(1).max(120),
    quantityDecimal: positiveCanonicalDecimalSchema,
    unit: servingUnitSchema,
  }).strict()).min(1).max(30).superRefine((candidates, context) => {
    const keys = candidates.map((candidate) => `${candidate.displayName.toLocaleLowerCase('en-US')}\n${candidate.quantityDecimal}\n${candidate.unit}`);
    if (new Set(keys).size !== keys.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '候选不能重复' });
  }),
}).strict();

export interface HealthTextProvider {
  readonly descriptor: {
    providerId: 'deepseek' | 'v07-test-fixture';
    providerLabel: string;
    adapterKind: 'TEST_FIXTURE' | 'PRODUCTION_ADAPTER';
    evidenceKind: 'AUTOMATED_TEST_FIXTURE' | 'REAL_PROVIDER';
  };
  selectWorkout(input: WorkoutTextSelectionInput, signal: AbortSignal): Promise<unknown>;
  parseMealCandidates(input: MealCandidateParseInput, signal: AbortSignal): Promise<unknown>;
}

export type HealthCapabilityKind = z.infer<typeof healthCapabilityKindSchema>;
export type HealthAdapterKind = z.infer<typeof healthAdapterKindSchema>;
export type HealthEvidenceKind = z.infer<typeof healthEvidenceKindSchema>;
export type HealthCapabilityDescriptor = z.infer<typeof healthCapabilityDescriptorSchema>;
export type WorkoutTextSelectionInput = z.infer<typeof workoutTextSelectionInputSchema>;
export type WorkoutTextSelectionOutput = z.infer<typeof workoutTextSelectionOutputSchema>;
export type MealCandidateParseInput = z.infer<typeof mealCandidateParseInputSchema>;
export type MealCandidateParseOutput = z.infer<typeof mealCandidateParseOutputSchema>;
