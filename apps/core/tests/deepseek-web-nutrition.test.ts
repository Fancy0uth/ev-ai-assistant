import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/modules/health-loop/repository';
import {
  createDeepSeekWebNutritionResolver,
  DEEPSEEK_WEB_NUTRITION_ADAPTER_VERSION,
  deepSeekWebNutritionDataDescriptor,
} from '../src/modules/nutrition/deepseek-web-nutrition';
import { createNutritionWebCache } from '../src/modules/nutrition/nutrition-web-cache';
import { runMigrations } from '../src/storage/migrations';

const ownerA = '00000000-0000-4000-8000-0000000000a1';
const ownerB = '00000000-0000-4000-8000-0000000000b2';
const riceCandidate = '00000000-0000-4000-8000-000000000101';
const fabricatedCandidate = '00000000-0000-4000-8000-000000000102';
const swappedRowCandidate = '00000000-0000-4000-8000-000000000103';
const saturatedFatCandidate = '00000000-0000-4000-8000-000000000104';
const now = new Date('2026-09-20T00:00:00.000Z');

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function header(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  return new Headers(headers).get(name);
}

describe('DeepSeek Wikipedia nutrition resolver', () => {
  let database: Database.Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('grounds a cache miss in retrieved Wikipedia text, then uses the owner-local cache and rejects fabricated, swapped-row, or fat-subtype quotes', async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    runMigrations(database);
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerA, 'nutrition-owner-a', 'hash', now.toISOString());

    let keyReads = 0;
    let deepSeekCalls = 0;
    let wikipediaCalls = 0;
    const credentials = {
      getMetadata: () => ({ providerKey: 'DEEPSEEK' as const, state: 'CONFIGURED' as const, updatedAt: null, lastConnectionTest: null }),
      async withApiKey(_ownerId: string, callback: (apiKey: string) => void | Promise<void>) {
        keyReads += 1;
        await callback('deepseek-test-key');
      },
    };
    const resolver = createDeepSeekWebNutritionResolver(database, credentials, {
      now: () => now,
      fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        expect(init?.redirect).toBe('error');
        expect(init?.credentials).toBe('omit');
        expect(init?.signal).toBeInstanceOf(AbortSignal);

        if (url.origin === 'https://api.deepseek.com') {
          deepSeekCalls += 1;
          expect(url.pathname).toBe('/chat/completions');
          expect(header(init, 'authorization')).toBe('Bearer deepseek-test-key');
          const body = JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>>; tools?: unknown };
          if (body.tools) {
            const user = body.messages.find((message) => message.role === 'user');
            const lookups = JSON.parse(String(user?.content)) as { lookups: Array<{ candidateId: string; query: string; language: string }> };
            expect(JSON.stringify(body)).not.toContain(ownerA);
            return jsonResponse({
              choices: [{
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{
                    id: 'call-nutrition-search',
                    type: 'function',
                    function: {
                      name: 'search_nutrition_sources',
                      arguments: JSON.stringify({ queries: lookups.lookups }),
                    },
                  }],
                },
              }],
            });
          }

          const tool = body.messages.find((message) => message.role === 'tool');
          const sources = JSON.parse(String(tool?.content)) as { sources: Array<{ candidateId: string; sourceUrl: string; articleTitle: string }> };
          const source = sources.sources[0]!;
          const fabricated = source.candidateId === fabricatedCandidate;
          const swappedRow = source.candidateId === swappedRowCandidate;
          const saturatedFat = source.candidateId === saturatedFatCandidate;
          return jsonResponse({
            choices: [{
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  results: [{
                    candidateId: source.candidateId,
                    sourceUrl: source.sourceUrl,
                    articleTitle: source.articleTitle,
                    basis: { quantityDecimal: '100', unit: 'GRAM', quote: 'Nutritional value per 100 g' },
                    nutrients: {
                      energyKcalDecimal: fabricated ? '999' : '130',
                      energyQuote: fabricated ? 'Energy 999 kcal' : 'Energy 130 kcal',
                      proteinGramsDecimal: swappedRow ? '130' : '2.7',
                      proteinQuote: swappedRow ? 'Energy 130 kcal\nProtein 2.7 g' : 'Protein 2.7 g',
                      carbohydrateGramsDecimal: '28',
                      carbohydrateQuote: 'Carbohydrate 28 g',
                      fatGramsDecimal: saturatedFat ? '1' : '0.3',
                      fatQuote: saturatedFat ? 'fat 1 g' : 'Fat 0.3 g',
                    },
                  }],
                }),
              },
            }],
          });
        }

        expect(['https://en.wikipedia.org', 'https://zh.wikipedia.org']).toContain(url.origin);
        expect(header(init, 'authorization')).toBeNull();
        wikipediaCalls += 1;
        expect(url.pathname).toBe('/w/api.php');
        if (url.searchParams.get('list') === 'search') {
          return jsonResponse({ query: { search: [{ pageid: 123, title: 'Rice, cooked' }] } });
        }
        if (url.searchParams.get('action') === 'parse') {
          return jsonResponse({
            parse: {
              pageid: 123,
              title: 'Rice, cooked',
              text: '<table><caption>Nutritional value per 100 g</caption><tr><th>Energy</th><td>130 kcal</td></tr><tr><th>Protein</th><td>2.7 g</td></tr><tr><th>Carbohydrate</th><td>28 g</td></tr><tr><th>Fat</th><td>0.3 g</td></tr><tr><th>Saturated fat</th><td>1 g</td></tr></table>',
            },
          });
        }
        return new Response(null, { status: 400 });
      },
    });
    const provider = resolver(ownerA);
    if (!provider) throw new Error('expected configured provider');
    const input = { queries: [{ candidateId: riceCandidate, query: 'Cooked rice', unit: 'GRAM' as const, limit: 5 as const }] };

    expect(provider.deadlineMs).toBe(60_000);
    expect(provider.readCachedBatch?.(input)).toBeUndefined();
    const first = await provider.searchBatch(input, new AbortController().signal) as {
      groups: Array<{ candidateId: string; records: Array<Record<string, unknown>> }>;
    };
    const record = first.groups[0]?.records[0];
    expect(first).toMatchObject({
      groups: [{
        candidateId: riceCandidate,
        records: [{
          schemaVersion: 'NUTRITION_RECORD_V1',
          source: deepSeekWebNutritionDataDescriptor.source,
          recordId: 'https://en.wikipedia.org/?curid=123',
          displayName: 'Rice, cooked — per 100 g',
          serving: { quantityDecimal: '100', unit: 'GRAM' },
          nutrientsPerServing: {
            energyKcalDecimal: '130', proteinGramsDecimal: '2.7', carbohydrateGramsDecimal: '28', fatGramsDecimal: '0.3',
          },
        }],
      }],
    });
    expect(record).toBeDefined();
    const { recordHash, ...withoutHash } = record!;
    expect(recordHash).toBe(createHash('sha256').update(canonicalJson(withoutHash)).digest('hex'));
    expect(deepSeekCalls).toBe(2);
    expect(wikipediaCalls).toBe(2);
    expect(keyReads).toBe(1);

    const cache = createNutritionWebCache(database, { now: () => now });
    expect(cache.getEvidence(ownerA, {
      query: 'Cooked rice',
      unit: 'GRAM',
      adapterVersion: DEEPSEEK_WEB_NUTRITION_ADAPTER_VERSION,
    })).toMatchObject({
      sourceUrl: 'https://en.wikipedia.org/?curid=123',
      retrievedAt: now.toISOString(),
      quotes: { basis: 'Nutritional value per 100 g', energy: 'Energy 130 kcal' },
    });
    expect(provider.readCachedBatch?.(input)).toEqual(first);
    await expect(provider.searchBatch(input, new AbortController().signal)).resolves.toEqual(first);
    expect(deepSeekCalls).toBe(2);
    expect(wikipediaCalls).toBe(2);
    expect(keyReads).toBe(1);
    const otherOwner = resolver(ownerB);
    expect(otherOwner?.readCachedBatch?.(input)).toBeUndefined();

    const fabricatedInput = { queries: [{ candidateId: fabricatedCandidate, query: 'Fabricated rice', unit: 'GRAM' as const, limit: 5 as const }] };
    await expect(provider.searchBatch(fabricatedInput, new AbortController().signal)).resolves.toEqual({
      groups: [{ candidateId: fabricatedCandidate, records: [] }],
    });
    expect(cache.getEvidence(ownerA, {
      query: 'Fabricated rice',
      unit: 'GRAM',
      adapterVersion: DEEPSEEK_WEB_NUTRITION_ADAPTER_VERSION,
    })).toBeUndefined();

    const swappedRowInput = { queries: [{ candidateId: swappedRowCandidate, query: 'Swapped-row rice', unit: 'GRAM' as const, limit: 5 as const }] };
    await expect(provider.searchBatch(swappedRowInput, new AbortController().signal)).resolves.toEqual({
      groups: [{ candidateId: swappedRowCandidate, records: [] }],
    });
    expect(cache.getEvidence(ownerA, {
      query: 'Swapped-row rice',
      unit: 'GRAM',
      adapterVersion: DEEPSEEK_WEB_NUTRITION_ADAPTER_VERSION,
    })).toBeUndefined();

    const saturatedFatInput = { queries: [{ candidateId: saturatedFatCandidate, query: 'Saturated-fat rice', unit: 'GRAM' as const, limit: 5 as const }] };
    await expect(provider.searchBatch(saturatedFatInput, new AbortController().signal)).resolves.toEqual({
      groups: [{ candidateId: saturatedFatCandidate, records: [] }],
    });
    expect(cache.getEvidence(ownerA, {
      query: 'Saturated-fat rice',
      unit: 'GRAM',
      adapterVersion: DEEPSEEK_WEB_NUTRITION_ADAPTER_VERSION,
    })).toBeUndefined();
  });
});
