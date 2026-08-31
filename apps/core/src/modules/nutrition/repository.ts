import { createHash } from 'node:crypto';
import {
  mealDraftSchema,
  mealCandidateMatchSchema,
  mealRevisionSchema,
  mealV2Schema,
  nutritionFoodRecordSchema,
  nutritionFoodSnapshotSchema,
  nutritionSourceDescriptorSchema,
  type CreateMealInput,
  type MealCandidate,
  type MealDraft,
  type MealRevision,
  type MealV2,
  type NutritionFoodRecord,
  type NutritionSourceDescriptor,
  type MealRecord,
  mealRecordSchema,
} from '@ev/contracts';
import { calculateMealTotalsV1, scaleNutrientV1 } from '@ev/domain';
import type Database from 'better-sqlite3';
import { canonicalJson } from '../health-loop/repository';

type MealCandidateMatch = ReturnType<typeof mealCandidateMatchSchema.parse>;

export interface MealDraftDetail {
  draft: MealDraft;
  revision: MealRevision;
  matches: MealCandidateMatch[];
  confirmedMeal: MealV2 | null;
}

export class MealDraftStateConflictError extends Error {
  constructor() {
    super('MEAL_DRAFT_STATE_CHANGED');
    this.name = 'MealDraftStateConflictError';
  }
}

export class MealConfirmationError extends Error {
  constructor(readonly code: 'MEAL_MATCH_INCOMPLETE' | 'UNIT_MISMATCH') {
    super(code);
    this.name = 'MealConfirmationError';
  }
}

interface DraftRow {
  id: string;
  local_date: string;
  mode: 'MANUAL' | 'PARSE_TEXT';
  original_text: string | null;
  state: MealDraft['state'];
  current_revision_id: string;
  confirmed_meal_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  id: string;
  draft_id: string;
  parent_revision_id: string | null;
  revision_no: number;
  candidates_json: string;
  content_hash: string;
  created_by: MealRevision['createdBy'];
  capability_run_id: string | null;
  created_at: string;
}

interface FoodRow {
  id: string;
  candidate_id: string;
  record_id: string;
  record_hash: string;
  display_name: string;
  serving_quantity_decimal: string;
  serving_unit: NutritionFoodRecord['serving']['unit'];
  energy_kcal_decimal: string;
  protein_grams_decimal: string;
  carbohydrate_grams_decimal: string;
  fat_grams_decimal: string;
  capability_run_id: string;
  created_at: string;
  source_kind: NutritionSourceDescriptor['sourceKind'];
  source_id: string;
  source_version: string;
  dataset_hash: string;
  redistribution: number;
  license_decision_id: string | null;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function toDraft(row: DraftRow): MealDraft {
  return mealDraftSchema.parse({
    id: row.id,
    localDate: row.local_date,
    mode: row.mode,
    originalText: row.original_text,
    state: row.state,
    currentRevisionId: row.current_revision_id,
    confirmedMealId: row.confirmed_meal_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toRevision(row: RevisionRow): MealRevision {
  return mealRevisionSchema.parse({
    id: row.id,
    draftId: row.draft_id,
    parentRevisionId: row.parent_revision_id,
    revisionNo: row.revision_no,
    candidates: JSON.parse(row.candidates_json),
    contentHash: row.content_hash,
    createdBy: row.created_by,
    capabilityRunId: row.capability_run_id,
    createdAt: row.created_at,
  });
}

function sourceFrom(row: FoodRow): NutritionSourceDescriptor {
  return nutritionSourceDescriptorSchema.parse({
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    datasetHash: row.dataset_hash,
    redistribution: row.redistribution === 1,
    licenseDecisionId: row.license_decision_id,
  });
}

function recordFrom(row: FoodRow): NutritionFoodRecord {
  return nutritionFoodRecordSchema.parse({
    schemaVersion: 'NUTRITION_RECORD_V1',
    source: sourceFrom(row),
    recordId: row.record_id,
    recordHash: row.record_hash,
    displayName: row.display_name,
    serving: { quantityDecimal: row.serving_quantity_decimal, unit: row.serving_unit },
    nutrientsPerServing: {
      energyKcalDecimal: row.energy_kcal_decimal,
      proteinGramsDecimal: row.protein_grams_decimal,
      carbohydrateGramsDecimal: row.carbohydrate_grams_decimal,
      fatGramsDecimal: row.fat_grams_decimal,
    },
  });
}

export interface NutritionRepository {
  createConfirmedMeal(ownerId: string, input: CreateMealInput, now: string, newId: () => string): MealRecord;
  createDraftWithRevision(input: { ownerId: string; draft: MealDraft; revision: MealRevision }): MealDraftDetail;
  appendRevision(input: { ownerId: string; draftId: string; expectedVersion: number; expectedState: Exclude<MealDraft['state'], 'CONFIRMED'>; nextState: Exclude<MealDraft['state'], 'CONFIRMED'>; revision: MealRevision; updatedAt: string }): MealDraftDetail;
  saveMatches(input: { ownerId: string; draftId: string; expectedVersion: number; revisionId: string; source: NutritionSourceDescriptor; adapterKind: 'TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'PRODUCTION_ADAPTER'; evidenceKind: 'AUTOMATED_TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'REAL_PROVIDER'; capabilityRunId: string; revision: MealRevision; snapshots: Array<{ candidateId: string; records: NutritionFoodRecord[] }>; sourceSnapshotId: string; foodSnapshotIds: string[]; updatedAt: string }): MealDraftDetail;
  confirmMeal(input: { ownerId: string; draftId: string; expectedVersion: number; revisionId: string; mealId: string; entryIds: string[]; now: string }): { draft: MealDraft; meal: MealV2 };
  findDraftDetail(ownerId: string, draftId: string): MealDraftDetail | undefined;
  listDrafts(ownerId: string, query: { state?: MealDraft['state']; localDate?: string; page: number; pageSize: number }): { items: MealDraft[]; total: number };
  findMeal(ownerId: string, mealId: string): MealV2 | undefined;
  listMeals(ownerId: string, query: { localDate?: string; page: number; pageSize: number }): { items: MealV2[]; total: number };
}

export function createNutritionRepository(database: Database.Database): NutritionRepository {
  const draftColumns = 'id, local_date, mode, original_text, state, current_revision_id, confirmed_meal_id, version, created_at, updated_at';
  const revisionColumns = 'id, draft_id, parent_revision_id, revision_no, candidates_json, content_hash, created_by, capability_run_id, created_at';
  const foodColumns = `f.id, f.candidate_id, f.record_id, f.record_hash, f.display_name, f.serving_quantity_decimal,
    f.serving_unit, f.energy_kcal_decimal, f.protein_grams_decimal, f.carbohydrate_grams_decimal, f.fat_grams_decimal,
    f.capability_run_id, f.created_at, s.source_kind, s.source_id, s.source_version, s.dataset_hash, s.redistribution,
    s.license_decision_id`;
  const findDraft = database.prepare(`select ${draftColumns} from meal_drafts_v2 where owner_id = ? and id = ?`);
  const findRevision = database.prepare(`select ${revisionColumns} from meal_revisions_v2 where owner_id = ? and id = ?`);
  const findFoodSnapshots = database.prepare(`select ${foodColumns} from nutrition_food_snapshots_v2 f
    join nutrition_source_snapshots_v2 s on s.id = f.source_snapshot_id and s.owner_id = f.owner_id
    where f.owner_id = ? and f.draft_id = ? and f.candidate_id = ? order by f.created_at asc, f.id asc`);
  const findFoodSnapshot = database.prepare(`select ${foodColumns} from nutrition_food_snapshots_v2 f
    join nutrition_source_snapshots_v2 s on s.id = f.source_snapshot_id and s.owner_id = f.owner_id
    where f.owner_id = ? and f.draft_id = ? and f.candidate_id = ? and f.id = ?`);
  const findSourceSnapshot = database.prepare(`select id from nutrition_source_snapshots_v2 where owner_id = ?
    and source_kind = ? and source_id = ? and source_version = ? and dataset_hash = ?`);
  const insertDraft = database.prepare(`insert into meal_drafts_v2 (
    id, owner_id, local_date, mode, original_text, state, current_revision_id, confirmed_meal_id, version, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertRevision = database.prepare(`insert into meal_revisions_v2 (
    id, owner_id, draft_id, parent_revision_id, revision_no, candidates_json, content_hash, created_by, capability_run_id, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const setInitialDraftRevision = database.prepare(`update meal_drafts_v2
    set current_revision_id = ?
    where owner_id = ? and id = ? and current_revision_id is null and version = ?`);
  const updateDraft = database.prepare(`update meal_drafts_v2 set state = ?, current_revision_id = ?, updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and state = ? and version = ?`);
  const insertSourceSnapshot = database.prepare(`insert or ignore into nutrition_source_snapshots_v2 (
    id, owner_id, source_kind, source_id, source_version, dataset_hash, redistribution, license_decision_id,
    adapter_kind, evidence_kind, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertFoodSnapshot = database.prepare(`insert into nutrition_food_snapshots_v2 (
    id, owner_id, draft_id, candidate_id, source_snapshot_id, record_id, record_hash, display_name,
    serving_quantity_decimal, serving_unit, energy_kcal_decimal, protein_grams_decimal,
    carbohydrate_grams_decimal, fat_grams_decimal, capability_run_id, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const confirmDraft = database.prepare(`update meal_drafts_v2 set state = 'CONFIRMED', confirmed_meal_id = ?, updated_at = ?, version = version + 1
    where owner_id = ? and id = ? and state = 'MATCHES_READY' and current_revision_id = ? and version = ?`);
  const insertMeal = database.prepare(`insert into meals_v2 (
    id, owner_id, draft_id, local_date, energy_kcal_decimal, protein_grams_decimal, carbohydrate_grams_decimal,
    fat_grams_decimal, calculation_version, version, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, 'DECIMAL_MICRO_V1', 1, ?)`);
  const insertMealEntry = database.prepare(`insert into meal_entries_v2 (
    id, owner_id, meal_id, meal_revision_id, candidate_id, food_snapshot_id, display_name, quantity_decimal, unit,
    energy_kcal_decimal, protein_grams_decimal, carbohydrate_grams_decimal, fat_grams_decimal, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const findMealRow = database.prepare(`select m.id, m.draft_id, m.local_date, m.energy_kcal_decimal, m.protein_grams_decimal,
    m.carbohydrate_grams_decimal, m.fat_grams_decimal, m.calculation_version, m.version, m.created_at, d.version as draft_version
    from meals_v2 m join meal_drafts_v2 d on d.id = m.draft_id and d.owner_id = m.owner_id where m.owner_id = ? and m.id = ?`);
  const findMealEntries = database.prepare(`select e.id, e.meal_revision_id, e.candidate_id, e.food_snapshot_id,
    e.display_name, e.quantity_decimal, e.unit, e.energy_kcal_decimal, e.protein_grams_decimal,
    e.carbohydrate_grams_decimal, e.fat_grams_decimal, f.record_hash, r.content_hash as revision_content_hash,
    r.revision_no from meal_entries_v2 e join nutrition_food_snapshots_v2 f on f.id = e.food_snapshot_id and f.owner_id = e.owner_id
    join meal_revisions_v2 r on r.id = e.meal_revision_id and r.owner_id = e.owner_id
    where e.owner_id = ? and e.meal_id = ? order by e.id asc`);

  const insertRevisionRow = (ownerId: string, revision: MealRevision): void => {
    insertRevision.run(
      revision.id, ownerId, revision.draftId, revision.parentRevisionId, revision.revisionNo,
      canonicalJson(revision.candidates), revision.contentHash, revision.createdBy, revision.capabilityRunId, revision.createdAt,
    );
  };

  const findDetail = (ownerId: string, draftId: string): MealDraftDetail | undefined => {
    const draftRow = findDraft.get(ownerId, draftId) as DraftRow | undefined;
    if (!draftRow) return undefined;
    const revisionRow = findRevision.get(ownerId, draftRow.current_revision_id) as RevisionRow | undefined;
    if (!revisionRow) throw new Error('MEAL_DRAFT_LINEAGE_CORRUPT');
    const draft = toDraft(draftRow);
    const revision = toRevision(revisionRow);
    const matches = revision.candidates.map((candidate) => {
      const rows = findFoodSnapshots.all(ownerId, draft.id, candidate.candidateId) as FoodRow[];
      const snapshots = rows.map((row) => nutritionFoodSnapshotSchema.parse({
        id: row.id, candidateId: candidate.candidateId, source: sourceFrom(row), record: recordFrom(row),
        capabilityRunId: row.capability_run_id, createdAt: row.created_at,
      }));
      return {
        candidateId: candidate.candidateId,
        status: snapshots.length === 0 ? 'UNMATCHED' : snapshots.length === 1 ? 'MATCHED' : 'AMBIGUOUS',
        snapshots,
      } as MealCandidateMatch;
    });
    const confirmedMeal = draft.confirmedMealId ? toMeal(ownerId, draft.confirmedMealId) : undefined;
    return { draft, revision, matches, confirmedMeal: confirmedMeal ?? null };
  };

  const toMeal = (ownerId: string, mealId: string): MealV2 | undefined => {
    const row = findMealRow.get(ownerId, mealId) as {
      id: string; draft_id: string; local_date: string; energy_kcal_decimal: string; protein_grams_decimal: string;
      carbohydrate_grams_decimal: string; fat_grams_decimal: string; calculation_version: 'DECIMAL_MICRO_V1'; version: 1; created_at: string; draft_version: number;
    } | undefined;
    if (!row) return undefined;
    const entries = (findMealEntries.all(ownerId, mealId) as Array<{
      id: string; meal_revision_id: string; candidate_id: string; food_snapshot_id: string; display_name: string;
      quantity_decimal: string; unit: NutritionFoodRecord['serving']['unit']; energy_kcal_decimal: string;
      protein_grams_decimal: string; carbohydrate_grams_decimal: string; fat_grams_decimal: string; record_hash: string;
      revision_content_hash: string; revision_no: number;
    }>).map((entry) => ({
      candidateId: entry.candidate_id,
      foodSnapshotId: entry.food_snapshot_id,
      displayName: entry.display_name,
      quantityDecimal: entry.quantity_decimal,
      unit: entry.unit,
      energyKcalDecimal: entry.energy_kcal_decimal,
      proteinGramsDecimal: entry.protein_grams_decimal,
      carbohydrateGramsDecimal: entry.carbohydrate_grams_decimal,
      fatGramsDecimal: entry.fat_grams_decimal,
      lineage: [
        { entityType: 'MEAL_DRAFT', entityId: row.draft_id, entityVersion: row.draft_version, contentHash: null },
        { entityType: 'MEAL_REVISION', entityId: entry.meal_revision_id, entityVersion: entry.revision_no, contentHash: entry.revision_content_hash },
        { entityType: 'FOOD_SNAPSHOT', entityId: entry.food_snapshot_id, entityVersion: 1, contentHash: entry.record_hash },
        { entityType: 'MEAL', entityId: row.id, entityVersion: 1, contentHash: null },
      ],
    }));
    return mealV2Schema.parse({
      id: row.id, draftId: row.draft_id, localDate: row.local_date, entries,
      totals: {
        energyKcalDecimal: row.energy_kcal_decimal, proteinGramsDecimal: row.protein_grams_decimal,
        carbohydrateGramsDecimal: row.carbohydrate_grams_decimal, fatGramsDecimal: row.fat_grams_decimal,
      }, calculationVersion: row.calculation_version, version: row.version, createdAt: row.created_at,
    });
  };

  return {
    createConfirmedMeal(ownerId, input, now, newId) {
      const totals = input.entries.reduce(
        (total, entry) => ({
          calories: total.calories + entry.calories,
          proteinGrams: total.proteinGrams + entry.proteinGrams,
          carbohydrateGrams: total.carbohydrateGrams + entry.carbohydrateGrams,
          fatGrams: total.fatGrams + entry.fatGrams,
        }),
        { calories: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
      );
      const record = mealRecordSchema.parse({ id: newId(), localDate: input.localDate, entries: input.entries, totals, createdAt: now });
      database.prepare(`insert into meal_records (id, owner_id, local_date, entries_json, calories, protein_grams,
        carbohydrate_grams, fat_grams, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(record.id, ownerId, record.localDate, JSON.stringify(record.entries), record.totals.calories,
          record.totals.proteinGrams, record.totals.carbohydrateGrams, record.totals.fatGrams, record.createdAt);
      return record;
    },
    createDraftWithRevision(input) {
      return database.transaction(() => {
        insertDraft.run(input.draft.id, input.ownerId, input.draft.localDate, input.draft.mode, input.draft.originalText,
          input.draft.state, null, input.draft.confirmedMealId, input.draft.version,
          input.draft.createdAt, input.draft.updatedAt);
        insertRevisionRow(input.ownerId, input.revision);
        if (setInitialDraftRevision.run(
          input.revision.id, input.ownerId, input.draft.id, input.draft.version,
        ).changes !== 1) throw new Error('MEAL_INITIAL_REVISION_LINK_FAILED');
        return findDetail(input.ownerId, input.draft.id) as MealDraftDetail;
      })();
    },
    appendRevision(input) {
      return database.transaction(() => {
        insertRevisionRow(input.ownerId, input.revision);
        if (updateDraft.run(input.nextState, input.revision.id, input.updatedAt, input.ownerId, input.draftId, input.expectedState, input.expectedVersion).changes !== 1) {
          throw new MealDraftStateConflictError();
        }
        return findDetail(input.ownerId, input.draftId) as MealDraftDetail;
      })();
    },
    saveMatches(input) {
      return database.transaction(() => {
        const current = findDraft.get(input.ownerId, input.draftId) as DraftRow | undefined;
        if (!current || current.state !== 'CANDIDATES_READY' || current.version !== input.expectedVersion || current.current_revision_id !== input.revisionId) {
          throw new MealDraftStateConflictError();
        }
        insertSourceSnapshot.run(input.sourceSnapshotId, input.ownerId, input.source.sourceKind, input.source.sourceId,
          input.source.sourceVersion, input.source.datasetHash, input.source.redistribution ? 1 : 0,
          input.source.licenseDecisionId, input.adapterKind, input.evidenceKind, input.updatedAt);
        const sourceRow = findSourceSnapshot.get(input.ownerId, input.source.sourceKind, input.source.sourceId,
          input.source.sourceVersion, input.source.datasetHash) as { id: string } | undefined;
        if (!sourceRow) throw new Error('NUTRITION_SOURCE_SNAPSHOT_MISSING');
        let index = 0;
        for (const group of input.snapshots) {
          for (const record of group.records) {
            const snapshotId = input.foodSnapshotIds[index++];
            if (!snapshotId) throw new Error('NUTRITION_FOOD_SNAPSHOT_ID_MISSING');
            insertFoodSnapshot.run(snapshotId, input.ownerId, input.draftId, group.candidateId, sourceRow.id,
              record.recordId, record.recordHash, record.displayName, record.serving.quantityDecimal, record.serving.unit,
              record.nutrientsPerServing.energyKcalDecimal, record.nutrientsPerServing.proteinGramsDecimal,
              record.nutrientsPerServing.carbohydrateGramsDecimal, record.nutrientsPerServing.fatGramsDecimal,
              input.capabilityRunId, input.updatedAt);
          }
        }
        if (index !== input.foodSnapshotIds.length) throw new Error('NUTRITION_FOOD_SNAPSHOT_ID_EXCESS');
        insertRevisionRow(input.ownerId, input.revision);
        if (updateDraft.run('MATCHES_READY', input.revision.id, input.updatedAt, input.ownerId, input.draftId, 'CANDIDATES_READY', input.expectedVersion).changes !== 1) {
          throw new MealDraftStateConflictError();
        }
        return findDetail(input.ownerId, input.draftId) as MealDraftDetail;
      })();
    },
    confirmMeal(input) {
      return database.transaction(() => {
        const draftRow = findDraft.get(input.ownerId, input.draftId) as DraftRow | undefined;
        if (!draftRow || draftRow.state !== 'MATCHES_READY' || draftRow.version !== input.expectedVersion || draftRow.current_revision_id !== input.revisionId) {
          throw new MealDraftStateConflictError();
        }
        const revisionRow = findRevision.get(input.ownerId, input.revisionId) as RevisionRow | undefined;
        if (!revisionRow) throw new MealDraftStateConflictError();
        const revision = toRevision(revisionRow);
        const included = revision.candidates.filter((candidate) => candidate.included);
        if (included.length === 0 || input.entryIds.length !== included.length) throw new MealConfirmationError('MEAL_MATCH_INCOMPLETE');
        const selected = included.map((candidate, index) => {
          if (!candidate.selectedFoodSnapshotId) throw new MealConfirmationError('MEAL_MATCH_INCOMPLETE');
          const row = findFoodSnapshot.get(input.ownerId, input.draftId, candidate.candidateId, candidate.selectedFoodSnapshotId) as FoodRow | undefined;
          if (!row) throw new MealConfirmationError('MEAL_MATCH_INCOMPLETE');
          const record = recordFrom(row);
          if (record.serving.unit !== candidate.unit) throw new MealConfirmationError('UNIT_MISMATCH');
          return { candidate, row, record, entryId: input.entryIds[index] as string };
        });
        const entries = selected.map(({ candidate, row, record }) => ({
          candidateId: candidate.candidateId, foodSnapshotId: row.id, displayName: candidate.displayName,
          quantityDecimal: candidate.quantityDecimal, unit: candidate.unit,
          energyKcalDecimal: scaleNutrientV1(record.nutrientsPerServing.energyKcalDecimal, candidate.quantityDecimal, record.serving.quantityDecimal),
          proteinGramsDecimal: scaleNutrientV1(record.nutrientsPerServing.proteinGramsDecimal, candidate.quantityDecimal, record.serving.quantityDecimal),
          carbohydrateGramsDecimal: scaleNutrientV1(record.nutrientsPerServing.carbohydrateGramsDecimal, candidate.quantityDecimal, record.serving.quantityDecimal),
          fatGramsDecimal: scaleNutrientV1(record.nutrientsPerServing.fatGramsDecimal, candidate.quantityDecimal, record.serving.quantityDecimal),
        }));
        const totals = calculateMealTotalsV1(entries);
        insertMeal.run(input.mealId, input.ownerId, input.draftId, draftRow.local_date, totals.energyKcalDecimal,
          totals.proteinGramsDecimal, totals.carbohydrateGramsDecimal, totals.fatGramsDecimal, input.now);
        entries.forEach((entry, index) => insertMealEntry.run(input.entryIds[index], input.ownerId, input.mealId,
          input.revisionId, entry.candidateId, entry.foodSnapshotId, entry.displayName, entry.quantityDecimal, entry.unit,
          entry.energyKcalDecimal, entry.proteinGramsDecimal, entry.carbohydrateGramsDecimal, entry.fatGramsDecimal, input.now));
        if (confirmDraft.run(input.mealId, input.now, input.ownerId, input.draftId, input.revisionId, input.expectedVersion).changes !== 1) {
          throw new MealDraftStateConflictError();
        }
        const draft = toDraft(findDraft.get(input.ownerId, input.draftId) as DraftRow);
        const meal = toMeal(input.ownerId, input.mealId);
        if (!meal) throw new Error('MEAL_CONFIRMATION_MISSING');
        return { draft, meal };
      })();
    },
    findDraftDetail: findDetail,
    listDrafts(ownerId, query) {
      const filters = ['owner_id = ?'];
      const values: Array<string | number> = [ownerId];
      if (query.state) { filters.push('state = ?'); values.push(query.state); }
      if (query.localDate) { filters.push('local_date = ?'); values.push(query.localDate); }
      const where = filters.join(' and ');
      const total = (database.prepare(`select count(*) as count from meal_drafts_v2 where ${where}`).get(...values) as { count: number }).count;
      const rows = database.prepare(`select ${draftColumns} from meal_drafts_v2 where ${where} order by updated_at desc, id asc limit ? offset ?`)
        .all(...values, query.pageSize, (query.page - 1) * query.pageSize) as DraftRow[];
      return { items: rows.map(toDraft), total };
    },
    findMeal: toMeal,
    listMeals(ownerId, query) {
      const filters = ['owner_id = ?'];
      const values: Array<string | number> = [ownerId];
      if (query.localDate) { filters.push('local_date = ?'); values.push(query.localDate); }
      const where = filters.join(' and ');
      const total = (database.prepare(`select count(*) as count from meals_v2 where ${where}`).get(...values) as { count: number }).count;
      const rows = database.prepare(`select id from meals_v2 where ${where} order by local_date desc, created_at desc, id asc limit ? offset ?`)
        .all(...values, query.pageSize, (query.page - 1) * query.pageSize) as Array<{ id: string }>;
      return { items: rows.map((row) => toMeal(ownerId, row.id)).filter((meal): meal is MealV2 => meal !== undefined), total };
    },
  };
}

export function createMealRevision(input: {
  id: string;
  draftId: string;
  parentRevisionId: string | null;
  revisionNo: number;
  candidates: MealCandidate[];
  createdBy: MealRevision['createdBy'];
  capabilityRunId: string | null;
  createdAt: string;
}): MealRevision {
  return mealRevisionSchema.parse({
    ...input,
    contentHash: hash({ candidates: input.candidates }),
  });
}
