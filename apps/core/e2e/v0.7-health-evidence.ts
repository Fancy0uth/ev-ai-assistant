import { writeFile } from 'node:fs/promises';
import type Database from 'better-sqlite3';

export const V07_HEALTH_EVIDENCE_FILE = 'v0.7-health-evidence.json';

export interface V07HealthEvidence {
  capabilityRuns: Array<{
    capabilityKey: 'WORKOUT_TEXT_SELECTION' | 'MEAL_CANDIDATE_PARSE' | 'NUTRITION_DATA_LOOKUP';
    runId: string;
    adapterKind: 'TEST_FIXTURE';
    evidenceKind: 'AUTOMATED_TEST_FIXTURE';
  }>;
  nutritionHashes: Array<{
    datasetHash: string;
    recordHash: string;
  }>;
}

export function collectV07HealthEvidence(database: Database.Database): V07HealthEvidence {
  const capabilityRuns = database.prepare(`
    select capability as capabilityKey, id as runId,
           adapter_kind as adapterKind, evidence_kind as evidenceKind
    from v07_capability_runs
    where state = 'SUCCEEDED'
      and adapter_kind = 'TEST_FIXTURE'
      and evidence_kind = 'AUTOMATED_TEST_FIXTURE'
    order by capability, id
  `).all() as V07HealthEvidence['capabilityRuns'];
  const nutritionHashes = database.prepare(`
    select distinct source.dataset_hash as datasetHash, food.record_hash as recordHash
    from nutrition_food_snapshots_v2 food
    join nutrition_source_snapshots_v2 source on source.id = food.source_snapshot_id
    where source.source_kind = 'TEST_FIXTURE'
      and source.adapter_kind = 'TEST_FIXTURE'
      and source.evidence_kind = 'AUTOMATED_TEST_FIXTURE'
    order by source.dataset_hash, food.record_hash
  `).all() as V07HealthEvidence['nutritionHashes'];
  return { capabilityRuns, nutritionHashes };
}

export async function writeV07HealthEvidence(
  database: Database.Database,
  evidencePath: string,
): Promise<void> {
  await writeFile(evidencePath, JSON.stringify(collectV07HealthEvidence(database)), 'utf8');
}
