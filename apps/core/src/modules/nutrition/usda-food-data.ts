import { createHash } from 'node:crypto';
import type {
  NutritionDataProviderDescriptor,
  NutritionFoodRecord,
  ServingUnit,
} from '@ev/contracts';
import { canonicalJson } from '../health-loop/repository';
import { NutritionProviderError, type NutritionDataProvider } from './provider';

const USDA_FDC_API_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';
const REQUEST_DEADLINE_MS = 8_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const FOUNDATION_DATA_TYPE = 'Foundation';
const SR_LEGACY_DATA_TYPE = 'SR Legacy';

const usdaSourceManifest = {
  sourceKind: 'REMOTE_API',
  sourceId: 'usda-fooddata-central',
  sourceVersion: 'fdc-api-v1-foundation-sr-legacy',
  redistribution: true,
  licenseDecisionId: 'USDA_FDC_CC0_2026_09_20',
} as const;

const usdaSource = {
  ...usdaSourceManifest,
  datasetHash: createHash('sha256').update(canonicalJson(usdaSourceManifest)).digest('hex'),
} as const;

export const usdaNutritionDataDescriptor = {
  providerId: 'usda-fooddata-central',
  providerLabel: 'USDA FoodData Central',
  adapterKind: 'PRODUCTION_ADAPTER',
  evidenceKind: 'REAL_PROVIDER',
  source: usdaSource,
} as const satisfies NutritionDataProviderDescriptor;

export interface UsdaNutritionDataProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

type UsdaDataType = typeof FOUNDATION_DATA_TYPE | typeof SR_LEGACY_DATA_TYPE;

interface UsdaSearchFood {
  fdcId: number;
  dataType: UsdaDataType;
  description: string;
}

interface UsdaFoodDetail extends UsdaSearchFood {
  foodNutrients: unknown[];
  foodPortions: unknown[];
}

interface NutrientValues {
  energy: number;
  protein: number;
  carbohydrate: number;
  fat: number;
}

type NutritionDecimals = NutritionFoodRecord['nutrientsPerServing'];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function text(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : undefined;
}

function dataType(value: unknown): UsdaDataType | undefined {
  return value === FOUNDATION_DATA_TYPE || value === SR_LEGACY_DATA_TYPE ? value : undefined;
}

function nutrientNumber(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
}

function nutrientUnit(foodNutrient: Record<string, unknown>): string | undefined {
  const nutrient = asRecord(foodNutrient.nutrient);
  const unit = nutrient?.unitName ?? foodNutrient.unitName ?? foodNutrient.unit;
  return typeof unit === 'string' ? unit.trim().toUpperCase() : undefined;
}

function nutrientIdentifier(foodNutrient: Record<string, unknown>): string | undefined {
  const nutrient = asRecord(foodNutrient.nutrient);
  return nutrientNumber(nutrient?.number ?? foodNutrient.nutrientNumber);
}

function nutrientAmount(foodNutrients: unknown[], identifier: string, expectedUnit: string): number | undefined {
  const matching = foodNutrients.filter((value) => {
    const foodNutrient = asRecord(value);
    return foodNutrient !== undefined && nutrientIdentifier(foodNutrient) === identifier;
  });
  if (matching.length !== 1) return undefined;
  const foodNutrient = asRecord(matching[0]);
  if (!foodNutrient || nutrientUnit(foodNutrient) !== expectedUnit) return undefined;
  return nonnegativeNumber(foodNutrient.amount);
}

function nutrientValues(foodNutrients: unknown[]): NutrientValues | undefined {
  const energy = nutrientAmount(foodNutrients, '208', 'KCAL');
  const protein = nutrientAmount(foodNutrients, '203', 'G');
  const carbohydrate = nutrientAmount(foodNutrients, '205', 'G');
  const fat = nutrientAmount(foodNutrients, '204', 'G');
  if (energy === undefined || protein === undefined || carbohydrate === undefined || fat === undefined) return undefined;
  return { energy, protein, carbohydrate, fat };
}

function canonicalDecimal(value: number): string | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const micros = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(micros) || micros < 0 || micros > 999_999_999_999) return undefined;
  const integer = Math.floor(micros / 1_000_000);
  const fraction = micros % 1_000_000;
  if (fraction === 0) return String(integer);
  return `${integer}.${String(fraction).padStart(6, '0').replace(/0+$/, '')}`;
}

function decimalsFor(values: NutrientValues, multiplier: number): NutritionDecimals | undefined {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return undefined;
  const energyKcalDecimal = canonicalDecimal(values.energy * multiplier);
  const proteinGramsDecimal = canonicalDecimal(values.protein * multiplier);
  const carbohydrateGramsDecimal = canonicalDecimal(values.carbohydrate * multiplier);
  const fatGramsDecimal = canonicalDecimal(values.fat * multiplier);
  if (
    energyKcalDecimal === undefined
    || proteinGramsDecimal === undefined
    || carbohydrateGramsDecimal === undefined
    || fatGramsDecimal === undefined
  ) return undefined;
  return { energyKcalDecimal, proteinGramsDecimal, carbohydrateGramsDecimal, fatGramsDecimal };
}

function withRecordHash(record: Omit<NutritionFoodRecord, 'recordHash'>): NutritionFoodRecord {
  return {
    ...record,
    recordHash: createHash('sha256').update(canonicalJson(record)).digest('hex'),
  };
}

function perHundredGramRecord(detail: UsdaFoodDetail): NutritionFoodRecord | undefined {
  const values = nutrientValues(detail.foodNutrients);
  const nutrientsPerServing = values && decimalsFor(values, 1);
  if (!nutrientsPerServing) return undefined;
  return withRecordHash({
    schemaVersion: 'NUTRITION_RECORD_V1',
    source: usdaNutritionDataDescriptor.source,
    recordId: `usda-fdc:${detail.fdcId}:per-100g`,
    displayName: detail.description,
    serving: { quantityDecimal: '100', unit: 'GRAM' },
    nutrientsPerServing,
  });
}

function itemRecords(detail: UsdaFoodDetail, maximum: number): NutritionFoodRecord[] {
  if (detail.dataType !== FOUNDATION_DATA_TYPE) return [];
  const values = nutrientValues(detail.foodNutrients);
  if (!values) return [];
  const records: NutritionFoodRecord[] = [];
  for (const value of detail.foodPortions) {
    if (records.length >= maximum) break;
    const portion = asRecord(value);
    const id = portion && positiveInteger(portion.id);
    const amount = portion && positiveNumber(portion.amount);
    const gramWeight = portion && positiveNumber(portion.gramWeight);
    if (!portion || !id || amount === undefined || gramWeight === undefined) continue;
    const quantityDecimal = canonicalDecimal(amount);
    const nutrientsPerServing = decimalsFor(values, gramWeight / 100);
    const portionDescription = text(portion.portionDescription, 100);
    if (!portionDescription) continue;
    const displayName = `${detail.description} (${portionDescription})`;
    if (!quantityDecimal || !nutrientsPerServing || displayName.length > 120) continue;
    records.push(withRecordHash({
      schemaVersion: 'NUTRITION_RECORD_V1',
      source: usdaNutritionDataDescriptor.source,
      recordId: `usda-fdc:${detail.fdcId}:portion:${id}`,
      displayName,
      serving: { quantityDecimal, unit: 'ITEM' },
      nutrientsPerServing,
    }));
  }
  return records;
}

function searchFoods(value: unknown): UsdaSearchFood[] {
  const root = asRecord(value);
  if (!root || !Array.isArray(root.foods)) throw new NutritionProviderError('INVALID_RESPONSE');
  const foods: UsdaSearchFood[] = [];
  const seenFdcIds = new Set<number>();
  for (const value of root.foods) {
    if (foods.length >= 5) break;
    const food = asRecord(value);
    const fdcId = food && positiveInteger(food.fdcId);
    const foodDataType = food && dataType(food.dataType);
    const description = food && text(food.description, 120);
    if (!fdcId || !foodDataType || !description || seenFdcIds.has(fdcId)) continue;
    seenFdcIds.add(fdcId);
    foods.push({ fdcId, dataType: foodDataType, description });
  }
  return foods;
}

function foodDetail(value: unknown, expected: UsdaSearchFood): UsdaFoodDetail | undefined {
  const food = asRecord(value);
  if (!food || !Array.isArray(food.foodNutrients)) return undefined;
  const fdcId = positiveInteger(food.fdcId);
  const foodDataType = dataType(food.dataType);
  const description = text(food.description, 120);
  if (!fdcId || fdcId !== expected.fdcId || !foodDataType || foodDataType !== expected.dataType || !description) return undefined;
  return {
    fdcId,
    dataType: foodDataType,
    description,
    foodNutrients: food.foodNutrients,
    foodPortions: Array.isArray(food.foodPortions) ? food.foodPortions : [],
  };
}

function searchUrl(query: string, apiKey: string): URL {
  const url = new URL(`${USDA_FDC_API_BASE_URL}/foods/search`);
  url.searchParams.set('query', query);
  url.searchParams.append('dataType', FOUNDATION_DATA_TYPE);
  url.searchParams.append('dataType', SR_LEGACY_DATA_TYPE);
  url.searchParams.set('pageSize', '5');
  url.searchParams.set('pageNumber', '1');
  url.searchParams.set('api_key', apiKey);
  return url;
}

function detailUrl(fdcId: number, apiKey: string): URL {
  const url = new URL(`${USDA_FDC_API_BASE_URL}/food/${fdcId}`);
  url.searchParams.set('format', 'full');
  for (const nutrient of ['208', '203', '204', '205']) url.searchParams.append('nutrients', nutrient);
  url.searchParams.set('api_key', apiKey);
  return url;
}

function attachDeadline(parentSignal: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_DEADLINE_MS);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
    },
  };
}

function awaitWithAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new NutritionProviderError('UNAVAILABLE'));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new NutritionProviderError('UNAVAILABLE'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new NutritionProviderError('UNAVAILABLE'));
      },
    );
  });
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The adapter never exposes transport errors to callers.
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw new NutritionProviderError('INVALID_RESPONSE');
  }
  if (!response.body) throw new NutritionProviderError('INVALID_RESPONSE');

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await awaitWithAbort(reader.read(), signal);
      } catch (error) {
        if (error instanceof NutritionProviderError) throw error;
        throw new NutritionProviderError('UNAVAILABLE');
      }
      if (chunk.done) break;
      if (!chunk.value) continue;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) throw new NutritionProviderError('INVALID_RESPONSE');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new NutritionProviderError('INVALID_RESPONSE');
    }
  } catch (error) {
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // The adapter never exposes transport errors to callers.
      }
    } else {
      await cancelResponseBody(response);
    }
    if (error instanceof NutritionProviderError) throw error;
    throw new NutritionProviderError(signal.aborted ? 'UNAVAILABLE' : 'INVALID_RESPONSE');
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // The stream was already closed while handling the failure.
    }
  }
}

async function fetchJson(fetchImplementation: typeof globalThis.fetch, url: URL, signal: AbortSignal): Promise<unknown> {
  let response: unknown;
  try {
    response = await awaitWithAbort(Promise.resolve(fetchImplementation(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal,
    })), signal);
  } catch (error) {
    if (error instanceof NutritionProviderError) throw error;
    throw new NutritionProviderError('UNAVAILABLE');
  }
  if (!(response instanceof Response)) throw new NutritionProviderError('INVALID_RESPONSE');
  if (!response.ok || response.redirected) {
    await cancelResponseBody(response);
    throw new NutritionProviderError('UNAVAILABLE');
  }
  return readJson(response, signal);
}

function validInput(input: unknown): input is { queries: Array<{ candidateId: string; query: string; unit: ServingUnit; limit: 5 }> } {
  const value = asRecord(input);
  if (!value || !Array.isArray(value.queries) || value.queries.length < 1 || value.queries.length > 10) return false;
  return value.queries.every((query) => {
    const value = asRecord(query);
    return value !== undefined
      && typeof value.candidateId === 'string'
      && typeof value.query === 'string'
      && (value.unit === 'GRAM' || value.unit === 'MILLILITER' || value.unit === 'ITEM')
      && value.limit === 5;
  });
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new NutritionProviderError('UNAVAILABLE');
}

export function createUsdaNutritionDataProvider(options: UsdaNutritionDataProviderOptions): NutritionDataProvider {
  const apiKey = options.apiKey.trim();
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return {
    descriptor: usdaNutritionDataDescriptor,
    async searchBatch(input, parentSignal) {
      const deadline = attachDeadline(parentSignal);
      try {
        if (!apiKey || typeof fetchImplementation !== 'function') throw new NutritionProviderError('UNAVAILABLE');
        if (!validInput(input)) throw new NutritionProviderError('INVALID_RESPONSE');

        const groups: Array<{ candidateId: string; records: NutritionFoodRecord[] }> = [];
        for (const query of input.queries) {
          assertActive(deadline.signal);
          if (query.unit === 'MILLILITER' || query.query.trim().length === 0) {
            groups.push({ candidateId: query.candidateId, records: [] });
            continue;
          }

          const matches = searchFoods(await fetchJson(fetchImplementation, searchUrl(query.query, apiKey), deadline.signal));
          const records: NutritionFoodRecord[] = [];
          for (const match of matches) {
            if (records.length >= 5) break;
            assertActive(deadline.signal);
            const detail = foodDetail(
              await fetchJson(fetchImplementation, detailUrl(match.fdcId, apiKey), deadline.signal),
              match,
            );
            if (!detail) continue;
            if (query.unit === 'GRAM') {
              const record = perHundredGramRecord(detail);
              if (record) records.push(record);
            } else {
              records.push(...itemRecords(detail, 5 - records.length));
            }
          }
          groups.push({ candidateId: query.candidateId, records });
        }
        return { groups };
      } catch (error) {
        if (error instanceof NutritionProviderError) throw error;
        throw new NutritionProviderError('UNAVAILABLE');
      } finally {
        deadline.dispose();
      }
    },
  };
}
