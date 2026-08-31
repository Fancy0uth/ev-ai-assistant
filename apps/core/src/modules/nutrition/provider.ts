import { createHash } from 'node:crypto';
import {
  mealCandidateParseInputSchema,
  mealCandidateParseOutputSchema,
  nutritionFoodRecordSchema,
  type HealthTextProvider,
  type MealCandidate,
  type MealCandidateParseInput,
  type NutritionFoodRecord,
  type NutritionSourceDescriptor,
  type ServingUnit,
} from '@ev/contracts';
import * as z from 'zod';
import { canonicalJson } from '../health-loop/repository';

export class NutritionProviderError extends Error {
  constructor(readonly kind: 'UNAVAILABLE' | 'INVALID_RESPONSE') {
    super(kind);
    this.name = 'NutritionProviderError';
  }
}

export interface NutritionDataProvider {
  readonly descriptor: {
    providerId: string;
    providerLabel: string;
    adapterKind: 'TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'PRODUCTION_ADAPTER';
    evidenceKind: 'AUTOMATED_TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'REAL_PROVIDER';
    source: NutritionSourceDescriptor;
  };
  searchBatch(input: {
    queries: Array<{ candidateId: string; query: string; unit: ServingUnit; limit: 5 }>;
  }, signal: AbortSignal): Promise<unknown>;
}

const nutritionSearchBatchOutputSchema = z.object({
  groups: z.array(z.object({
    candidateId: z.uuid(),
    records: z.array(nutritionFoodRecordSchema).max(5),
  }).strict()).min(1).max(10),
}).strict();

function recordHash(record: Omit<NutritionFoodRecord, 'recordHash'>): string {
  return createHash('sha256').update(canonicalJson(record)).digest('hex');
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export async function executeMealCandidateParse(
  input: MealCandidateParseInput,
  provider: HealthTextProvider,
): Promise<Array<Pick<MealCandidate, 'displayName' | 'quantityDecimal' | 'unit'>>> {
  const request = mealCandidateParseInputSchema.parse(input);
  let output: unknown;
  try {
    output = await provider.parseMealCandidates(request, new AbortController().signal);
  } catch {
    throw new NutritionProviderError('UNAVAILABLE');
  }
  try {
    return mealCandidateParseOutputSchema.parse(output).candidates;
  } catch {
    throw new NutritionProviderError('INVALID_RESPONSE');
  }
}

export async function executeNutritionSearchBatch(
  input: { queries: Array<{ candidateId: string; query: string; unit: ServingUnit; limit: 5 }> },
  provider: NutritionDataProvider,
): Promise<Array<{ candidateId: string; records: NutritionFoodRecord[] }>> {
  if (input.queries.length < 1 || input.queries.length > 10
    || new Set(input.queries.map((query) => query.candidateId)).size !== input.queries.length
    || input.queries.some((query) => query.limit !== 5)) {
    throw new NutritionProviderError('INVALID_RESPONSE');
  }
  let output: unknown;
  try {
    output = await provider.searchBatch(input, new AbortController().signal);
  } catch {
    throw new NutritionProviderError('UNAVAILABLE');
  }
  try {
    const parsed = nutritionSearchBatchOutputSchema.parse(output);
    const requested = new Map(input.queries.map((query) => [query.candidateId, query]));
    if (parsed.groups.length !== requested.size || new Set(parsed.groups.map((group) => group.candidateId)).size !== parsed.groups.length) {
      throw new Error('NUTRITION_GROUPS_INVALID');
    }
    return parsed.groups.map((group) => {
      if (!requested.has(group.candidateId)) throw new Error('NUTRITION_GROUP_UNKNOWN');
      const records = group.records.filter((record, index, all) => {
        const { recordHash: suppliedHash, ...withoutHash } = record;
        if (suppliedHash !== recordHash(withoutHash)
          || !sameCanonicalJson(record.source, provider.descriptor.source)) {
          throw new Error('NUTRITION_RECORD_INVALID');
        }
        return all.findIndex((candidate) => candidate.recordHash === record.recordHash) === index;
      });
      return { candidateId: group.candidateId, records };
    });
  } catch {
    throw new NutritionProviderError('INVALID_RESPONSE');
  }
}
