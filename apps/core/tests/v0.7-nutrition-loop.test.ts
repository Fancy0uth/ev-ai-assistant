import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { canonicalJson } from '../src/modules/health-loop/repository';
import { createV07HealthLoopRepository } from '../src/modules/health-loop/repository';
import type { NutritionDataProvider } from '../src/modules/nutrition/provider';
import { executeMealCandidateParse, NutritionProviderError } from '../src/modules/nutrition/provider';
import { createNutritionService } from '../src/modules/nutrition/service';
import { openDatabase } from '../src/storage/database';

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

describe('v0.7 nutrition candidate and confirmation loop', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let session: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v07-nutrition-'));
    app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: { username: 'nutrition-owner', password: 'correct horse battery staple' } });
    session = tokenFrom(setup.headers['set-cookie']);
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates a nutrient-free manual draft through the v2 API', async () => {
    const response = await app!.inject({
      method: 'POST', url: '/v1/nutrition/meal-drafts', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-nutrition-draft-manual01' },
      payload: { mode: 'MANUAL', localDate: '2026-09-06', candidates: [{ displayName: '手工候选', quantityDecimal: '150', unit: 'GRAM' }] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ draft: { state: 'CANDIDATES_READY', originalText: null }, revision: { createdBy: 'OWNER' }, disclosure: null });
    const unavailable = await app!.inject({
      method: 'POST', url: `/v1/nutrition/meal-drafts/${response.json().data.draft.id}/matches`, cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-nutrition-match-unavailable1' },
      payload: { expectedVersion: 1, revisionId: response.json().data.revision.id },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe('NUTRITION_DATA_PROVIDER_NOT_CONFIGURED');
  });

  it('matches only sourced records and confirms BigInt decimal totals without a float path', async () => {
    const databasePath = join(directory, 'app.sqlite');
    await app!.close();
    app = undefined;
    const database = openDatabase(databasePath);
    try {
      const ownerId = (database.prepare('select id from owners').get() as { id: string }).id;
      const source = { sourceKind: 'TEST_FIXTURE', sourceId: 'ev-v07-test', sourceVersion: '1', datasetHash: 'a'.repeat(64), redistribution: false, licenseDecisionId: null } as const;
      const withoutHash = { schemaVersion: 'NUTRITION_RECORD_V1' as const, source, recordId: 'fixture-alpha', displayName: 'Fixture Food Alpha', serving: { quantityDecimal: '100', unit: 'GRAM' as const }, nutrientsPerServing: { energyKcalDecimal: '100', proteinGramsDecimal: '10', carbohydrateGramsDecimal: '20', fatGramsDecimal: '5' } };
      const provider: NutritionDataProvider = {
        descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic nutrition fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', source },
        async searchBatch(input) {
          expect(Object.keys(input.queries[0] ?? {}).sort()).toEqual(['candidateId', 'limit', 'query', 'unit']);
          return { groups: input.queries.map((query) => ({ candidateId: query.candidateId, records: [{ ...withoutHash, recordHash: createHash('sha256').update(canonicalJson(withoutHash)).digest('hex') }] })) };
        },
      };
      const service = createNutritionService(database, { nutritionDataProvider: provider });
      const created = await service.createMealDraft(ownerId, { mode: 'MANUAL', localDate: '2026-09-06', candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }] }, 'v07-nutrition-direct-draft001');
      const matched = await service.matchMealDraft(ownerId, created.draft.id, { expectedVersion: created.draft.version, revisionId: created.revision.id }, 'v07-nutrition-direct-match001');
      expect(matched).toMatchObject({ draft: { state: 'MATCHES_READY' }, matches: [{ status: 'MATCHED', snapshots: [{ source: { sourceKind: 'TEST_FIXTURE' } }] }] });
      await expect(service.matchMealDraft(ownerId, created.draft.id, { expectedVersion: created.draft.version, revisionId: created.revision.id }, 'v07-nutrition-direct-match001')).resolves.toEqual({ ...matched, replayed: true });
      const selected = service.reviseMealDraft(ownerId, created.draft.id, {
        expectedVersion: matched.draft.version, parentRevisionId: matched.revision.id, operation: 'SELECT_MATCHES',
        candidates: [{ candidateId: matched.revision.candidates[0]!.candidateId, included: true, selectedFoodSnapshotId: matched.matches[0]!.snapshots[0]!.id }],
      }, 'v07-nutrition-direct-select01');
      const confirmed = service.confirmMealDraft(ownerId, created.draft.id, { expectedVersion: selected.draft.version, revisionId: selected.revision.id }, 'v07-nutrition-direct-confirm1');
      expect(confirmed.meal.totals).toEqual({ energyKcalDecimal: '150', proteinGramsDecimal: '15', carbohydrateGramsDecimal: '30', fatGramsDecimal: '7.5' });
      expect(confirmed.meal.entries[0]!.lineage).toMatchObject([
        { entityType: 'MEAL_DRAFT', entityVersion: 4 },
        { entityType: 'MEAL_REVISION', entityVersion: 3, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
        { entityType: 'FOOD_SNAPSHOT', contentHash: createHash('sha256').update(canonicalJson(withoutHash)).digest('hex') },
        { entityType: 'MEAL', entityVersion: 1 },
      ]);
      expect(service.confirmMealDraft(ownerId, created.draft.id, { expectedVersion: selected.draft.version, revisionId: selected.revision.id }, 'v07-nutrition-direct-confirm1')).toEqual({ ...confirmed, replayed: true });
      const run = createV07HealthLoopRepository(database).findCapabilityRunByIdempotencyKey(ownerId, 'v07-nutrition-direct-match001');
      expect(run).toMatchObject({ capability: 'NUTRITION_DATA_LOOKUP', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', nutritionSourceVersion: '1', nutritionDatasetHash: 'a'.repeat(64) });
      expect(JSON.stringify(run)).not.toContain('Fixture Food Alpha');

      const mismatchedRecord = { ...withoutHash, recordId: 'fixture-mismatch', serving: { quantityDecimal: '100', unit: 'MILLILITER' as const } };
      const mismatchProvider: NutritionDataProvider = {
        ...provider,
        async searchBatch(input) {
          return { groups: input.queries.map((query) => ({ candidateId: query.candidateId, records: [{ ...mismatchedRecord, recordHash: createHash('sha256').update(canonicalJson(mismatchedRecord)).digest('hex') }] })) };
        },
      };
      const mismatchService = createNutritionService(database, { nutritionDataProvider: mismatchProvider });
      const mismatchDraft = await mismatchService.createMealDraft(ownerId, { mode: 'MANUAL', localDate: '2026-09-07', candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }] }, 'v07-nutrition-mismatch-draft');
      const mismatchMatch = await mismatchService.matchMealDraft(ownerId, mismatchDraft.draft.id, { expectedVersion: 1, revisionId: mismatchDraft.revision.id }, 'v07-nutrition-mismatch-match');
      const mismatchSelection = mismatchService.reviseMealDraft(ownerId, mismatchDraft.draft.id, { expectedVersion: mismatchMatch.draft.version, parentRevisionId: mismatchMatch.revision.id, operation: 'SELECT_MATCHES', candidates: [{ candidateId: mismatchMatch.revision.candidates[0]!.candidateId, included: true, selectedFoodSnapshotId: mismatchMatch.matches[0]!.snapshots[0]!.id }] }, 'v07-nutrition-mismatch-select');
      expect(() => mismatchService.confirmMealDraft(ownerId, mismatchDraft.draft.id, { expectedVersion: mismatchSelection.draft.version, revisionId: mismatchSelection.revision.id }, 'v07-nutrition-mismatch-confirm')).toThrow(/候选份量单位与来源记录不一致/);
    } finally {
      database.close();
    }
  });

  it('rejects parser output that attempts to attach nutrient values', async () => {
    await expect(executeMealCandidateParse(
      { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', mealText: 'fixture', allowedUnits: ['GRAM', 'MILLILITER', 'ITEM'], maxCandidates: 30 },
      {
        descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic parser fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE' },
        async selectWorkout() { return {}; },
        async parseMealCandidates() { return { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', candidates: [{ displayName: 'fixture', quantityDecimal: '100', unit: 'GRAM', energyKcalDecimal: '100' }] }; },
      },
    )).rejects.toBeInstanceOf(NutritionProviderError);
  });
});
