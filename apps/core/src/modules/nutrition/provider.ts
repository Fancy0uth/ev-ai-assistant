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
import {
  executeV07ProviderBoundary,
  V07ProviderBoundaryError,
  type V07ProviderBoundaryResult,
} from '../health-loop/provider-boundary';

export class NutritionProviderError extends Error {
  constructor(
    readonly kind: 'UNAVAILABLE' | 'INVALID_RESPONSE',
    readonly inputBytes: number | null = null,
    readonly outputBytes: number | null = null,
  ) {
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

function asNutritionProviderError(error: unknown): NutritionProviderError {
  if (error instanceof V07ProviderBoundaryError) {
    return new NutritionProviderError(error.kind, error.inputBytes, error.outputBytes);
  }
  return new NutritionProviderError('INVALID_RESPONSE');
}

export async function executeMealCandidateParse(
  input: MealCandidateParseInput,
  provider: HealthTextProvider,
): Promise<V07ProviderBoundaryResult<Array<Pick<MealCandidate, 'displayName' | 'quantityDecimal' | 'unit'>>>> {
  let request: MealCandidateParseInput;
  try {
    request = mealCandidateParseInputSchema.parse(input);
  } catch {
    throw new NutritionProviderError('INVALID_RESPONSE');
  }
  try {
    const result = await executeV07ProviderBoundary({
      input: request,
      invoke: (providerInput, signal) => provider.parseMealCandidates(providerInput, signal),
      parseOutput: (output) => mealCandidateParseOutputSchema.parse(output).candidates,
    });
    return result;
  } catch (error) {
    throw asNutritionProviderError(error);
  }
}

export async function executeNutritionSearchBatch(
  input: { queries: Array<{ candidateId: string; query: string; unit: ServingUnit; limit: 5 }> },
  provider: NutritionDataProvider,
): Promise<V07ProviderBoundaryResult<Array<{ candidateId: string; records: NutritionFoodRecord[] }>>> {
  if (input.queries.length < 1 || input.queries.length > 10
    || new Set(input.queries.map((query) => query.candidateId)).size !== input.queries.length
    || input.queries.some((query) => query.limit !== 5)) {
    throw new NutritionProviderError('INVALID_RESPONSE');
  }
  try {
    const result = await executeV07ProviderBoundary({
      input,
      invoke: (providerInput, signal) => provider.searchBatch(providerInput, signal),
      parseOutput: (output) => nutritionSearchBatchOutputSchema.parse(output),
      correlateOutput: (parsed, request) => {
        const requested = new Set(request.queries.map((query) => query.candidateId));
        if (parsed.groups.length !== requested.size || new Set(parsed.groups.map((group) => group.candidateId)).size !== parsed.groups.length) {
          throw new Error('NUTRITION_GROUPS_INVALID');
        }
        for (const group of parsed.groups) {
          if (!requested.has(group.candidateId)) throw new Error('NUTRITION_GROUP_UNKNOWN');
          for (const record of group.records) {
            const { recordHash: suppliedHash, ...withoutHash } = record;
            if (suppliedHash !== recordHash(withoutHash)
              || !sameCanonicalJson(record.source, provider.descriptor.source)) {
              throw new Error('NUTRITION_RECORD_INVALID');
            }
          }
        }
      },
    });
    return {
      ...result,
      value: result.value.groups.map((group) => ({
        candidateId: group.candidateId,
        records: group.records.filter((record, index, all) => all.findIndex((candidate) => candidate.recordHash === record.recordHash) === index),
      })),
    };
  } catch (error) {
    throw asNutritionProviderError(error);
  }
}
