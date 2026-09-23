import { createHash } from 'node:crypto';
import {
  nutritionDataProviderDescriptorSchema,
  type NutritionSourceDescriptor,
} from '@ev/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/modules/health-loop/repository';
import type { NutritionDataProvider } from '../src/modules/nutrition/provider';
import { createNutritionService } from '../src/modules/nutrition/service';
import { openDatabase } from '../src/storage/database';

type ApprovedLocalSource = Extract<NutritionSourceDescriptor, { sourceKind: 'APPROVED_LOCAL_DATASET' }>;

function recordFor(source: ApprovedLocalSource) {
  const withoutHash = {
    schemaVersion: 'NUTRITION_RECORD_V1' as const,
    source,
    recordId: 'lineage-synthetic-food',
    displayName: 'Synthetic lineage food',
    serving: { quantityDecimal: '100', unit: 'GRAM' as const },
    nutrientsPerServing: {
      energyKcalDecimal: '100',
      proteinGramsDecimal: '10',
      carbohydrateGramsDecimal: '20',
      fatGramsDecimal: '5',
    },
  };
  return {
    ...withoutHash,
    recordHash: createHash('sha256').update(canonicalJson(withoutHash)).digest('hex'),
  };
}

function providerFor(source: ApprovedLocalSource, identity: string): NutritionDataProvider {
  const descriptor = nutritionDataProviderDescriptorSchema.parse({
    providerId: `lineage-local-${identity}`,
    providerLabel: `Synthetic lineage source ${identity}`,
    adapterKind: 'APPROVED_LOCAL_DATASET',
    evidenceKind: 'APPROVED_LOCAL_DATASET',
    source,
  });
  return {
    descriptor,
    async searchBatch(input) {
      return {
        groups: input.queries.map((query) => ({
          candidateId: query.candidateId,
          records: [recordFor(source)],
        })),
      };
    },
  };
}

function lineageCounts(database: ReturnType<typeof openDatabase>) {
  const count = (table: string) => (database.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count;
  return {
    sourceSnapshots: count('nutrition_source_snapshots_v2'),
    foodSnapshots: count('nutrition_food_snapshots_v2'),
    revisions: count('meal_revisions_v2'),
    meals: count('meals_v2'),
    mealEntries: count('meal_entries_v2'),
  };
}

describe('V07-LINEAGE-015 nutrition source lineage', () => {
  it('rejects a same-key immutable descriptor conflict without partial writes or a confirmable Meal', async () => {
    const database = openDatabase(':memory:');
    const ownerId = 'lineage-015-owner';
    const createdAt = '2026-09-07T00:00:00.000Z';
    const sourceA: ApprovedLocalSource = {
      sourceKind: 'APPROVED_LOCAL_DATASET',
      sourceId: 'lineage-synthetic-catalog',
      sourceVersion: 'v1',
      datasetHash: 'c'.repeat(64),
      redistribution: false,
      licenseDecisionId: 'lineage-license-a',
    };
    const sourceB: ApprovedLocalSource = {
      ...sourceA,
      redistribution: true,
      licenseDecisionId: 'lineage-license-b',
    };

    try {
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(ownerId, 'lineage-015-owner', 'synthetic-hash', createdAt);

      const serviceA = createNutritionService(database, {
        now: () => new Date(createdAt),
        nutritionDataProvider: providerFor(sourceA, 'a'),
      });
      const firstDraft = await serviceA.createMealDraft(ownerId, {
        mode: 'MANUAL',
        localDate: '2026-09-06',
        candidates: [{ displayName: 'Synthetic lineage food', quantityDecimal: '150', unit: 'GRAM' }],
      }, 'v07-lineage-015-source-a-draft');
      const firstMatch = await serviceA.matchMealDraft(ownerId, firstDraft.draft.id, {
        expectedVersion: firstDraft.draft.version,
        revisionId: firstDraft.revision.id,
      }, 'v07-lineage-015-source-a-match');
      expect(firstMatch).toMatchObject({
        draft: { state: 'MATCHES_READY' },
        matches: [{ status: 'MATCHED', snapshots: [{ source: sourceA }] }],
      });
      const firstSelection = serviceA.reviseMealDraft(ownerId, firstDraft.draft.id, {
        expectedVersion: firstMatch.draft.version,
        parentRevisionId: firstMatch.revision.id,
        operation: 'SELECT_MATCHES',
        candidates: [{
          candidateId: firstMatch.revision.candidates[0]!.candidateId,
          included: true,
          selectedFoodSnapshotId: firstMatch.matches[0]!.snapshots[0]!.id,
        }],
      }, 'v07-lineage-015-source-a-select');
      const firstConfirmed = serviceA.confirmMealDraft(ownerId, firstDraft.draft.id, {
        expectedVersion: firstSelection.draft.version,
        revisionId: firstSelection.revision.id,
      }, 'v07-lineage-015-source-a-confirm');
      expect(firstConfirmed.draft.state).toBe('CONFIRMED');

      const serviceB = createNutritionService(database, {
        now: () => new Date(createdAt),
        nutritionDataProvider: providerFor(sourceB, 'b'),
      });
      const conflictingDraft = await serviceB.createMealDraft(ownerId, {
        mode: 'MANUAL',
        localDate: '2026-09-07',
        candidates: [{ displayName: 'Synthetic lineage food', quantityDecimal: '150', unit: 'GRAM' }],
      }, 'v07-lineage-015-source-b-draft');
      const beforeConflict = lineageCounts(database);

      await expect(serviceB.matchMealDraft(ownerId, conflictingDraft.draft.id, {
        expectedVersion: conflictingDraft.draft.version,
        revisionId: conflictingDraft.revision.id,
      }, 'v07-lineage-015-source-b-match')).rejects.toMatchObject({
        statusCode: 409,
        code: 'NUTRITION_SOURCE_DESCRIPTOR_CONFLICT',
      });

      expect(lineageCounts(database)).toEqual(beforeConflict);
      expect(database.prepare(`select source_kind, source_id, source_version, dataset_hash, redistribution,
        license_decision_id, adapter_kind, evidence_kind from nutrition_source_snapshots_v2`).all()).toEqual([{
        source_kind: sourceA.sourceKind,
        source_id: sourceA.sourceId,
        source_version: sourceA.sourceVersion,
        dataset_hash: sourceA.datasetHash,
        redistribution: 0,
        license_decision_id: sourceA.licenseDecisionId,
        adapter_kind: 'APPROVED_LOCAL_DATASET',
        evidence_kind: 'APPROVED_LOCAL_DATASET',
      }]);
      expect(serviceB.getMealDraft(ownerId, conflictingDraft.draft.id)).toMatchObject({
        draft: { state: 'CANDIDATES_READY', version: 1 },
        revision: { id: conflictingDraft.revision.id, revisionNo: 1 },
        matches: [{ status: 'UNMATCHED', snapshots: [] }],
      });

      let confirmationError: unknown;
      try {
        serviceB.confirmMealDraft(ownerId, conflictingDraft.draft.id, {
          expectedVersion: conflictingDraft.draft.version,
          revisionId: conflictingDraft.revision.id,
        }, 'v07-lineage-015-source-b-confirm');
      } catch (error) {
        confirmationError = error;
      }
      expect(confirmationError).toMatchObject({ statusCode: 422, code: 'MEAL_MATCH_INCOMPLETE' });
      expect(lineageCounts(database)).toEqual(beforeConflict);
    } finally {
      database.close();
    }
  });
});
