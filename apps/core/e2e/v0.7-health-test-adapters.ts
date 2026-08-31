import { createHash } from 'node:crypto';
import type { HealthTextProvider } from '@ev/contracts';
import type { NutritionDataProvider } from '../src/modules/nutrition/provider';
import { canonicalJson } from '../src/modules/health-loop/repository';

const source = { sourceKind: 'TEST_FIXTURE' as const, sourceId: 'ev-v07-synthetic-foods', sourceVersion: '1', datasetHash: createHash('sha256').update(canonicalJson(['Fixture Food Alpha'])).digest('hex'), redistribution: false as const, licenseDecisionId: null };

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
      return { groups: input.queries.map((query) => {
        const withoutHash = { schemaVersion: 'NUTRITION_RECORD_V1' as const, source, recordId: 'fixture-food-alpha', displayName: 'Fixture Food Alpha', serving: { quantityDecimal: '100', unit: 'GRAM' as const }, nutrientsPerServing: { energyKcalDecimal: '100', proteinGramsDecimal: '10', carbohydrateGramsDecimal: '20', fatGramsDecimal: '5' } };
        return { candidateId: query.candidateId, records: [{ ...withoutHash, recordHash: createHash('sha256').update(canonicalJson(withoutHash)).digest('hex') }] };
      }) };
    },
  };
  return { healthTextProvider, nutritionDataProvider };
}
