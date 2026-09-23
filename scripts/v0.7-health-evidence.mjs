import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const capabilityKeys = new Set([
  'WORKOUT_TEXT_SELECTION',
  'MEAL_CANDIDATE_PARSE',
  'NUTRITION_DATA_LOOKUP',
]);
const sha256Pattern = /^[0-9a-f]{64}$/;
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isExactObject(value, keys) {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function validateV07HealthEvidence(value) {
  if (!isExactObject(value, ['capabilityRuns', 'nutritionHashes'])
    || !Array.isArray(value.capabilityRuns)
    || !Array.isArray(value.nutritionHashes)) {
    throw new Error('V07_HEALTH_EVIDENCE_INVALID');
  }
  const observedCapabilities = new Set();
  for (const run of value.capabilityRuns) {
    if (!isExactObject(run, ['capabilityKey', 'runId', 'adapterKind', 'evidenceKind'])
      || !capabilityKeys.has(run.capabilityKey)
      || !runIdPattern.test(run.runId)
      || run.adapterKind !== 'TEST_FIXTURE'
      || run.evidenceKind !== 'AUTOMATED_TEST_FIXTURE') {
      throw new Error('V07_HEALTH_EVIDENCE_INVALID');
    }
    observedCapabilities.add(run.capabilityKey);
  }
  if (observedCapabilities.size !== capabilityKeys.size) {
    throw new Error('V07_HEALTH_EVIDENCE_INCOMPLETE');
  }
  if (value.nutritionHashes.length === 0) {
    throw new Error('V07_HEALTH_EVIDENCE_INCOMPLETE');
  }
  for (const lineage of value.nutritionHashes) {
    if (!isExactObject(lineage, ['datasetHash', 'recordHash'])
      || !sha256Pattern.test(lineage.datasetHash)
      || !sha256Pattern.test(lineage.recordHash)) {
      throw new Error('V07_HEALTH_EVIDENCE_INVALID');
    }
  }
  return value;
}

export async function preserveV07HealthEvidence(sourcePath, destinationPath) {
  const source = await readFile(sourcePath, 'utf8');
  validateV07HealthEvidence(JSON.parse(source));
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}
