import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exerciseCatalogItemSchema,
  exerciseCatalogManifestSchema,
  type ExerciseCatalogItem,
  type ExerciseCatalogManifest,
  type ExerciseCitation,
} from '@ev/contracts';
import * as z from 'zod';

export type InternalExerciseCatalogItem = ExerciseCatalogItem & { citation: ExerciseCitation };

export interface LoadedInternalExerciseCatalog {
  manifest: ExerciseCatalogManifest;
  items: InternalExerciseCatalogItem[];
}

export interface ExerciseCatalogImporter {
  importLoadedJson(input: {
    manifest: unknown;
    records: unknown;
    approvedSource: { sourceId: string; licenseDecisionId: string };
  }): void;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function citationFor(manifest: ExerciseCatalogManifest, item: ExerciseCatalogItem): ExerciseCitation {
  const itemHash = sha256(canonicalJson(item));
  return {
    citationId: sha256(`${manifest.catalogId}\n${manifest.catalogVersion}\n${manifest.contentSha256}\n${item.exerciseId}\n${itemHash}`),
    catalogId: manifest.catalogId,
    catalogVersion: manifest.catalogVersion,
    catalogHash: manifest.contentSha256,
    exerciseId: item.exerciseId,
    itemHash,
    sourceKind: 'FIRST_PARTY_INTERNAL',
    redistribution: false,
  };
}

export function loadInternalExerciseCatalog(): LoadedInternalExerciseCatalog {
  const directory = dirname(fileURLToPath(import.meta.url));
  const catalogBytes = readFileSync(join(directory, 'catalog', 'starter-v1.catalog.json'));
  const manifestBytes = readFileSync(join(directory, 'catalog', 'starter-v1.manifest.json'), 'utf8');
  try {
    const manifest = exerciseCatalogManifestSchema.parse(JSON.parse(manifestBytes));
    if (sha256(catalogBytes) !== manifest.contentSha256) throw new Error('catalog hash mismatch');
    const rawItems = z.array(exerciseCatalogItemSchema).length(manifest.itemCount).parse(JSON.parse(catalogBytes.toString('utf8')));
    if (new Set(rawItems.map((item) => item.exerciseId)).size !== manifest.itemCount) throw new Error('catalog exercise IDs are not unique');
    const items = rawItems
      .map((item) => ({ ...item, citation: citationFor(manifest, item) }))
      .sort((first, second) => first.exerciseId.localeCompare(second.exerciseId));
    return { manifest, items };
  } catch {
    throw new Error('INTERNAL_EXERCISE_CATALOG_INVALID');
  }
}
