import { createHash } from 'node:crypto';
import type { HealthTextProvider, NutritionFoodRecord } from '@ev/contracts';
import type { NutritionDataProvider } from '../src/modules/nutrition/provider';
import { canonicalJson } from '../src/modules/health-loop/repository';

export const V07_SYNTHETIC_DATASET_PREIMAGE = [{
  schemaVersion: 'NUTRITION_RECORD_V1' as const,
  source: {
    sourceKind: 'TEST_FIXTURE' as const,
    sourceId: 'ev-v07-synthetic-foods',
    sourceVersion: '1',
    redistribution: false as const,
    licenseDecisionId: null,
  },
  recordId: 'fixture-food-alpha',
  displayName: 'Fixture Food Alpha',
  serving: { quantityDecimal: '100', unit: 'GRAM' as const },
  nutrientsPerServing: {
    energyKcalDecimal: '100',
    proteinGramsDecimal: '10',
    carbohydrateGramsDecimal: '20',
    fatGramsDecimal: '5',
  },
}];

export function computeV07SyntheticHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export const V07_SYNTHETIC_DATASET_HASH = computeV07SyntheticHash(V07_SYNTHETIC_DATASET_PREIMAGE);
const source = {
  ...V07_SYNTHETIC_DATASET_PREIMAGE[0]!.source,
  datasetHash: V07_SYNTHETIC_DATASET_HASH,
};
export const V07_SYNTHETIC_RECORD_WITHOUT_HASH = {
  ...V07_SYNTHETIC_DATASET_PREIMAGE[0]!,
  source,
} satisfies Omit<NutritionFoodRecord, 'recordHash'>;
export const V07_SYNTHETIC_RECORD_HASH = computeV07SyntheticHash(V07_SYNTHETIC_RECORD_WITHOUT_HASH);

export function createV07HealthTestAdapters(): { healthTextProvider: HealthTextProvider; nutritionDataProvider: NutritionDataProvider } {
  const healthTextProvider: HealthTextProvider = {
    descriptor: { providerId: 'v07-test-fixture', providerLabel: 'V0.7 synthetic fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE' },
    async selectWorkout(input) { return { schemaVersion: 'WORKOUT_TEXT_SELECTION_V1', title: 'Fixture workout', rationale: 'Synthetic fixture only.', orderedCitationIds: input.catalog.slice(0, 2).map((item) => item.citationId) }; },
    async parseMealCandidates(input) {
      if (input.mealText !== 'Fixture Food Alpha 150 g') throw new Error('UNKNOWN_SYNTHETIC_MEAL');
      return { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }] };
    },
  };
  const nutritionDataProvider: NutritionDataProvider = {
    descriptor: { providerId: 'v07-test-fixture', providerLabel: 'V0.7 synthetic fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', source },
    async searchBatch(input) {
      if (input.queries.some((query) => query.query !== 'Fixture Food Alpha' || query.unit !== 'GRAM')) {
        throw new Error('UNKNOWN_SYNTHETIC_NUTRITION_QUERY');
      }
      return {
        groups: input.queries.map((query) => ({
          candidateId: query.candidateId,
          records: [{ ...V07_SYNTHETIC_RECORD_WITHOUT_HASH, recordHash: V07_SYNTHETIC_RECORD_HASH }],
        })),
      };
    },
  };
  return { healthTextProvider, nutritionDataProvider };
}
