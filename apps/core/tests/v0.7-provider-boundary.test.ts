import type { HealthTextProvider, MealCandidateParseInput } from '@ev/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadInternalExerciseCatalog } from '../src/modules/fitness/catalog';
import { executeWorkoutTextSelection } from '../src/modules/fitness/service';
import { canonicalJson } from '../src/modules/health-loop/repository';
import { executeMealCandidateParse, executeNutritionSearchBatch, NutritionProviderError, type NutritionDataProvider } from '../src/modules/nutrition/provider';

const source = {
  sourceKind: 'TEST_FIXTURE',
  sourceId: 'v07-provider-boundary',
  sourceVersion: '1',
  datasetHash: 'a'.repeat(64),
  redistribution: false,
  licenseDecisionId: null,
} as const;
const catalogItem = loadInternalExerciseCatalog().items[0]!;

function ignoredSignalPromise(capture: (signal: AbortSignal) => void) {
  return (_input: unknown, signal: AbortSignal): Promise<unknown> => {
    capture(signal);
    return new Promise(() => undefined);
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('v0.7 Provider boundary', () => {
  it('rejects all three calls at eight seconds and aborts even when adapters ignore the signal', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const healthProvider: HealthTextProvider = {
      descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic ignored-signal fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE' },
      selectWorkout: ignoredSignalPromise((signal) => signals.push(signal)),
      parseMealCandidates: ignoredSignalPromise((signal) => signals.push(signal)),
    };
    const nutritionProvider: NutritionDataProvider = {
      descriptor: { providerId: 'v07-provider-boundary', providerLabel: 'Synthetic ignored-signal fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', source },
      searchBatch: ignoredSignalPromise((signal) => signals.push(signal)),
    };

    const calls = [
      executeWorkoutTextSelection({
        goal: 'RECOVERY', maxDurationMinutes: 30, intensityCap: 'LOW',
        catalog: [catalogItem],
      }, healthProvider),
      executeMealCandidateParse({ schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', mealText: '合成餐食', allowedUnits: ['GRAM', 'MILLILITER', 'ITEM'], maxCandidates: 30 }, healthProvider),
      executeNutritionSearchBatch({ queries: [{ candidateId: '00000000-0000-4000-8000-000000000001', query: '合成食物', unit: 'GRAM', limit: 5 }] }, nutritionProvider),
    ];
    expect(signals).toHaveLength(3);
    const states = Promise.all(calls.map((call) => call.then(() => 'fulfilled', () => 'rejected')));
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(states).resolves.toEqual(['rejected', 'rejected', 'rejected']);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('rejects canonical UTF-8 input over 24000 bytes before calling the adapter', async () => {
    let providerCalls = 0;
    const provider: NutritionDataProvider = {
      descriptor: { providerId: 'v07-provider-boundary', providerLabel: 'Synthetic input budget fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', source },
      async searchBatch() {
        providerCalls += 1;
        return { groups: [] };
      },
    };
    await expect(executeNutritionSearchBatch({
      queries: [{ candidateId: '00000000-0000-4000-8000-000000000002', query: '界'.repeat(8_001), unit: 'GRAM', limit: 5 }],
    }, provider)).rejects.toBeInstanceOf(NutritionProviderError);
    expect(providerCalls).toBe(0);
  });

  it('rejects canonical UTF-8 output over 12000 bytes even when its strict schema is valid', async () => {
    const provider: HealthTextProvider = {
      descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic output budget fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE' },
      async selectWorkout() { throw new Error('not used'); },
      async parseMealCandidates() {
        return {
          schemaVersion: 'MEAL_CANDIDATE_PARSE_V1',
          candidates: Array.from({ length: 30 }, (_, index) => ({
            displayName: `食材${String(index).padStart(2, '0')}${'界'.repeat(116)}`,
            quantityDecimal: String(index + 1),
            unit: 'GRAM',
          })),
        };
      },
    };
    await expect(executeMealCandidateParse(
      { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', mealText: '合成餐食', allowedUnits: ['GRAM', 'MILLILITER', 'ITEM'], maxCandidates: 30 },
      provider,
    )).rejects.toBeInstanceOf(NutritionProviderError);
  });

  it('reports exact canonical UTF-8 byte counts for accepted multibyte input and output', async () => {
    const input: MealCandidateParseInput = { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', mealText: '合成餐食一百克', allowedUnits: ['GRAM', 'MILLILITER', 'ITEM'], maxCandidates: 30 };
    const output = { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1' as const, candidates: [{ displayName: '合成食物', quantityDecimal: '100', unit: 'GRAM' as const }] };
    const provider: HealthTextProvider = {
      descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic UTF-8 fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE' },
      async selectWorkout() { throw new Error('not used'); },
      async parseMealCandidates() { return output; },
    };
    const result = await executeMealCandidateParse(input, provider);
    expect(result.inputBytes).toBe(new TextEncoder().encode(canonicalJson(input)).length);
    expect(result.outputBytes).toBe(new TextEncoder().encode(canonicalJson(output)).length);
    expect(result.inputBytes).toBeGreaterThan(canonicalJson(input).length);
    expect(result.outputBytes).toBeGreaterThan(canonicalJson(output).length);
  });

  it('rejects a schema-valid workout response with an unrequested citation', async () => {
    const provider: HealthTextProvider = {
      descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic correlation fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE' },
      async selectWorkout() {
        return { schemaVersion: 'WORKOUT_TEXT_SELECTION_V1', title: 'Fixture', rationale: 'Synthetic only.', orderedCitationIds: ['f'.repeat(64)] };
      },
      async parseMealCandidates() { throw new Error('not used'); },
    };
    await expect(executeWorkoutTextSelection({
      goal: 'RECOVERY', maxDurationMinutes: 30, intensityCap: 'LOW',
      catalog: [catalogItem],
    }, provider)).rejects.toThrow();
  });
});
