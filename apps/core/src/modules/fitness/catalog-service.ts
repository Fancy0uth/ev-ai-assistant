import {
  catalogQuerySchema,
  externalExerciseCatalogSchema,
  externalKeySchema,
  exerciseReviewRecordSchema,
  listEligibleCatalogInputSchema,
  type CatalogQuery,
  type ExerciseReviewRecord,
  type ExternalExerciseRecord,
  type ExternalKey,
  type ListEligibleCatalogInput,
  type PlanCandidateV2,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import { createFitnessCatalogRepository, type FitnessCatalogRepository } from './catalog-repository';
import type { ExternalExerciseCatalog as ParsedExternalExerciseCatalog } from './external-catalog';

export interface InternalFitnessCatalogReviewService {
  appendReview(input: ExerciseReviewRecord): void;
}

export interface FitnessCatalogService {
  importCatalog(input: ParsedExternalExerciseCatalog): { catalogHash: string; inserted: boolean };
  search(query: CatalogQuery): { items: ExternalExerciseRecord[]; total: number };
  resolve(key: ExternalKey): ExternalExerciseRecord | undefined;
  listEligible(input: ListEligibleCatalogInput): PlanCandidateV2[];
  readonly internalReviews: InternalFitnessCatalogReviewService;
}

export function createFitnessCatalogService(
  database: Database.Database,
  repository: FitnessCatalogRepository = createFitnessCatalogRepository(database),
): FitnessCatalogService {
  return {
    importCatalog(input) {
      return repository.importCatalog(externalExerciseCatalogSchema.parse(input));
    },
    search(query) {
      return repository.search(catalogQuerySchema.parse(query));
    },
    resolve(key) {
      return repository.resolve(externalKeySchema.parse(key));
    },
    listEligible(input) {
      return repository.listEligible(listEligibleCatalogInputSchema.parse(input));
    },
    internalReviews: {
      appendReview(input) {
        repository.appendReview(exerciseReviewRecordSchema.parse(input));
      },
    },
  };
}
