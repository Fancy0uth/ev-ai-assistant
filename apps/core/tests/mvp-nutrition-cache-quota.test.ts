import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '../src/storage/database';
import { canonicalJson, createV07HealthLoopRepository } from '../src/modules/health-loop/repository';
import { createNutritionService } from '../src/modules/nutrition/service';
import type { NutritionDataProvider } from '../src/modules/nutrition/provider';

it('confirms a cached food without network or exhausted external quota, retaining the quota for a cache miss', async () => {
  const database = openDatabase(':memory:');
  try {
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run('cache-owner', 'cache-owner', 'synthetic-only', new Date().toISOString());
    const source = { sourceKind: 'TEST_FIXTURE', sourceId: 'cache-fixture', sourceVersion: '1', datasetHash: 'a'.repeat(64), redistribution: false, licenseDecisionId: null } as const;
    const base = { schemaVersion: 'NUTRITION_RECORD_V1', source, recordId: 'rice-cooked', displayName: 'Synthetic cooked rice', serving: { quantityDecimal: '100', unit: 'GRAM' }, nutrientsPerServing: { energyKcalDecimal: '100', proteinGramsDecimal: '10', carbohydrateGramsDecimal: '20', fatGramsDecimal: '5' } } as const;
    const record = { ...base, recordHash: createHash('sha256').update(canonicalJson(base)).digest('hex') };
    let cached = true;
    const external = vi.fn(async () => { throw new Error('must not call network'); });
    const provider: NutritionDataProvider = {
      descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Cache fixture', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE', source },
      deadlineMs: 60_000,
      readCachedBatch: input => cached ? { groups: input.queries.map(query => ({ candidateId: query.candidateId, records: [record] })) } : undefined,
      searchBatch: external,
    };
    const quota = vi.fn(() => 5);
    const service = createNutritionService(database, { nutritionDataProvider: provider, healthLoopRepository: { ...createV07HealthLoopRepository(database), countReservedCalls: quota } });
    const input = { mode: 'MANUAL', localDate: '2026-09-20', candidates: [{ displayName: 'Synthetic cooked rice', quantityDecimal: '200', unit: 'GRAM' }] } as const;
    const first = await service.createMealDraft('cache-owner', { ...input, candidates: [...input.candidates] }, 'cached-draft-0001');
    const matched = await service.matchMealDraft('cache-owner', first.draft.id, { expectedVersion: first.draft.version, revisionId: first.revision.id }, 'cached-match-0001');
    expect(external).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
    expect(database.prepare("select reserved_calls, actual_calls, state from v07_capability_runs where capability='NUTRITION_DATA_LOOKUP'").get()).toEqual({ reserved_calls: 0, actual_calls: 0, state: 'SUCCEEDED' });
    const selected = service.reviseMealDraft('cache-owner', first.draft.id, { operation: 'SELECT_MATCHES', expectedVersion: matched.draft.version, parentRevisionId: matched.revision.id, candidates: [{ candidateId: matched.revision.candidates[0]!.candidateId, included: true, selectedFoodSnapshotId: matched.matches[0]!.snapshots[0]!.id }] }, 'cached-select-0001');
    const confirmed = service.confirmMealDraft('cache-owner', first.draft.id, { expectedVersion: selected.draft.version, revisionId: selected.revision.id }, 'cached-confirm-0001');
    expect(confirmed.meal.totals.energyKcalDecimal).toBe('200');
    cached = false;
    const second = await service.createMealDraft('cache-owner', { ...input, candidates: [...input.candidates] }, 'miss-draft-00001');
    await expect(service.matchMealDraft('cache-owner', second.draft.id, { expectedVersion: second.draft.version, revisionId: second.revision.id }, 'miss-match-00001')).rejects.toMatchObject({ statusCode: 429 });
    expect(external).not.toHaveBeenCalled();
    expect(quota).toHaveBeenCalledOnce();
  } finally { database.close(); }
});
