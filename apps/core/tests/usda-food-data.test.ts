import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/modules/health-loop/repository';
import {
  createUsdaNutritionDataProvider,
  usdaNutritionDataDescriptor,
} from '../src/modules/nutrition/usda-food-data';

const candidateIds = {
  gram: '00000000-0000-4000-8000-000000000001',
  milliliter: '00000000-0000-4000-8000-000000000002',
  item: '00000000-0000-4000-8000-000000000003',
  incomplete: '00000000-0000-4000-8000-000000000004',
} as const;

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function nutrients(values: { energy: number; protein: number; carbohydrate: number; fat?: number }) {
  return [
    { amount: values.energy, nutrient: { number: '208', unitName: 'KCAL' } },
    { amount: values.protein, nutrient: { number: '203', unitName: 'G' } },
    { amount: values.carbohydrate, nutrient: { number: '205', unitName: 'G' } },
    ...(values.fat === undefined ? [] : [{ amount: values.fat, nutrient: { number: '204', unitName: 'G' } }]),
  ];
}

describe('USDA FoodData Central nutrition adapter', () => {
  it('returns only fully evidenced gram or gram-weight item records, with safe transport controls', async () => {
    const requests: URL[] = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    const provider = createUsdaNutritionDataProvider({
      apiKey: 'test-api-key',
      fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        requests.push(url);
        expect(url.origin).toBe('https://api.nal.usda.gov');
        expect(init?.redirect).toBe('error');
        expect(init?.credentials).toBe('omit');
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(url.searchParams.get('api_key')).toBe('test-api-key');

        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        try {
          await Promise.resolve();
          if (url.pathname === '/fdc/v1/foods/search') {
            const query = url.searchParams.get('query');
            expect(url.searchParams.getAll('dataType')).toEqual(['Foundation', 'SR Legacy']);
            expect(url.searchParams.get('pageSize')).toBe('5');
            if (query === 'SR Legacy gram food') return response({ foods: [{ fdcId: 100, dataType: 'SR Legacy', description: 'SR Legacy gram food' }] });
            if (query === 'Foundation item food') return response({ foods: [{ fdcId: 101, dataType: 'Foundation', description: 'Foundation item food' }] });
            if (query === 'Incomplete food') return response({ foods: [{ fdcId: 102, dataType: 'Foundation', description: 'Incomplete food' }] });
            return response({ foods: [] });
          }
          if (url.pathname === '/fdc/v1/food/100') {
            return response({
              fdcId: 100,
              dataType: 'SR Legacy',
              description: 'SR Legacy gram food',
              foodNutrients: nutrients({ energy: 100, protein: 10, carbohydrate: 20, fat: 5 }),
            });
          }
          if (url.pathname === '/fdc/v1/food/101') {
            return response({
              fdcId: 101,
              dataType: 'Foundation',
              description: 'Foundation item food',
              foodNutrients: nutrients({ energy: 200, protein: 12, carbohydrate: 10, fat: 4 }),
              foodPortions: [{ id: 7, amount: 1, gramWeight: 50, portionDescription: '1 patty' }],
            });
          }
          if (url.pathname === '/fdc/v1/food/102') {
            return response({
              fdcId: 102,
              dataType: 'Foundation',
              description: 'Incomplete food',
              foodNutrients: nutrients({ energy: 180, protein: 8, carbohydrate: 14 }),
            });
          }
          return new Response(null, { status: 404 });
        } finally {
          inFlight -= 1;
        }
      },
    });

    const output = await provider.searchBatch({
      queries: [
        { candidateId: candidateIds.gram, query: 'SR Legacy gram food', unit: 'GRAM', limit: 5 },
        { candidateId: candidateIds.milliliter, query: 'Liquid food must not be density-converted', unit: 'MILLILITER', limit: 5 },
        { candidateId: candidateIds.item, query: 'Foundation item food', unit: 'ITEM', limit: 5 },
        { candidateId: candidateIds.incomplete, query: 'Incomplete food', unit: 'GRAM', limit: 5 },
      ],
    }, new AbortController().signal) as {
      groups: Array<{ candidateId: string; records: Array<Record<string, unknown>> }>;
    };

    expect(provider.descriptor).toBe(usdaNutritionDataDescriptor);
    expect(usdaNutritionDataDescriptor.source).toMatchObject({
      sourceKind: 'REMOTE_API',
      sourceId: 'usda-fooddata-central',
      sourceVersion: 'fdc-api-v1-foundation-sr-legacy',
      redistribution: true,
      licenseDecisionId: 'USDA_FDC_CC0_2026_09_20',
    });
    expect(usdaNutritionDataDescriptor.source.datasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(maximumInFlight).toBe(1);
    expect(requests.map((request) => request.pathname)).toEqual([
      '/fdc/v1/foods/search',
      '/fdc/v1/food/100',
      '/fdc/v1/foods/search',
      '/fdc/v1/food/101',
      '/fdc/v1/foods/search',
      '/fdc/v1/food/102',
    ]);

    const gramRecord = output.groups.find((group) => group.candidateId === candidateIds.gram)?.records[0];
    const itemRecord = output.groups.find((group) => group.candidateId === candidateIds.item)?.records[0];
    expect(gramRecord).toMatchObject({
      schemaVersion: 'NUTRITION_RECORD_V1',
      source: usdaNutritionDataDescriptor.source,
      recordId: 'usda-fdc:100:per-100g',
      displayName: 'SR Legacy gram food',
      serving: { quantityDecimal: '100', unit: 'GRAM' },
      nutrientsPerServing: {
        energyKcalDecimal: '100', proteinGramsDecimal: '10', carbohydrateGramsDecimal: '20', fatGramsDecimal: '5',
      },
    });
    expect(itemRecord).toMatchObject({
      schemaVersion: 'NUTRITION_RECORD_V1',
      source: usdaNutritionDataDescriptor.source,
      recordId: 'usda-fdc:101:portion:7',
      displayName: 'Foundation item food (1 patty)',
      serving: { quantityDecimal: '1', unit: 'ITEM' },
      nutrientsPerServing: {
        energyKcalDecimal: '100', proteinGramsDecimal: '6', carbohydrateGramsDecimal: '5', fatGramsDecimal: '2',
      },
    });
    expect(output.groups.find((group) => group.candidateId === candidateIds.milliliter)?.records).toEqual([]);
    expect(output.groups.find((group) => group.candidateId === candidateIds.incomplete)?.records).toEqual([]);

    for (const record of [gramRecord, itemRecord]) {
      expect(record).toBeDefined();
      const { recordHash, ...withoutHash } = record!;
      expect(recordHash).toBe(createHash('sha256').update(canonicalJson(withoutHash)).digest('hex'));
    }

    let requestsWithEmptyKey = 0;
    const missingKeyProvider = createUsdaNutritionDataProvider({
      apiKey: '',
      fetch: async () => {
        requestsWithEmptyKey += 1;
        return response({ foods: [] });
      },
    });
    await expect(missingKeyProvider.searchBatch({
      queries: [{ candidateId: candidateIds.gram, query: 'SR Legacy gram food', unit: 'GRAM', limit: 5 }],
    }, new AbortController().signal)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    expect(requestsWithEmptyKey).toBe(0);
  });
});
