import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HealthTextProvider } from '@ev/contracts';
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
      let providerCalls = 0;
      const provider: NutritionDataProvider = {
        descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic nutrition fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', source },
        async searchBatch(input) {
          providerCalls += 1;
          expect(Object.keys(input.queries[0] ?? {}).sort()).toEqual(['candidateId', 'limit', 'query', 'unit']);
          return { groups: input.queries.map((query) => ({ candidateId: query.candidateId, records: [{ ...withoutHash, recordHash: createHash('sha256').update(canonicalJson(withoutHash)).digest('hex') }] })) };
        },
      };
      const service = createNutritionService(database, { nutritionDataProvider: provider });
      const created = await service.createMealDraft(ownerId, { mode: 'MANUAL', localDate: '2026-09-06', candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }] }, 'v07-nutrition-direct-draft001');
      const matched = await service.matchMealDraft(ownerId, created.draft.id, { expectedVersion: created.draft.version, revisionId: created.revision.id }, 'v07-nutrition-direct-match001');
      expect(matched).toMatchObject({ draft: { state: 'MATCHES_READY' }, matches: [{ status: 'MATCHED', snapshots: [{ source: { sourceKind: 'TEST_FIXTURE' } }] }] });
      await expect(service.matchMealDraft(ownerId, created.draft.id, { expectedVersion: created.draft.version, revisionId: created.revision.id }, 'v07-nutrition-direct-match001')).resolves.toEqual({ ...matched, replayed: true });
      expect(providerCalls).toBe(1);
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
      expect(run!.inputBytes).toBeGreaterThan(0);
      expect(run!.outputBytes).toBeGreaterThan(0);
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

  it('rejects every non-canonical zero spelling at the route boundary', async () => {
    for (const [index, quantityDecimal] of ['0', '0.0', '0.000000'].entries()) {
      const response = await app!.inject({
        method: 'POST', url: '/v1/nutrition/meal-drafts', cookies: { ev_session: session },
        headers: { 'idempotency-key': `v07-zero-spelling-route-${index}` },
        payload: { mode: 'MANUAL', localDate: `2026-09-${20 + index}`, candidates: [{ displayName: 'Synthetic zero', quantityDecimal, unit: 'GRAM' }] },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('maps maximum product and total overflow to terminal 422 without creating a Meal', async () => {
    const source = { sourceKind: 'TEST_FIXTURE', sourceId: 'ev-v07-decimal-range', sourceVersion: '1', datasetHash: 'd'.repeat(64), redistribution: false, licenseDecisionId: null } as const;
    const provider: NutritionDataProvider = {
      descriptor: { providerId: 'v07-decimal-range', providerLabel: 'Synthetic decimal range fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', source },
      async searchBatch(input) {
        return {
          groups: input.queries.map((query) => {
            const maximumProduct = query.query === 'Maximum Product';
            const withoutHash = {
              schemaVersion: 'NUTRITION_RECORD_V1' as const,
              source,
              recordId: `decimal-${query.candidateId}`,
              displayName: query.query,
              serving: { quantityDecimal: maximumProduct ? '0.000001' : '1', unit: query.unit },
              nutrientsPerServing: { energyKcalDecimal: '999999.999999', proteinGramsDecimal: '0', carbohydrateGramsDecimal: '0', fatGramsDecimal: '0' },
            };
            return { candidateId: query.candidateId, records: [{ ...withoutHash, recordHash: createHash('sha256').update(canonicalJson(withoutHash)).digest('hex') }] };
          }),
        };
      },
    };
    await app!.close();
    app = await buildApp({
      databasePath: join(directory, 'app.sqlite'), artifactRoot: join(directory, 'artifacts'), logger: false,
      nutritionDataProvider: provider,
      v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: directory },
    });

    const confirmOverflow = async (suffix: string, localDate: string, candidates: Array<{ displayName: string; quantityDecimal: string; unit: 'GRAM' }>) => {
      const draftResponse = await app!.inject({
        method: 'POST', url: '/v1/nutrition/meal-drafts', cookies: { ev_session: session },
        headers: { 'idempotency-key': `v07-decimal-draft-${suffix}` }, payload: { mode: 'MANUAL', localDate, candidates },
      });
      expect(draftResponse.statusCode).toBe(201);
      const draft = draftResponse.json().data;
      const matchResponse = await app!.inject({
        method: 'POST', url: `/v1/nutrition/meal-drafts/${draft.draft.id}/matches`, cookies: { ev_session: session },
        headers: { 'idempotency-key': `v07-decimal-match-${suffix}` }, payload: { expectedVersion: draft.draft.version, revisionId: draft.revision.id },
      });
      expect(matchResponse.statusCode).toBe(202);
      const matched = matchResponse.json().data;
      const selectionResponse = await app!.inject({
        method: 'POST', url: `/v1/nutrition/meal-drafts/${draft.draft.id}/revisions`, cookies: { ev_session: session },
        headers: { 'idempotency-key': `v07-decimal-select-${suffix}` },
        payload: {
          expectedVersion: matched.draft.version, parentRevisionId: matched.revision.id, operation: 'SELECT_MATCHES',
          candidates: matched.revision.candidates.map((candidate: { candidateId: string }, index: number) => ({ candidateId: candidate.candidateId, included: true, selectedFoodSnapshotId: matched.matches[index].snapshots[0].id })),
        },
      });
      expect(selectionResponse.statusCode).toBe(201);
      const selected = selectionResponse.json().data;
      return app!.inject({
        method: 'POST', url: `/v1/nutrition/meal-drafts/${draft.draft.id}/confirm`, cookies: { ev_session: session },
        headers: { 'idempotency-key': `v07-decimal-confirm-${suffix}` }, payload: { expectedVersion: selected.draft.version, revisionId: selected.revision.id },
      });
    };

    const product = await confirmOverflow('product-01', '2026-09-23', [{ displayName: 'Maximum Product', quantityDecimal: '999999.999999', unit: 'GRAM' }]);
    expect(product.statusCode).toBe(422);
    expect(product.json()).toMatchObject({ error: { code: 'DECIMAL_OUT_OF_RANGE' } });
    const total = await confirmOverflow('total-0001', '2026-09-24', [
      { displayName: 'Maximum Total A', quantityDecimal: '1', unit: 'GRAM' },
      { displayName: 'Maximum Total B', quantityDecimal: '1', unit: 'GRAM' },
    ]);
    expect(total.statusCode).toBe(422);
    expect(total.json()).toMatchObject({ error: { code: 'DECIMAL_OUT_OF_RANGE' } });
    const database = openDatabase(join(directory, 'app.sqlite'));
    try {
      expect(database.prepare('select count(*) as count from meals_v2').get()).toEqual({ count: 0 });
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

  it('calls the meal parser once and exactly replays success and failure responses', async () => {
    let successCalls = 0;
    const successProvider: HealthTextProvider = {
      descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic parser idempotency fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE' },
      async selectWorkout() { throw new Error('not used'); },
      async parseMealCandidates() {
        successCalls += 1;
        return { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }] };
      },
    };
    await app!.close();
    app = await buildApp({
      databasePath: join(directory, 'app.sqlite'), artifactRoot: join(directory, 'artifacts'), logger: false,
      healthTextProvider: successProvider,
      v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: directory },
    });
    const successPayload = { mode: 'PARSE_TEXT', localDate: '2026-09-14', mealText: 'Fixture Food Alpha 150 g', disclosureVersion: 'HEALTH_DISCLOSURE_V1' };
    const firstSuccess = await app.inject({ method: 'POST', url: '/v1/nutrition/meal-drafts', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-parser-success-replay01' }, payload: successPayload });
    const replaySuccess = await app.inject({ method: 'POST', url: '/v1/nutrition/meal-drafts', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-parser-success-replay01' }, payload: successPayload });
    expect(firstSuccess.statusCode).toBe(201);
    expect(replaySuccess.statusCode).toBe(201);
    expect(replaySuccess.json()).toEqual(firstSuccess.json());
    expect(replaySuccess.headers['idempotency-replayed']).toBe('true');
    expect(successCalls).toBe(1);

    await app.close();
    let failedCalls = 0;
    const failedProvider: HealthTextProvider = {
      ...successProvider,
      descriptor: { ...successProvider.descriptor, providerLabel: 'Synthetic failing parser fixture' },
      async parseMealCandidates() {
        failedCalls += 1;
        throw new Error('SYNTHETIC_PARSER_FAILURE');
      },
    };
    app = await buildApp({
      databasePath: join(directory, 'app.sqlite'), artifactRoot: join(directory, 'artifacts'), logger: false,
      healthTextProvider: failedProvider,
      v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: directory },
    });
    const failedPayload = { ...successPayload, localDate: '2026-09-15' };
    const firstFailure = await app.inject({ method: 'POST', url: '/v1/nutrition/meal-drafts', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-parser-failed-replay01' }, payload: failedPayload });
    const replayFailure = await app.inject({ method: 'POST', url: '/v1/nutrition/meal-drafts', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-parser-failed-replay01' }, payload: failedPayload });
    expect(firstFailure.statusCode).toBe(503);
    expect(replayFailure.statusCode).toBe(503);
    expect(replayFailure.json()).toEqual(firstFailure.json());
    expect(replayFailure.headers['idempotency-replayed']).toBe('true');
    expect(failedCalls).toBe(1);

    const database = openDatabase(join(directory, 'app.sqlite'));
    try {
      expect(database.prepare(`select count(*) as count from meal_drafts_v2 where local_date = '2026-09-15'`).get()).toEqual({ count: 0 });
      expect(database.prepare(`select state, count(*) as count from v07_capability_runs where capability = 'MEAL_CANDIDATE_PARSE' and local_date = '2026-09-15' group by state`).get()).toEqual({ state: 'FAILED', count: 1 });
    } finally {
      database.close();
    }
  });

  it('calls nutrition matching once and exactly replays a failed response without domain facts', async () => {
    const source = { sourceKind: 'TEST_FIXTURE', sourceId: 'ev-v07-idem-match', sourceVersion: '1', datasetHash: 'b'.repeat(64), redistribution: false, licenseDecisionId: null } as const;
    let providerCalls = 0;
    const provider: NutritionDataProvider = {
      descriptor: { providerId: 'v07-idem-match-fail', providerLabel: 'Synthetic failing nutrition fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', source },
      async searchBatch() {
        providerCalls += 1;
        throw new Error('SYNTHETIC_NUTRITION_FAILURE');
      },
    };
    await app!.close();
    app = await buildApp({
      databasePath: join(directory, 'app.sqlite'), artifactRoot: join(directory, 'artifacts'), logger: false,
      nutritionDataProvider: provider,
      v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: directory },
    });
    const draft = await app.inject({
      method: 'POST', url: '/v1/nutrition/meal-drafts', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-match-fail-draft-key01' },
      payload: { mode: 'MANUAL', localDate: '2026-09-16', candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }] },
    });
    const payload = { expectedVersion: 1, revisionId: draft.json().data.revision.id };
    const url = `/v1/nutrition/meal-drafts/${draft.json().data.draft.id}/matches`;
    const first = await app.inject({ method: 'POST', url, cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-match-failed-replay01' }, payload });
    const replay = await app.inject({ method: 'POST', url, cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-match-failed-replay01' }, payload });
    expect(first.statusCode).toBe(503);
    expect(replay.statusCode).toBe(503);
    expect(replay.json()).toEqual(first.json());
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(providerCalls).toBe(1);
    const database = openDatabase(join(directory, 'app.sqlite'));
    try {
      expect(database.prepare('select count(*) as count from nutrition_food_snapshots_v2').get()).toEqual({ count: 0 });
      expect(database.prepare(`select state, count(*) as count from v07_capability_runs where capability = 'NUTRITION_DATA_LOOKUP' group by state`).get()).toEqual({ state: 'FAILED', count: 1 });
    } finally {
      database.close();
    }
  });
});
