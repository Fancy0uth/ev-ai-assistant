import { createHash } from 'node:crypto';
import {
  catalogQuerySchema,
  externalCatalogSourceMetadataSchema,
  externalExerciseCatalogSchema,
  externalExerciseRecordSchema,
  externalKeySchema,
  exerciseReviewRecordSchema,
  listEligibleCatalogInputSchema,
  planCandidateV2Schema,
  type CatalogQuery,
  type ExerciseReviewRecord,
  type ExternalExerciseCatalog,
  type ExternalExerciseRecord,
  type ExternalKey,
  type ListEligibleCatalogInput,
  type PlanCandidateV2,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import { canonicalJson } from '../health-loop/repository';
import type { ExternalExerciseCatalog as ParsedExternalExerciseCatalog } from './external-catalog';

const sourceMetadata = externalCatalogSourceMetadataSchema.parse({
  sourceId: 'hasaneyldrm/exercises-dataset',
  license: 'MIT',
  noticeRef: 'UPSTREAM_NOTICE_MEDIA_NOT_IMPORTED',
});

type CatalogItemRow = {
  source_id: string;
  revision: string;
  upstream_id: string;
  name: string;
  body_part: string;
  equipment: string;
  target: string;
  secondary_muscles_json: string;
  instructions_json: string;
  safety_review: string;
  item_hash: string;
  catalog_hash: string;
};

type ReviewRow = CatalogItemRow & {
  review_id: string;
  decision: string;
  reviewer_id: string;
  qualification_ref: string;
  evidence_ref: string;
  reviewed_at: string;
  impact: string;
  scope_json: string;
  parameter_limits_json: string;
  supersedes_review_id: string | null;
};

export class CatalogRevisionConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'CATALOG_REVISION_CONFLICT';

  constructor() {
    super('CATALOG_REVISION_CONFLICT');
    this.name = 'CatalogRevisionConflictError';
  }
}

export interface FitnessCatalogRepository {
  importCatalog(input: ParsedExternalExerciseCatalog): { catalogHash: string; inserted: boolean };
  search(query: CatalogQuery): { items: ExternalExerciseRecord[]; total: number };
  resolve(key: ExternalKey): ExternalExerciseRecord | undefined;
  appendReview(input: ExerciseReviewRecord): void;
  listEligible(input: ListEligibleCatalogInput): PlanCandidateV2[];
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function orderedItems(catalog: ExternalExerciseCatalog): ExternalExerciseCatalog['items'] {
  return [...catalog.items].sort((left, right) => (
    left.upstreamId < right.upstreamId ? -1 : left.upstreamId > right.upstreamId ? 1 : 0
  ));
}

function catalogFacts(catalog: ExternalExerciseCatalog): unknown {
  return {
    sourceId: catalog.sourceId,
    revision: catalog.revision,
    license: catalog.license,
    noticeRef: sourceMetadata.noticeRef,
    items: orderedItems(catalog),
  };
}

function itemFacts(catalog: ExternalExerciseCatalog, item: ExternalExerciseCatalog['items'][number]): unknown {
  return {
    sourceId: catalog.sourceId,
    revision: catalog.revision,
    item,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function toRecord(row: CatalogItemRow): ExternalExerciseRecord {
  return externalExerciseRecordSchema.parse({
    sourceId: row.source_id,
    revision: row.revision,
    upstreamId: row.upstream_id,
    name: row.name,
    bodyPart: row.body_part,
    equipment: row.equipment,
    target: row.target,
    secondaryMuscles: JSON.parse(row.secondary_muscles_json),
    instructions: JSON.parse(row.instructions_json),
    safetyReview: row.safety_review,
    catalogHash: row.catalog_hash,
    itemHash: row.item_hash,
  });
}

function toReview(row: ReviewRow): ExerciseReviewRecord {
  return exerciseReviewRecordSchema.parse({
    key: { sourceId: row.source_id, revision: row.revision, upstreamId: row.upstream_id },
    itemHash: row.item_hash,
    reviewId: row.review_id,
    decision: row.decision,
    reviewerId: row.reviewer_id,
    qualificationRef: row.qualification_ref,
    evidenceRef: row.evidence_ref,
    reviewedAt: row.reviewed_at,
    impact: row.impact,
    scope: JSON.parse(row.scope_json),
    parameterLimits: JSON.parse(row.parameter_limits_json),
    supersedesReviewId: row.supersedes_review_id,
  });
}

function matchesEligibleReview(review: ExerciseReviewRecord, input: ListEligibleCatalogInput): boolean {
  if (review.decision !== 'ELIGIBLE'
    || review.qualificationRef === 'UNKNOWN'
    || review.evidenceRef === 'UNKNOWN'
    || review.impact === 'UNKNOWN'
    || review.scope.applicablePopulation === 'UNKNOWN'
    || review.scope.contraindicationLimitations === 'UNKNOWN'
    || Object.values(review.parameterLimits).some((value) => value === 'UNKNOWN')) {
    return false;
  }
  if (!review.scope.goals.includes(input.goal)) return false;
  const equipment = new Set(input.equipment.map((value) => value.toLowerCase()));
  if (!review.scope.equipment.some((value) => equipment.has(value.toLowerCase()))) return false;
  const rank = { LOW: 0, MODERATE: 1 } as const;
  return rank[review.scope.intensityCap] <= rank[input.intensityCap];
}

export function createFitnessCatalogRepository(database: Database.Database): FitnessCatalogRepository {
  const findSnapshot = database.prepare(`select catalog_hash from fitness_catalog_snapshots
    where source_id = ? and revision = ?`);
  const insertSnapshot = database.prepare(`insert into fitness_catalog_snapshots (
    source_id, revision, license_id, notice_ref, catalog_hash, item_count, created_at
  ) values (?, ?, ?, ?, ?, ?, ?)`);
  const insertItem = database.prepare(`insert into fitness_catalog_items (
    source_id, revision, upstream_id, name, body_part, equipment, target, secondary_muscles_json,
    instructions_json, safety_review, item_hash, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const findItem = database.prepare(`select
    i.source_id, i.revision, i.upstream_id, i.name, i.body_part, i.equipment, i.target,
    i.secondary_muscles_json, i.instructions_json, i.safety_review, i.item_hash, s.catalog_hash
    from fitness_catalog_items as i
    join fitness_catalog_snapshots as s on s.source_id = i.source_id and s.revision = i.revision
    where i.source_id = ? and i.revision = ? and i.upstream_id = ?`);
  const findItemHash = database.prepare(`select item_hash from fitness_catalog_items
    where source_id = ? and revision = ? and upstream_id = ?`);
  const findActiveReview = database.prepare(`select review_id from fitness_catalog_reviews as review
    where review.source_id = ? and review.revision = ? and review.upstream_id = ?
      and not exists (
        select 1 from fitness_catalog_reviews as successor
        where successor.supersedes_review_id = review.review_id
      )`);
  const findReview = database.prepare(`select review_id, source_id, revision, upstream_id, item_hash
    from fitness_catalog_reviews where review_id = ?`);
  const insertReview = database.prepare(`insert into fitness_catalog_reviews (
    review_id, source_id, revision, upstream_id, item_hash, decision, reviewer_id, qualification_ref,
    evidence_ref, reviewed_at, impact, scope_json, parameter_limits_json, supersedes_review_id, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const activeEligibleReviews = database.prepare(`select
    i.source_id, i.revision, i.upstream_id, i.name, i.body_part, i.equipment, i.target,
    i.secondary_muscles_json, i.instructions_json, i.safety_review, i.item_hash, s.catalog_hash,
    review.review_id, review.decision, review.reviewer_id, review.qualification_ref, review.evidence_ref,
    review.reviewed_at, review.impact, review.scope_json, review.parameter_limits_json,
    review.supersedes_review_id
    from fitness_catalog_reviews as review
    join fitness_catalog_items as i on i.source_id = review.source_id
      and i.revision = review.revision and i.upstream_id = review.upstream_id
    join fitness_catalog_snapshots as s on s.source_id = i.source_id and s.revision = i.revision
    where review.decision = 'ELIGIBLE'
      and review.qualification_ref <> 'UNKNOWN'
      and review.evidence_ref <> 'UNKNOWN'
      and review.impact = 'LOW'
      and json_type(review.scope_json, '$.applicablePopulation') = 'text'
      and json_extract(review.scope_json, '$.applicablePopulation') <> 'UNKNOWN'
      and json_type(review.scope_json, '$.contraindicationLimitations') = 'array'
      and json_array_length(review.scope_json, '$.contraindicationLimitations') between 1 and 5
      and json_type(review.parameter_limits_json, '$.roundsMax') = 'integer'
      and json_extract(review.parameter_limits_json, '$.roundsMax') between 1 and 5
      and json_type(review.parameter_limits_json, '$.repsMax') = 'integer'
      and json_extract(review.parameter_limits_json, '$.repsMax') between 1 and 50
      and json_type(review.parameter_limits_json, '$.durationSecondsMax') = 'integer'
      and json_extract(review.parameter_limits_json, '$.durationSecondsMax') between 30 and 1800
      and json_type(review.parameter_limits_json, '$.restSecondsMax') = 'integer'
      and json_extract(review.parameter_limits_json, '$.restSecondsMax') between 0 and 600
      and exists (
        select 1 from json_each(review.scope_json, '$.goals') as review_goal
        where review_goal.value = ?
      )
      and exists (
        select 1 from json_each(review.scope_json, '$.equipment') as review_equipment
        join json_each(?) as requested_equipment
          on lower(review_equipment.value) = lower(requested_equipment.value)
      )
      and (
        json_extract(review.scope_json, '$.intensityCap') = 'LOW'
        or (? = 'MODERATE' and json_extract(review.scope_json, '$.intensityCap') = 'MODERATE')
      )
      and not exists (
        select 1 from fitness_catalog_reviews as successor
        where successor.supersedes_review_id = review.review_id
      )
    order by review.reviewed_at desc, review.review_id desc
    limit ?`);

  const importTransaction = database.transaction((catalog: ExternalExerciseCatalog, catalogHash: string) => {
    const existing = findSnapshot.get(catalog.sourceId, catalog.revision) as { catalog_hash: string } | undefined;
    if (existing) {
      if (existing.catalog_hash !== catalogHash) throw new CatalogRevisionConflictError();
      return { catalogHash, inserted: false };
    }
    const createdAt = new Date().toISOString();
    const items = orderedItems(catalog);
    insertSnapshot.run(
      catalog.sourceId,
      catalog.revision,
      catalog.license,
      sourceMetadata.noticeRef,
      catalogHash,
      items.length,
      createdAt,
    );
    for (const item of items) {
      insertItem.run(
        catalog.sourceId,
        catalog.revision,
        item.upstreamId,
        item.name,
        item.bodyPart,
        item.equipment,
        item.target,
        canonicalJson(item.secondaryMuscles),
        canonicalJson(item.instructions),
        item.safetyReview,
        sha256(itemFacts(catalog, item)),
        createdAt,
      );
    }
    return { catalogHash, inserted: true };
  });

  const appendReviewTransaction = database.transaction((review: ExerciseReviewRecord) => {
    const item = findItemHash.get(
      review.key.sourceId,
      review.key.revision,
      review.key.upstreamId,
    ) as { item_hash: string } | undefined;
    if (!item || item.item_hash !== review.itemHash) throw new Error('EXERCISE_REVIEW_ITEM_HASH_MISMATCH');

    const active = findActiveReview.get(
      review.key.sourceId,
      review.key.revision,
      review.key.upstreamId,
    ) as { review_id: string } | undefined;
    if (!active && review.supersedesReviewId !== null) throw new Error('EXERCISE_REVIEW_SUPERSEDES_NOT_ACTIVE');
    if (active && review.supersedesReviewId !== active.review_id) throw new Error('EXERCISE_REVIEW_SUPERSEDES_REQUIRED');
    if (review.supersedesReviewId !== null) {
      const superseded = findReview.get(review.supersedesReviewId) as {
        review_id: string;
        source_id: string;
        revision: string;
        upstream_id: string;
        item_hash: string;
      } | undefined;
      if (!superseded
        || superseded.source_id !== review.key.sourceId
        || superseded.revision !== review.key.revision
        || superseded.upstream_id !== review.key.upstreamId
        || superseded.item_hash !== review.itemHash) {
        throw new Error('EXERCISE_REVIEW_SUPERSEDES_SCOPE_MISMATCH');
      }
    }
    insertReview.run(
      review.reviewId,
      review.key.sourceId,
      review.key.revision,
      review.key.upstreamId,
      review.itemHash,
      review.decision,
      review.reviewerId,
      review.qualificationRef,
      review.evidenceRef,
      review.reviewedAt,
      review.impact,
      canonicalJson(review.scope),
      canonicalJson(review.parameterLimits),
      review.supersedesReviewId,
      review.reviewedAt,
    );
  });

  return {
    importCatalog(input) {
      const catalog = externalExerciseCatalogSchema.parse(input);
      return importTransaction(catalog, sha256(catalogFacts(catalog)));
    },
    search(input) {
      const query = catalogQuerySchema.parse(input);
      const predicates: string[] = [];
      const parameters: string[] = [];
      if (query.text !== undefined) {
        const pattern = `%${escapeLike(query.text.toLowerCase())}%`;
        predicates.push(`(
          lower(i.name) like ? escape '\\'
          or lower(i.body_part) like ? escape '\\'
          or lower(i.equipment) like ? escape '\\'
          or lower(i.target) like ? escape '\\'
          or lower(i.secondary_muscles_json) like ? escape '\\'
          or lower(i.instructions_json) like ? escape '\\'
        )`);
        parameters.push(pattern, pattern, pattern, pattern, pattern, pattern);
      }
      if (query.equipment !== undefined) {
        predicates.push('lower(i.equipment) = ?');
        parameters.push(query.equipment.toLowerCase());
      }
      if (query.muscle !== undefined) {
        predicates.push(`(
          lower(i.target) = ?
          or lower(i.body_part) = ?
          or exists (select 1 from json_each(i.secondary_muscles_json) as secondary where lower(secondary.value) = ?)
        )`);
        const muscle = query.muscle.toLowerCase();
        parameters.push(muscle, muscle, muscle);
      }
      const where = predicates.length === 0 ? '' : `where ${predicates.join(' and ')}`;
      const from = `from fitness_catalog_items as i
        join fitness_catalog_snapshots as s on s.source_id = i.source_id and s.revision = i.revision`;
      const total = (database.prepare(`select count(*) as count ${from} ${where}`).get(...parameters) as { count: number }).count;
      const rows = database.prepare(`select
        i.source_id, i.revision, i.upstream_id, i.name, i.body_part, i.equipment, i.target,
        i.secondary_muscles_json, i.instructions_json, i.safety_review, i.item_hash, s.catalog_hash
        ${from} ${where}
        order by i.upstream_id asc
        limit ? offset ?`).all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as CatalogItemRow[];
      return { items: rows.map(toRecord), total };
    },
    resolve(input) {
      const key = externalKeySchema.parse(input);
      const row = findItem.get(key.sourceId, key.revision, key.upstreamId) as CatalogItemRow | undefined;
      return row ? toRecord(row) : undefined;
    },
    appendReview(input) {
      appendReviewTransaction(exerciseReviewRecordSchema.parse(input));
    },
    listEligible(input) {
      const query = listEligibleCatalogInputSchema.parse(input);
      const candidates: PlanCandidateV2[] = [];
      const seenKeys = new Set<string>();
      const requestedEquipment = JSON.stringify(query.equipment.map((value) => value.toLowerCase()));
      for (const row of activeEligibleReviews.all(
        query.goal,
        requestedEquipment,
        query.intensityCap,
        query.limit,
      ) as ReviewRow[]) {
        const review = toReview(row);
        if (!matchesEligibleReview(review, query)) continue;
        const record = toRecord(row);
        const key = `${record.sourceId}:${record.revision}:${record.upstreamId}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        candidates.push(planCandidateV2Schema.parse({
          record,
          review: {
            reviewId: review.reviewId,
            qualificationRef: review.qualificationRef,
            evidenceRef: review.evidenceRef,
            reviewedAt: review.reviewedAt,
            impact: review.impact,
            scope: review.scope,
            parameterLimits: review.parameterLimits,
          },
          medicalSafety: 'NOT_MEDICALLY_CERTIFIED',
        }));
        if (candidates.length === query.limit) break;
      }
      return candidates;
    },
  };
}
