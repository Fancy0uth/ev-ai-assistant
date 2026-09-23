import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/modules/health-loop/repository';
import { runMigrations } from '../src/storage/migrations';
import {
  computeV07SyntheticHash,
  createV07HealthTestAdapters,
  V07_SYNTHETIC_DATASET_HASH,
  V07_SYNTHETIC_DATASET_PREIMAGE,
  V07_SYNTHETIC_RECORD_HASH,
  V07_SYNTHETIC_RECORD_WITHOUT_HASH,
} from '../e2e/v0.7-health-test-adapters';
import { writeV07HealthEvidence } from '../e2e/v0.7-health-evidence';

const canonicalDatasetPreimage = [{
  schemaVersion: 'NUTRITION_RECORD_V1',
  source: {
    sourceKind: 'TEST_FIXTURE',
    sourceId: 'ev-v07-synthetic-foods',
    sourceVersion: '1',
    redistribution: false,
    licenseDecisionId: null,
  },
  recordId: 'fixture-food-alpha',
  displayName: 'Fixture Food Alpha',
  serving: { quantityDecimal: '100', unit: 'GRAM' },
  nutrientsPerServing: {
    energyKcalDecimal: '100',
    proteinGramsDecimal: '10',
    carbohydrateGramsDecimal: '20',
    fatGramsDecimal: '5',
  },
}];

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

describe('v0.7 synthetic health evidence lineage', () => {
  it('content-addresses the complete canonical dataset and independently hashes its record', async () => {
    const adapters = createV07HealthTestAdapters();
    const source = adapters.nutritionDataProvider.descriptor.source;
    expect(V07_SYNTHETIC_DATASET_PREIMAGE).toEqual(canonicalDatasetPreimage);
    expect(V07_SYNTHETIC_DATASET_HASH).toBe(computeV07SyntheticHash(canonicalDatasetPreimage));
    expect(source.datasetHash).toBe(sha256(canonicalDatasetPreimage));

    const output = await adapters.nutritionDataProvider.searchBatch({
      queries: [{ candidateId: '00000000-0000-4000-8000-000000000001', query: 'Fixture Food Alpha', unit: 'GRAM', limit: 5 }],
    }, new AbortController().signal);
    const record = (output as { groups: Array<{ records: Array<Record<string, unknown>> }> }).groups[0]?.records[0];
    expect(record).toBeDefined();
    const { recordHash, ...recordWithoutHash } = record!;
    expect(recordHash).toBe(sha256(recordWithoutHash));
    expect(V07_SYNTHETIC_RECORD_WITHOUT_HASH).toEqual(recordWithoutHash);
    expect(V07_SYNTHETIC_RECORD_HASH).toBe(sha256(recordWithoutHash));

    const changedPreimage = structuredClone(canonicalDatasetPreimage);
    changedPreimage[0]!.nutrientsPerServing.energyKcalDecimal = '101';
    expect(sha256(changedPreimage)).not.toBe(source.datasetHash);
  });

  it('fails loudly for an unknown synthetic nutrition lookup', async () => {
    const adapters = createV07HealthTestAdapters();
    await expect(adapters.nutritionDataProvider.searchBatch({
      queries: [{ candidateId: '00000000-0000-4000-8000-000000000002', query: 'Unknown synthetic food', unit: 'GRAM', limit: 5 }],
    }, new AbortController().signal)).rejects.toThrow('UNKNOWN_SYNTHETIC_NUTRITION_QUERY');
  });

  it('writes only redacted capability and hash evidence from committed Core rows', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-v07-health-evidence-'));
    const evidencePath = join(directory, 'v0.7-health-evidence.json');
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database);
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run('owner-evidence', 'Owner secret input', 'hash', '2026-09-01T00:00:00.000Z');
      const runIds = {
        WORKOUT_TEXT_SELECTION: '00000000-0000-4000-8000-000000000011',
        MEAL_CANDIDATE_PARSE: '00000000-0000-4000-8000-000000000012',
        NUTRITION_DATA_LOOKUP: '00000000-0000-4000-8000-000000000013',
      } as const;
      const insertRun = database.prepare(`insert into v07_capability_runs (
        id, owner_id, capability, operation, resource_id, provider_id, provider_label,
        adapter_kind, evidence_kind, disclosure_json, disclosure_version, state,
        policy_version, local_date, app_version, created_at, updated_at, version
      ) values (?, 'owner-evidence', ?, 'fixture', 'resource', 'fixture', 'Fixture',
        'TEST_FIXTURE', 'AUTOMATED_TEST_FIXTURE', '{}', 'HEALTH_DISCLOSURE_V1', 'SUCCEEDED',
        'HEALTH_CAPABILITY_POLICY_V1', '2026-09-01', '0.7.0',
        '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)`);
      for (const [capability, runId] of Object.entries(runIds)) insertRun.run(runId, capability);
      database.prepare(`insert into meal_drafts_v2 values (
        'draft-evidence', 'owner-evidence', '2026-09-01', 'MANUAL', null,
        'CANDIDATES_READY', null, null, 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
      )`).run();
      database.prepare(`insert into nutrition_source_snapshots_v2 values (
        'source-evidence', 'owner-evidence', 'TEST_FIXTURE', 'ev-v07-synthetic-foods', '1', ?,
        0, null, 'TEST_FIXTURE', 'AUTOMATED_TEST_FIXTURE', '2026-09-01T00:00:00.000Z'
      )`).run(V07_SYNTHETIC_DATASET_HASH);
      database.prepare(`insert into nutrition_food_snapshots_v2 values (
        'food-evidence', 'owner-evidence', 'draft-evidence', 'candidate-evidence', 'source-evidence',
        'fixture-food-alpha', ?, 'Fixture Food Alpha', '100', 'GRAM', '100', '10', '20', '5', ?,
        '2026-09-01T00:00:00.000Z'
      )`).run(V07_SYNTHETIC_RECORD_HASH, runIds.NUTRITION_DATA_LOOKUP);

      await writeV07HealthEvidence(database, evidencePath);
      const text = readFileSync(evidencePath, 'utf8');
      const evidence = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(evidence).sort()).toEqual(['capabilityRuns', 'nutritionHashes']);
      expect(evidence.capabilityRuns).toHaveLength(3);
      expect(evidence.nutritionHashes).toEqual([{
        datasetHash: V07_SYNTHETIC_DATASET_HASH,
        recordHash: V07_SYNTHETIC_RECORD_HASH,
      }]);
      expect(text).not.toContain('Owner secret input');
      expect(text).not.toContain('Fixture Food Alpha');
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
