import { createHash } from 'node:crypto';
import {
  nutritionFoodRecordSchema,
  type NutritionFoodRecord,
  type ServingUnit,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import { canonicalJson } from '../health-loop/repository';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ENTRIES_PER_OWNER = 100;
const MAX_BYTES_PER_OWNER = 800_000;
const MAX_RECORD_BYTES = 4_000;
const MAX_EVIDENCE_BYTES = 6_000;

export interface NutritionWebCacheIdentity {
  query: string;
  unit: ServingUnit;
  adapterVersion: string;
}

export interface NutritionWebEvidence {
  sourceUrl: string;
  retrievedAt: string;
  sourceTextHash: string;
  quotes: {
    basis: string;
    energy: string;
    protein: string;
    carbohydrate: string;
    fat: string;
  };
}

export interface NutritionWebCacheEntry {
  record: NutritionFoodRecord;
  evidence: NutritionWebEvidence;
  createdAt: string;
  expiresAt: string;
}

export interface NutritionWebCache {
  key(identity: NutritionWebCacheIdentity): string;
  get(ownerId: string, identity: NutritionWebCacheIdentity): NutritionWebCacheEntry | undefined;
  getEvidence(ownerId: string, identity: NutritionWebCacheIdentity): NutritionWebEvidence | undefined;
  put(ownerId: string, identity: NutritionWebCacheIdentity, value: {
    record: NutritionFoodRecord;
    evidence: NutritionWebEvidence;
  }): boolean;
}

export interface NutritionWebCacheOptions {
  now?: () => Date;
}

interface CacheRow {
  record_json: string;
  evidence_json: string;
  created_at: string;
  expires_at: string;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function evidenceFrom(value: unknown): NutritionWebEvidence | undefined {
  if (!isRecord(value) || !exactKeys(value, ['quotes', 'retrievedAt', 'sourceTextHash', 'sourceUrl'])) return undefined;
  if (!validText(value.sourceUrl, 200) || !validText(value.retrievedAt, 40)
    || typeof value.sourceTextHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceTextHash)) return undefined;
  if (Number.isNaN(Date.parse(value.retrievedAt))) return undefined;
  if (!isRecord(value.quotes) || !exactKeys(value.quotes, ['basis', 'carbohydrate', 'energy', 'fat', 'protein'])) return undefined;
  const quotes = value.quotes;
  if (!validText(quotes.basis, 600) || !validText(quotes.energy, 600)
    || !validText(quotes.protein, 600) || !validText(quotes.carbohydrate, 600)
    || !validText(quotes.fat, 600)) return undefined;
  return {
    sourceUrl: value.sourceUrl,
    retrievedAt: value.retrievedAt,
    sourceTextHash: value.sourceTextHash,
    quotes: {
      basis: quotes.basis,
      energy: quotes.energy,
      protein: quotes.protein,
      carbohydrate: quotes.carbohydrate,
      fat: quotes.fat,
    },
  };
}

export function normalizeNutritionWebCacheQuery(query: string): string {
  return query.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function normalizedIdentity(identity: NutritionWebCacheIdentity): {
  normalizedQuery: string;
  unit: ServingUnit;
  adapterVersion: string;
} | undefined {
  const normalizedQuery = normalizeNutritionWebCacheQuery(identity.query);
  const adapterVersion = identity.adapterVersion.trim();
  if (!normalizedQuery || normalizedQuery.length > 500 || !adapterVersion || adapterVersion.length > 120) return undefined;
  if (identity.unit !== 'GRAM' && identity.unit !== 'MILLILITER' && identity.unit !== 'ITEM') return undefined;
  return { normalizedQuery, unit: identity.unit, adapterVersion };
}

function cacheKey(identity: NutritionWebCacheIdentity): string | undefined {
  const normalized = normalizedIdentity(identity);
  if (!normalized) return undefined;
  return createHash('sha256').update(canonicalJson({
    schemaVersion: 'NUTRITION_WEB_CACHE_KEY_V1',
    ...normalized,
  })).digest('hex');
}

function hasCanonicalRecordHash(record: NutritionFoodRecord): boolean {
  const { recordHash, ...withoutHash } = record;
  return recordHash === createHash('sha256').update(canonicalJson(withoutHash)).digest('hex');
}

function parseCacheRow(row: CacheRow): NutritionWebCacheEntry | undefined {
  let recordValue: unknown;
  let evidenceValue: unknown;
  try {
    recordValue = JSON.parse(row.record_json) as unknown;
    evidenceValue = JSON.parse(row.evidence_json) as unknown;
  } catch {
    return undefined;
  }
  const record = nutritionFoodRecordSchema.safeParse(recordValue);
  const evidence = evidenceFrom(evidenceValue);
  if (!record.success || !hasCanonicalRecordHash(record.data) || !evidence || evidence.sourceUrl !== record.data.recordId) return undefined;
  return {
    record: record.data,
    evidence,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createNutritionWebCache(
  database: Database.Database,
  options: NutritionWebCacheOptions = {},
): NutritionWebCache {
  const now = options.now ?? (() => new Date());
  const find = database.prepare(`select record_json, evidence_json, created_at, expires_at
    from nutrition_web_cache_v32 where owner_id = ? and cache_key = ? and expires_at > ?`);
  const deleteKey = database.prepare('delete from nutrition_web_cache_v32 where owner_id = ? and cache_key = ?');
  const deleteExpired = database.prepare('delete from nutrition_web_cache_v32 where owner_id = ? and expires_at <= ?');
  const countEntries = database.prepare('select count(*) as count from nutrition_web_cache_v32 where owner_id = ?');
  const totalBytes = database.prepare(`select coalesce(sum(length(cast(record_json as blob)) + length(cast(evidence_json as blob))), 0) as bytes
    from nutrition_web_cache_v32 where owner_id = ?`);
  const oldest = database.prepare(`select cache_key from nutrition_web_cache_v32
    where owner_id = ? order by created_at asc, cache_key asc limit 1`);
  const insert = database.prepare(`insert into nutrition_web_cache_v32 (
    owner_id, cache_key, normalized_query, serving_unit, adapter_version,
    record_json, evidence_json, created_at, expires_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  function discardOldest(ownerId: string): boolean {
    const row = oldest.get(ownerId) as { cache_key: string } | undefined;
    if (!row) return false;
    deleteKey.run(ownerId, row.cache_key);
    return true;
  }

  function get(ownerId: string, identity: NutritionWebCacheIdentity): NutritionWebCacheEntry | undefined {
    const key = cacheKey(identity);
    if (!key) return undefined;
    const row = find.get(ownerId, key, now().toISOString()) as CacheRow | undefined;
    if (!row) return undefined;
    const entry = parseCacheRow(row);
    if (entry) return entry;
    deleteKey.run(ownerId, key);
    return undefined;
  }

  return {
    key(identity) {
      return cacheKey(identity) ?? '';
    },
    get,
    getEvidence(ownerId, identity) {
      return get(ownerId, identity)?.evidence;
    },
    put(ownerId, identity, value) {
      const normalized = normalizedIdentity(identity);
      const key = cacheKey(identity);
      const record = nutritionFoodRecordSchema.safeParse(value.record);
      const evidence = evidenceFrom(value.evidence);
      if (!normalized || !key || !record.success || !evidence || evidence.sourceUrl !== record.data.recordId) return false;
      if (!hasCanonicalRecordHash(record.data)) return false;

      let recordJson: string;
      let evidenceJson: string;
      try {
        recordJson = canonicalJson(record.data);
        evidenceJson = canonicalJson(evidence);
      } catch {
        return false;
      }
      const entryBytes = utf8Bytes(recordJson) + utf8Bytes(evidenceJson);
      if (utf8Bytes(recordJson) > MAX_RECORD_BYTES || utf8Bytes(evidenceJson) > MAX_EVIDENCE_BYTES
        || entryBytes > MAX_RECORD_BYTES + MAX_EVIDENCE_BYTES) return false;

      const timestamp = now();
      const createdAt = timestamp.toISOString();
      const expiresAt = new Date(timestamp.getTime() + CACHE_TTL_MS).toISOString();
      try {
        deleteKey.run(ownerId, key);
        deleteExpired.run(ownerId, createdAt);
        while ((countEntries.get(ownerId) as { count: number }).count >= MAX_ENTRIES_PER_OWNER) {
          if (!discardOldest(ownerId)) return false;
        }
        while ((totalBytes.get(ownerId) as { bytes: number }).bytes + entryBytes > MAX_BYTES_PER_OWNER) {
          if (!discardOldest(ownerId)) return false;
        }
        insert.run(
          ownerId,
          key,
          normalized.normalizedQuery,
          normalized.unit,
          normalized.adapterVersion,
          recordJson,
          evidenceJson,
          createdAt,
          expiresAt,
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}
