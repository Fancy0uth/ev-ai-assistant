import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { parseExternalExerciseCatalog } from '../src/modules/fitness/external-catalog';
import { createFitnessCatalogService } from '../src/modules/fitness/catalog-service';
import { runMigrations } from '../src/storage/migrations';

type StoredRecord = {
  sourceId: string;
  revision: string;
  upstreamId: string;
  name: string;
  safetyReview: 'UNREVIEWED';
  catalogHash: string;
  itemHash: string;
};

type PlanCandidate = {
  record: StoredRecord;
  review: {
    reviewId: string;
    evidenceRef: string;
    scope: { goals: string[]; equipment: string[]; intensityCap: string };
    parameterLimits: { roundsMax: number; repsMax: number; durationSecondsMax: number; restSecondsMax: number };
  };
  medicalSafety: 'NOT_MEDICALLY_CERTIFIED';
};

type CatalogService = {
  importCatalog(input: unknown): { catalogHash: string; inserted: boolean };
  search(query: unknown): { items: StoredRecord[]; total: number };
  resolve(key: unknown): StoredRecord | undefined;
  listEligible(input: unknown): PlanCandidate[];
  internalReviews: { appendReview(input: unknown): void };
};

it('FIT02 immutable catalog imports, queries, scopes eligibility, and rejects conflicting or revoked reviews', async () => {
  const database = new Database(':memory:');
  try {
    database.pragma('foreign_keys = ON');
    runMigrations(database, 27);
    expect(
      database.prepare('select version from schema_migrations where version = 28').get(),
    ).toBeUndefined();
    runMigrations(database, 28);
    expect(
      database.prepare('select version from schema_migrations where version = 28').get(),
    ).toEqual({ version: 28 });

    const catalog: CatalogService = createFitnessCatalogService(database);
    const revision = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const imported = parseExternalExerciseCatalog({
      revision,
      records: [
        {
          id: '0001',
          name: 'Synthetic push-up',
          body_part: 'chest',
          equipment: 'body weight',
          target: 'pectorals',
          secondary_muscles: ['triceps'],
          instruction_steps: { en: ['Start in a high plank.'], zh: ['从高平板支撑开始。'] },
          instructions: { en: 'Fallback', zh: '备用文字' },
        },
        {
          id: '0002',
          name: 'Synthetic squat',
          body_part: 'upper legs',
          equipment: 'body weight',
          target: 'quadriceps',
          secondary_muscles: ['glutes'],
          instructions: { en: 'Stand and lower with control.', zh: '站立后控制下蹲。' },
        },
      ],
    });

    const firstImport = catalog.importCatalog(imported);
    expect(firstImport).toMatchObject({ inserted: true, catalogHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(catalog.importCatalog(imported)).toEqual({ catalogHash: firstImport.catalogHash, inserted: false });
    expect(database.prepare('select count(*) as count from fitness_catalog_items').get()).toEqual({ count: 2 });

    const queried = catalog.search({ text: 'push', equipment: 'body weight', muscle: 'triceps', page: 1, pageSize: 1 });
    expect(queried).toMatchObject({ total: 1, items: [{ upstreamId: '0001', revision: revision.toLowerCase(), safetyReview: 'UNREVIEWED' }] });
    const firstRecord = catalog.resolve({ sourceId: imported.sourceId, revision, upstreamId: '0001' });
    expect(firstRecord).toBeDefined();
    if (!firstRecord) throw new Error('FIT02_TEST_EXPECTED_FIRST_RECORD');
    const secondRecord = catalog.resolve({ sourceId: imported.sourceId, revision, upstreamId: '0002' });
    expect(secondRecord).toBeDefined();
    if (!secondRecord) throw new Error('FIT02_TEST_EXPECTED_SECOND_RECORD');
    expect(catalog.listEligible({ goal: 'STRENGTH', equipment: ['body weight'], intensityCap: 'MODERATE', limit: 5 })).toEqual([]);

    const changedSameRevision = parseExternalExerciseCatalog({
      revision,
      records: [
        {
          id: '0001',
          name: 'Synthetic push-up changed',
          body_part: 'chest',
          equipment: 'body weight',
          target: 'pectorals',
          secondary_muscles: ['triceps'],
          instruction_steps: { en: ['Start in a high plank.'], zh: ['从高平板支撑开始。'] },
          instructions: { en: 'Fallback', zh: '备用文字' },
        },
        {
          id: '0002',
          name: 'Synthetic squat',
          body_part: 'upper legs',
          equipment: 'body weight',
          target: 'quadriceps',
          secondary_muscles: ['glutes'],
          instructions: { en: 'Stand and lower with control.', zh: '站立后控制下蹲。' },
        },
      ],
    });
    let conflict: unknown;
    try {
      catalog.importCatalog(changedSameRevision);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({ code: 'CATALOG_REVISION_CONFLICT', statusCode: 409 });
    expect(database.prepare('select count(*) as count from fitness_catalog_items').get()).toEqual({ count: 2 });
    expect(catalog.resolve({ sourceId: imported.sourceId, revision, upstreamId: '0002' })).toMatchObject({
      name: 'Synthetic squat', catalogHash: firstImport.catalogHash,
    });

    const rejectedReviewId = '10000000-0000-4000-8000-000000000001';
    const eligibleReviewId = '10000000-0000-4000-8000-000000000002';
    catalog.internalReviews.appendReview({
      key: { sourceId: imported.sourceId, revision, upstreamId: '0001' },
      itemHash: firstRecord.itemHash,
      reviewId: rejectedReviewId,
      decision: 'REJECTED',
      reviewerId: 'synthetic-internal-reviewer',
      qualificationRef: 'UNKNOWN',
      evidenceRef: 'UNKNOWN',
      reviewedAt: '2026-09-18T00:00:00.000Z',
      impact: 'UNKNOWN',
      scope: {
        applicablePopulation: 'UNKNOWN',
        goals: ['STRENGTH'],
        equipment: ['body weight'],
        intensityCap: 'LOW',
        contraindicationLimitations: 'UNKNOWN',
      },
      parameterLimits: { roundsMax: 'UNKNOWN', repsMax: 'UNKNOWN', durationSecondsMax: 'UNKNOWN', restSecondsMax: 'UNKNOWN' },
      supersedesReviewId: null,
    });
    expect(() => catalog.internalReviews.appendReview({
      key: { sourceId: imported.sourceId, revision, upstreamId: '0001' },
      itemHash: firstRecord.itemHash,
      reviewId: '10000000-0000-4000-8000-000000000003',
      decision: 'ELIGIBLE',
      reviewerId: 'synthetic-internal-reviewer',
      qualificationRef: 'UNKNOWN',
      evidenceRef: 'UNKNOWN',
      reviewedAt: '2026-09-18T00:01:00.000Z',
      impact: 'UNKNOWN',
      scope: {
        applicablePopulation: 'UNKNOWN',
        goals: ['STRENGTH'],
        equipment: ['body weight'],
        intensityCap: 'LOW',
        contraindicationLimitations: 'UNKNOWN',
      },
      parameterLimits: { roundsMax: 'UNKNOWN', repsMax: 'UNKNOWN', durationSecondsMax: 'UNKNOWN', restSecondsMax: 'UNKNOWN' },
      supersedesReviewId: rejectedReviewId,
    })).toThrow('ELIGIBLE_REVIEW_REQUIRES_COMPLETE_EVIDENCE');

    catalog.internalReviews.appendReview({
      key: { sourceId: imported.sourceId, revision, upstreamId: '0001' },
      itemHash: firstRecord.itemHash,
      reviewId: eligibleReviewId,
      decision: 'ELIGIBLE',
      reviewerId: 'synthetic-internal-reviewer',
      qualificationRef: 'synthetic-qualification-v1',
      evidenceRef: 'synthetic-evidence-v1',
      reviewedAt: '2026-09-18T00:02:00.000Z',
      impact: 'LOW',
      scope: {
        applicablePopulation: 'synthetic-defined-scope',
        goals: ['STRENGTH'],
        equipment: ['body weight'],
        intensityCap: 'LOW',
        contraindicationLimitations: ['synthetic-limitation'],
      },
      parameterLimits: { roundsMax: 3, repsMax: 12, durationSecondsMax: 300, restSecondsMax: 90 },
      supersedesReviewId: rejectedReviewId,
    });
    catalog.internalReviews.appendReview({
      key: { sourceId: imported.sourceId, revision, upstreamId: '0002' },
      itemHash: secondRecord.itemHash,
      reviewId: '10000000-0000-4000-8000-000000000005',
      decision: 'ELIGIBLE',
      reviewerId: 'synthetic-internal-reviewer',
      qualificationRef: 'synthetic-qualification-v1',
      evidenceRef: 'synthetic-evidence-v1',
      reviewedAt: '2026-09-18T00:03:00.000Z',
      impact: 'LOW',
      scope: {
        applicablePopulation: 'synthetic-defined-scope',
        goals: ['ENDURANCE'],
        equipment: ['body weight'],
        intensityCap: 'LOW',
        contraindicationLimitations: ['synthetic-limitation'],
      },
      parameterLimits: { roundsMax: 3, repsMax: 12, durationSecondsMax: 300, restSecondsMax: 90 },
      supersedesReviewId: null,
    });
    expect(catalog.listEligible({ goal: 'STRENGTH', equipment: ['dumbbell'], intensityCap: 'MODERATE', limit: 5 })).toEqual([]);
    expect(catalog.listEligible({ goal: 'STRENGTH', equipment: ['body weight'], intensityCap: 'MODERATE', limit: 1 })).toMatchObject([
      {
        record: { upstreamId: '0001', safetyReview: 'UNREVIEWED' },
        review: {
          reviewId: eligibleReviewId,
          evidenceRef: 'synthetic-evidence-v1',
          scope: { goals: ['STRENGTH'], equipment: ['body weight'], intensityCap: 'LOW' },
          parameterLimits: { roundsMax: 3, repsMax: 12, durationSecondsMax: 300, restSecondsMax: 90 },
        },
        medicalSafety: 'NOT_MEDICALLY_CERTIFIED',
      },
    ]);

    catalog.internalReviews.appendReview({
      key: { sourceId: imported.sourceId, revision, upstreamId: '0001' },
      itemHash: firstRecord.itemHash,
      reviewId: '10000000-0000-4000-8000-000000000004',
      decision: 'REVOKED',
      reviewerId: 'synthetic-internal-reviewer',
      qualificationRef: 'UNKNOWN',
      evidenceRef: 'synthetic-revocation-evidence',
      reviewedAt: '2026-09-18T00:03:00.000Z',
      impact: 'UNKNOWN',
      scope: {
        applicablePopulation: 'UNKNOWN',
        goals: ['STRENGTH'],
        equipment: ['body weight'],
        intensityCap: 'LOW',
        contraindicationLimitations: 'UNKNOWN',
      },
      parameterLimits: { roundsMax: 'UNKNOWN', repsMax: 'UNKNOWN', durationSecondsMax: 'UNKNOWN', restSecondsMax: 'UNKNOWN' },
      supersedesReviewId: eligibleReviewId,
    });
    expect(catalog.listEligible({ goal: 'STRENGTH', equipment: ['body weight'], intensityCap: 'MODERATE', limit: 5 })).toEqual([]);
  } finally {
    database.close();
  }
});
