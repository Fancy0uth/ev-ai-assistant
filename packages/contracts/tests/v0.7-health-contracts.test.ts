import { describe, expect, it } from 'vitest';
import {
  createFitnessCheckInSchema,
  createMealDraftSchema,
  createMealSchema,
  createWorkoutSchema,
  exerciseCitationSchema,
  exerciseCatalogItemSchema,
  exerciseCatalogManifestSchema,
  healthCapabilitiesResponseSchema,
  mealCandidateParseOutputSchema,
  nutritionFoodRecordSchema,
  nutritionSourceDescriptorSchema,
  canonicalDecimalSchema,
  workoutFeedbackSchema,
  workoutRevisionSchema,
  workoutSafetyDecisionSchema,
  workoutSchema,
  workoutListQuerySchema,
} from '../src/index';

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const hash = (character: string) => character.repeat(64);
const now = '2026-08-31T00:00:00.000Z';

const citation = {
  citationId: hash('a'),
  catalogId: 'ev-ai-internal-starter',
  catalogVersion: '2026.08.31.1',
  catalogHash: hash('b'),
  exerciseId: 'chair-sit-to-stand',
  itemHash: hash('c'),
  sourceKind: 'FIRST_PARTY_INTERNAL',
  redistribution: false,
};

const scheduling = {
  targetDate: '2026-09-01',
  durationMinutes: 30,
  priority: 'MEDIUM',
  earliestStartLocalTime: '18:00',
  latestEndLocalTime: '19:00',
};

describe('v0.7 health contracts', () => {
  it('models deterministic safety without diagnosis fields or permissive extra keys', () => {
    expect(createFitnessCheckInSchema.parse({
      localDate: '2026-09-01',
      sleepMinutes: 480,
      energyLevel: 3,
      discomfortLevel: 1,
      hasPain: false,
      acuteRisk: false,
    })).toMatchObject({ energyLevel: 3, acuteRisk: false });

    expect(workoutSafetyDecisionSchema.parse({
      eligibility: 'BLOCKED',
      notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP',
      reasonCodes: ['SELF_REPORTED_PAIN', 'SELF_REPORTED_ACUTE_RISK'],
      maxDurationMinutes: 0,
      intensityCap: 'NONE',
    }).eligibility).toBe('BLOCKED');
    expect(workoutSafetyDecisionSchema.parse({
      eligibility: 'ELIGIBLE',
      notice: 'NON_MEDICAL_RECOVERY_GUIDANCE',
      reasonCodes: ['RECOVERY_MODERATE'],
      maxDurationMinutes: 45,
      intensityCap: 'LOW',
    }).eligibility).toBe('ELIGIBLE');
    expect(workoutSafetyDecisionSchema.safeParse({
      eligibility: 'BLOCKED',
      notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP',
      reasonCodes: ['SELF_REPORTED_PAIN'],
      maxDurationMinutes: 0,
      intensityCap: 'NONE',
      diagnosis: 'not allowed',
    }).success).toBe(false);
    expect(createFitnessCheckInSchema.safeParse({
      localDate: '2026-09-01', sleepMinutes: 480, energyLevel: 3, discomfortLevel: 1, hasPain: false, acuteRisk: false, symptom: 'not allowed',
    }).success).toBe(false);
  });

  it('freezes first-party catalog provenance and unique manual citations', () => {
    expect(exerciseCatalogManifestSchema.parse({
      schemaVersion: 'EXERCISE_CATALOG_V1',
      catalogId: 'ev-ai-internal-starter',
      catalogVersion: '2026.08.31.1',
      source: {
        kind: 'FIRST_PARTY_INTERNAL',
        name: 'EV AI internal starter catalog',
        licenseId: null,
        redistribution: false,
        medicalClaims: false,
      },
      contentSha256: hash('d'),
      itemCount: 8,
    }).itemCount).toBe(8);
    expect(exerciseCatalogItemSchema.parse({
      exerciseId: citation.exerciseId,
      name: 'Chair sit to stand',
      neutralTechniqueText: 'Stand from a chair with controlled movement.',
      goals: ['STRENGTH', 'RECOVERY'],
      movementTags: ['SQUAT'],
      equipment: ['CHAIR'],
      impact: 'LOW',
      defaults: {
        LOW: { rounds: 2, reps: 6, durationSeconds: null, restSeconds: 60 },
        MODERATE: { rounds: 3, reps: 8, durationSeconds: null, restSeconds: 60 },
      },
    }).exerciseId).toBe('chair-sit-to-stand');
    expect(exerciseCitationSchema.parse(citation)).toEqual(citation);

    const manual = {
      mode: 'MANUAL',
      checkInId: id(1),
      expectedCheckInVersion: 1,
      goal: 'STRENGTH',
      availableEquipment: ['CHAIR'],
      citationIds: [citation.citationId],
      scheduling,
    };
    expect(createWorkoutSchema.parse(manual)).toEqual(manual);
    expect(createWorkoutSchema.safeParse({ ...manual, citationIds: [citation.citationId, citation.citationId] }).success).toBe(false);
    expect(createWorkoutSchema.safeParse({ ...manual, scheduling: { ...scheduling, latestEndLocalTime: '18:00' } }).success).toBe(false);
    expect(createWorkoutSchema.safeParse({ ...manual, unsafeExtra: true }).success).toBe(false);
  });

  it('keeps assisted creation disclosed and revisions structurally bounded', () => {
    expect(createWorkoutSchema.parse({
      mode: 'ASSISTED',
      checkInId: id(1),
      expectedCheckInVersion: 1,
      goal: 'RECOVERY',
      availableEquipment: [],
      disclosureVersion: 'HEALTH_DISCLOSURE_V1',
      scheduling,
    }).mode).toBe('ASSISTED');

    const revision = {
      id: id(2),
      workoutId: id(3),
      parentRevisionId: null,
      revisionNo: 1,
      title: 'Chair practice',
      rationale: 'Uses the selected internal items.',
      items: [{ citation, rounds: 2, reps: 6, durationSeconds: null, restSeconds: 60 }],
      scheduling,
      provenance: [{ kind: 'RULES', capabilityRunId: null, editedFields: [], capturedAt: now }],
      contentHash: hash('e'),
      createdAt: now,
    };
    expect(workoutRevisionSchema.parse(revision).revisionNo).toBe(1);
    expect(workoutRevisionSchema.safeParse({ ...revision, items: [{ ...revision.items[0], reps: 6, durationSeconds: 60 }] }).success).toBe(false);
    expect(workoutRevisionSchema.safeParse({ ...revision, items: [revision.items[0], revision.items[0]] }).success).toBe(false);
  });

  it('represents every workout state and makes feedback outcome-specific', () => {
    const base = {
      id: id(3), checkInId: id(1), signalId: id(4), currentRevisionId: id(2), generationMode: 'MANUAL', version: 1, createdAt: now, updatedAt: now,
    };
    const states = [
      { state: 'DRAFT', proposalId: null, actionId: null, timeRequestId: null, feedbackId: null },
      { state: 'PROPOSAL_PENDING', proposalId: id(5), actionId: null, timeRequestId: null, feedbackId: null },
      { state: 'ACCEPTED', proposalId: id(5), actionId: id(6), timeRequestId: id(7), feedbackId: null },
      { state: 'REJECTED', proposalId: id(5), actionId: null, timeRequestId: null, feedbackId: null },
      { state: 'COMPLETED', proposalId: id(5), actionId: id(6), timeRequestId: id(7), feedbackId: id(8) },
      { state: 'SKIPPED', proposalId: id(5), actionId: id(6), timeRequestId: id(7), feedbackId: id(8) },
    ];
    for (const state of states) expect(workoutSchema.parse({ ...base, ...state }).state).toBe(state.state);

    expect(workoutFeedbackSchema.parse({
      outcome: 'COMPLETED', expectedVersion: 2, hadPain: false, perceivedEffort: 4,
      startedAt: '2026-09-01T10:00:00.000Z', endedAt: '2026-09-01T10:20:00.000Z', note: null,
    }).outcome).toBe('COMPLETED');
    expect(workoutFeedbackSchema.safeParse({
      outcome: 'COMPLETED', expectedVersion: 2, hadPain: false, perceivedEffort: 4,
      startedAt: '2026-09-01T10:20:00.000Z', endedAt: '2026-09-01T10:00:00.000Z', note: null,
    }).success).toBe(false);
    expect(workoutFeedbackSchema.parse({
      outcome: 'SKIPPED', expectedVersion: 2, hadPain: true, perceivedEffort: null, startedAt: null, endedAt: null, note: 'Busy',
    }).outcome).toBe('SKIPPED');
  });

  it('uses strict canonical decimals and source lineage for v2 nutrition', () => {
    for (const invalid of ['+1', '-1', '1e3', '01', '1,5', '1.1234567']) {
      expect(canonicalDecimalSchema.safeParse(invalid).success).toBe(false);
    }
    expect(canonicalDecimalSchema.parse('100.25')).toBe('100.25');
    const fixtureSource = {
      sourceKind: 'TEST_FIXTURE', sourceId: 'ev-v07-synthetic-foods', sourceVersion: '1', datasetHash: hash('f'), redistribution: false, licenseDecisionId: null,
    };
    expect(nutritionSourceDescriptorSchema.parse(fixtureSource).sourceKind).toBe('TEST_FIXTURE');
    expect(nutritionSourceDescriptorSchema.safeParse({ ...fixtureSource, redistribution: true }).success).toBe(false);
    expect(nutritionSourceDescriptorSchema.safeParse({
      ...fixtureSource, sourceKind: 'APPROVED_LOCAL_DATASET', licenseDecisionId: null,
    }).success).toBe(false);
    expect(nutritionFoodRecordSchema.parse({
      schemaVersion: 'NUTRITION_RECORD_V1', source: fixtureSource, recordId: 'fixture-food-alpha', recordHash: hash('1'), displayName: 'Fixture Food Alpha',
      serving: { quantityDecimal: '100', unit: 'GRAM' },
      nutrientsPerServing: { energyKcalDecimal: '100', proteinGramsDecimal: '10', carbohydrateGramsDecimal: '20', fatGramsDecimal: '5' },
    }).serving.unit).toBe('GRAM');
  });

  it('keeps parser output nutrient-free and meal draft inputs discriminated', () => {
    const parsed = {
      schemaVersion: 'MEAL_CANDIDATE_PARSE_V1',
      candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }],
    };
    expect(mealCandidateParseOutputSchema.parse(parsed)).toEqual(parsed);
    expect(mealCandidateParseOutputSchema.safeParse({
      ...parsed, candidates: [{ ...parsed.candidates[0], proteinGramsDecimal: '15' }],
    }).success).toBe(false);
    expect(createMealDraftSchema.parse({
      mode: 'MANUAL', localDate: '2026-09-01', candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }],
    }).mode).toBe('MANUAL');
    expect(createMealDraftSchema.parse({
      mode: 'PARSE_TEXT', localDate: '2026-09-01', mealText: 'Fixture Food Alpha 150 g', disclosureVersion: 'HEALTH_DISCLOSURE_V1',
    }).mode).toBe('PARSE_TEXT');
    expect(createMealDraftSchema.safeParse({
      mode: 'MANUAL', localDate: '2026-09-01', candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM', calories: 150 }],
    }).success).toBe(false);
    expect(createMealDraftSchema.safeParse({
      mode: 'MANUAL', localDate: '2026-09-01', candidates: [
        { displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' },
        { displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' },
      ],
    }).success).toBe(false);
    expect(createMealSchema.parse({
      localDate: '2026-09-01', entries: [{ name: 'Legacy entry', grams: 100, calories: 100, proteinGrams: 10, carbohydrateGrams: 20, fatGrams: 5 }],
    }).entries).toHaveLength(1);
  });

  it('makes health capability descriptors exact and list query coercion bounded', () => {
    const response = {
      data: [
        { capability: 'WORKOUT_TEXT_SELECTION', availability: 'NOT_CONFIGURED', providerId: null, providerLabel: 'Not configured', adapterKind: 'NONE', evidenceKind: 'NONE', disclosureVersion: 'HEALTH_DISCLOSURE_V1', policyVersion: 'HEALTH_CAPABILITY_POLICY_V1', realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' },
        { capability: 'MEAL_CANDIDATE_PARSE', availability: 'NOT_CONFIGURED', providerId: null, providerLabel: 'Not configured', adapterKind: 'NONE', evidenceKind: 'NONE', disclosureVersion: 'HEALTH_DISCLOSURE_V1', policyVersion: 'HEALTH_CAPABILITY_POLICY_V1', realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' },
        { capability: 'NUTRITION_DATA_LOOKUP', availability: 'NOT_CONFIGURED', providerId: null, providerLabel: 'Not configured', adapterKind: 'NONE', evidenceKind: 'NONE', disclosureVersion: 'HEALTH_DISCLOSURE_V1', policyVersion: 'HEALTH_CAPABILITY_POLICY_V1', realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' },
      ],
    };
    expect(healthCapabilitiesResponseSchema.parse(response)).toEqual(response);
    expect(healthCapabilitiesResponseSchema.safeParse({ ...response, data: [...response.data, response.data[0]] }).success).toBe(false);
    expect(workoutListQuerySchema.parse({ page: '2', pageSize: '50', state: 'DRAFT' })).toEqual({ page: 2, pageSize: 50, state: 'DRAFT' });
    expect(workoutListQuerySchema.safeParse({ page: '1', pageSize: '51' }).success).toBe(false);
  });
});
