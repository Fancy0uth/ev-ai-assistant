import { randomUUID } from 'node:crypto';
import {
  APP_VERSION,
  createMealDraftSchema,
  reviseMealDraftSchema,
  type CreateMealInput,
  type HealthTextProvider,
  type MealCandidate,
  type MealDraft,
  type MealRevision,
  type MealV2,
  type NutritionSourceDescriptor,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import { createV07IdempotencyService, type V07ExternalClaim, type V07IdempotencyService } from '../health-loop/idempotency-service';
import { V07_PROVIDER_MAX_INPUT_BYTES, V07_PROVIDER_MAX_OUTPUT_BYTES } from '../health-loop/provider-boundary';
import { createV07HealthLoopRepository, type V07HealthLoopRepository } from '../health-loop/repository';
import {
  createMealRevision,
  createNutritionRepository,
  MealConfirmationError,
  MealDraftStateConflictError,
  type MealDraftDetail,
  type NutritionRepository,
} from './repository';
import {
  executeMealCandidateParse,
  executeNutritionSearchBatch,
  NutritionProviderError,
  type NutritionDataProvider,
} from './provider';

type CreateMealDraftInput = ReturnType<typeof createMealDraftSchema.parse>;
type ReviseMealDraftInput = ReturnType<typeof reviseMealDraftSchema.parse>;
type LocalResult<T> = { status: number; body: T | unknown; replayed: boolean };

export interface NutritionService {
  createConfirmedMeal(ownerId: string, input: CreateMealInput): ReturnType<NutritionRepository['createConfirmedMeal']>;
  createMealDraft(ownerId: string, input: CreateMealDraftInput, idempotencyKey: string): Promise<{ draft: MealDraft; revision: MealRevision; disclosure: unknown | null; replayed: boolean }>;
  reviseMealDraft(ownerId: string, draftId: string, input: ReviseMealDraftInput, idempotencyKey: string): { draft: MealDraft; revision: MealRevision; replayed: boolean };
  matchMealDraft(ownerId: string, draftId: string, input: { expectedVersion: number; revisionId: string }, idempotencyKey: string): Promise<{ draft: MealDraft; revision: MealRevision; matches: MealDraftDetail['matches']; source: NutritionSourceDescriptor; replayed: boolean }>;
  confirmMealDraft(ownerId: string, draftId: string, input: { expectedVersion: number; revisionId: string }, idempotencyKey: string): { draft: MealDraft; meal: MealV2; replayed: boolean };
  listMealDrafts(ownerId: string, query: { state?: MealDraft['state']; localDate?: string; page: number; pageSize: number }): { items: MealDraft[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
  getMealDraft(ownerId: string, draftId: string): MealDraftDetail;
  listMealsV2(ownerId: string, query: { localDate?: string; page: number; pageSize: number }): { items: MealV2[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
  getMealV2(ownerId: string, mealId: string): MealV2;
}

export interface NutritionServiceOptions {
  now?: () => Date;
  newId?: () => string;
  repository?: NutritionRepository;
  healthLoopRepository?: V07HealthLoopRepository;
  v07IdempotencyService?: V07IdempotencyService;
  healthTextProvider?: HealthTextProvider;
  nutritionDataProvider?: NutritionDataProvider;
}

function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}

function localBody<T>(result: LocalResult<T>): { body: T; replayed: boolean } {
  return { body: result.body as T, replayed: result.replayed };
}

function boundedFailureBytes(value: number | null, maximum: number): number {
  return value !== null && value <= maximum ? value : 0;
}

function toCandidates(
  values: Array<{ displayName: string; quantityDecimal: string; unit: 'GRAM' | 'MILLILITER' | 'ITEM' }>,
  kind: 'OWNER_EDIT' | 'MODEL_PARSE',
  capabilityRunId: string | null,
  createdAt: string,
  newId: () => string,
): MealCandidate[] {
  return values.map((candidate) => ({
    candidateId: newId(), displayName: candidate.displayName, quantityDecimal: candidate.quantityDecimal,
    unit: candidate.unit, included: true, selectedFoodSnapshotId: null,
    provenance: [{ kind, capabilityRunId, editedFields: ['displayName', 'quantityDecimal', 'unit'], capturedAt: createdAt }],
  }));
}

export function createNutritionService(database: Database.Database, options: NutritionServiceOptions = {}): NutritionService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const repository = options.repository ?? createNutritionRepository(database);
  const healthLoopRepository = options.healthLoopRepository ?? createV07HealthLoopRepository(database);
  const v07IdempotencyService = options.v07IdempotencyService ?? createV07IdempotencyService({ database, repository: healthLoopRepository, now, newId });

  function missingDraft(): never {
    throw new ApiError(404, 'MEAL_DRAFT_NOT_FOUND', '餐食草稿不存在');
  }

  function detail(ownerId: string, draftId: string): MealDraftDetail {
    return repository.findDraftDetail(ownerId, draftId) ?? missingDraft();
  }

  function assertMutableDraft(current: MealDraftDetail, input: { expectedVersion: number; revisionId: string }, state: 'CANDIDATES_READY' | 'MATCHES_READY'): void {
    if (current.draft.version !== input.expectedVersion || current.revision.id !== input.revisionId) {
      throw new ApiError(409, 'VERSION_CONFLICT', '餐食草稿版本已变化');
    }
    if (current.draft.state !== state) {
      throw new ApiError(422, state === 'CANDIDATES_READY' ? 'MEAL_DRAFT_NOT_MATCHABLE' : 'MEAL_MATCH_INCOMPLETE', '当前餐食草稿状态不允许此操作');
    }
  }

  function createBlockedRun(ownerId: string, capability: 'MEAL_CANDIDATE_PARSE' | 'NUTRITION_DATA_LOOKUP', operation: string, resourceId: string, localDate: string, disclosure: unknown, code: string): void {
    const createdAt = now().toISOString();
    const runId = newId();
    healthLoopRepository.createCapabilityRun({
      id: runId, ownerId, capability, operation, resourceId, providerId: null, providerLabel: 'Not configured',
      adapterKind: 'NONE', evidenceKind: 'NONE', disclosure, status: 'BLOCKED_PROVIDER', localDate,
      appVersion: APP_VERSION, createdAt,
    });
    healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'HEALTH_CAPABILITY_BLOCKED', entityType: 'CAPABILITY_RUN', entityId: runId, entityVersion: 1, metadata: { capability, code }, createdAt });
  }

  function createClaimedRun(input: {
    ownerId: string;
    capability: 'MEAL_CANDIDATE_PARSE' | 'NUTRITION_DATA_LOOKUP';
    operation: string;
    resourceId: string;
    claim: V07ExternalClaim;
    localDate: string;
    descriptor: { providerId: string; providerLabel: string; adapterKind: 'TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'PRODUCTION_ADAPTER'; evidenceKind: 'AUTOMATED_TEST_FIXTURE' | 'APPROVED_LOCAL_DATASET' | 'REAL_PROVIDER' };
    disclosure: unknown;
    nutritionSource?: NutritionSourceDescriptor;
  }): { id: string; createdAt: string } {
    const createdAt = now().toISOString();
    const id = newId();
    healthLoopRepository.createClaimedCapabilityRun({
      id, ownerId: input.ownerId, capability: input.capability, operation: input.operation, resourceId: input.resourceId,
      providerId: input.descriptor.providerId, providerLabel: input.descriptor.providerLabel,
      adapterKind: input.descriptor.adapterKind, disclosure: input.disclosure, localDate: input.localDate, appVersion: APP_VERSION,
      idempotencyKey: input.claim.key, requestHash: input.claim.requestHash,
      leaseToken: input.claim.leaseToken, leaseExpiresAt: input.claim.leaseExpiresAt,
      deadlineAt: new Date(Date.parse(createdAt) + 8_000).toISOString(),
      createdAt, nutritionSourceVersion: input.nutritionSource?.sourceVersion ?? null,
      nutritionDatasetHash: input.nutritionSource?.datasetHash ?? null,
    });
    return { id, createdAt };
  }

  return {
    createConfirmedMeal(ownerId, input) {
      return repository.createConfirmedMeal(ownerId, input, now().toISOString(), newId);
    },
    async createMealDraft(ownerId, input, idempotencyKey) {
      if (input.mode === 'MANUAL') {
        const result = localBody(v07IdempotencyService.executeLocal({ ownerId, key: idempotencyKey, operation: 'nutrition.meal_draft.create', resourceId: input.localDate, body: input }, () => {
          const createdAt = now().toISOString();
          const candidates = toCandidates(input.candidates, 'OWNER_EDIT', null, createdAt, newId);
          const draft: MealDraft = { id: newId(), localDate: input.localDate, mode: 'MANUAL', originalText: null, state: 'CANDIDATES_READY', currentRevisionId: newId(), confirmedMealId: null, version: 1, createdAt, updatedAt: createdAt };
          const revision = createMealRevision({ id: draft.currentRevisionId, draftId: draft.id, parentRevisionId: null, revisionNo: 1, candidates, createdBy: 'OWNER', capabilityRunId: null, createdAt });
          const stored = repository.createDraftWithRevision({ ownerId, draft, revision });
          healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'MEAL_DRAFT_CREATED', entityType: 'MEAL_DRAFT', entityId: draft.id, entityVersion: 1, metadata: { mode: draft.mode, revisionId: revision.id }, createdAt });
          return { status: 201, body: { draft: stored.draft, revision: stored.revision, disclosure: null } };
        }));
        return { ...(result.body as { draft: MealDraft; revision: MealRevision; disclosure: null }), replayed: result.replayed };
      }
      const command = { ownerId, key: idempotencyKey, operation: 'nutrition.meal_draft.create' as const, resourceId: input.localDate, body: input };
      const started = v07IdempotencyService.beginExternal<{ draft: MealDraft; revision: MealRevision; disclosure: unknown }>(command);
      if (started.kind === 'REPLAY') return { ...started.response.body, replayed: started.response.replayed };
      if (!options.healthTextProvider) {
        const error = new ApiError(503, 'HEALTH_TEXT_PROVIDER_NOT_CONFIGURED', '餐食文本能力尚未配置');
        v07IdempotencyService.failExternal(started.claim, error, () => {
          createBlockedRun(ownerId, 'MEAL_CANDIDATE_PARSE', command.operation, command.resourceId, input.localDate, { disclosureVersion: input.disclosureVersion }, error.code);
        });
        throw error;
      }
      if (healthLoopRepository.countReservedCalls(ownerId, input.localDate, 'MEAL_CANDIDATE_PARSE') >= 5) {
        const error = new ApiError(429, 'RATE_LIMITED', '今日能力调用次数已达上限');
        v07IdempotencyService.failExternal(started.claim, error);
        throw error;
      }
      const provider = options.healthTextProvider;
      const run = createClaimedRun({ ownerId, capability: 'MEAL_CANDIDATE_PARSE', operation: command.operation, resourceId: command.resourceId, claim: started.claim, localDate: input.localDate, descriptor: provider.descriptor, disclosure: { disclosureVersion: input.disclosureVersion } });
      let parsed: Awaited<ReturnType<typeof executeMealCandidateParse>>;
      try {
        parsed = await executeMealCandidateParse({ schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', mealText: input.mealText, allowedUnits: ['GRAM', 'MILLILITER', 'ITEM'], maxCandidates: 30 }, provider);
      } catch (error) {
        const kind = error instanceof NutritionProviderError ? error.kind : 'UNAVAILABLE';
        const apiError = new ApiError(503, kind === 'INVALID_RESPONSE' ? 'MEAL_CANDIDATE_RESPONSE_INVALID' : 'HEALTH_TEXT_PROVIDER_UNAVAILABLE', '餐食文本能力当前不可用');
        const inputBytes = error instanceof NutritionProviderError ? boundedFailureBytes(error.inputBytes, V07_PROVIDER_MAX_INPUT_BYTES) : 0;
        const outputBytes = error instanceof NutritionProviderError ? boundedFailureBytes(error.outputBytes, V07_PROVIDER_MAX_OUTPUT_BYTES) : 0;
        v07IdempotencyService.failExternal(started.claim, apiError, () => {
          if (!healthLoopRepository.failCapabilityRun({ ownerId, id: run.id, leaseToken: started.claim.leaseToken, actualCalls: 1, inputBytes, outputBytes, failureCode: apiError.code, now: now().toISOString() })) throw new Error('MEAL_PARSE_RUN_FINALIZE_FAILED');
        });
        throw apiError;
      }
      const result = v07IdempotencyService.completeExternal(started.claim, () => {
        const createdAt = now().toISOString();
        const candidates = toCandidates(parsed.value, 'MODEL_PARSE', run.id, createdAt, newId);
        const draft: MealDraft = { id: newId(), localDate: input.localDate, mode: 'PARSE_TEXT', originalText: input.mealText, state: 'CANDIDATES_READY', currentRevisionId: newId(), confirmedMealId: null, version: 1, createdAt, updatedAt: createdAt };
        const revision = createMealRevision({ id: draft.currentRevisionId, draftId: draft.id, parentRevisionId: null, revisionNo: 1, candidates, createdBy: 'PARSER', capabilityRunId: run.id, createdAt });
        const stored = repository.createDraftWithRevision({ ownerId, draft, revision });
        if (!healthLoopRepository.completeCapabilityRun({ ownerId, id: run.id, leaseToken: started.claim.leaseToken, actualCalls: 1, inputBytes: parsed.inputBytes, outputBytes: parsed.outputBytes, evidenceKind: provider.descriptor.evidenceKind, now: createdAt })) throw new Error('MEAL_PARSE_RUN_FINALIZE_FAILED');
        healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'MEAL_DRAFT_CREATED', entityType: 'MEAL_DRAFT', entityId: draft.id, entityVersion: 1, metadata: { mode: draft.mode, revisionId: revision.id, capabilityRunId: run.id }, createdAt });
        return { status: 201, body: { draft: stored.draft, revision: stored.revision, disclosure: { capabilityRunId: run.id, disclosureVersion: input.disclosureVersion } } };
      });
      return { ...result.body, replayed: result.replayed };
    },
    reviseMealDraft(ownerId, draftId, input, idempotencyKey) {
      const result = localBody(v07IdempotencyService.executeLocal({ ownerId, key: idempotencyKey, operation: 'nutrition.meal_draft.revise', resourceId: draftId, body: input }, () => {
        const current = detail(ownerId, draftId);
        if (current.draft.version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '餐食草稿版本已变化');
        if (current.revision.id !== input.parentRevisionId) throw new ApiError(409, 'REVISION_PARENT_STALE', '餐食草稿修订已变化');
        if (current.draft.state === 'CONFIRMED') throw new ApiError(422, 'MEAL_DRAFT_NOT_EDITABLE', '已确认餐食不可修改');
        const createdAt = now().toISOString();
        let candidates: MealCandidate[];
        let nextState: 'CANDIDATES_READY' | 'MATCHES_READY';
        if (input.operation === 'REPLACE_CANDIDATES') {
          candidates = toCandidates(input.candidates, 'OWNER_EDIT', null, createdAt, newId);
          nextState = 'CANDIDATES_READY';
        } else {
          if (current.draft.state !== 'MATCHES_READY' || input.candidates.length !== current.revision.candidates.length) throw new ApiError(422, 'MATCH_SELECTION_INVALID', '匹配选择不属于当前餐食草稿');
          const selectionByCandidate = new Map(input.candidates.map((candidate) => [candidate.candidateId, candidate]));
          candidates = current.revision.candidates.map((candidate) => {
            const selection = selectionByCandidate.get(candidate.candidateId);
            if (!selection) throw new ApiError(422, 'MATCH_SELECTION_INVALID', '匹配选择不属于当前餐食草稿');
            if (selection.selectedFoodSnapshotId && !current.matches.find((match) => match.candidateId === candidate.candidateId)?.snapshots.some((snapshot) => snapshot.id === selection.selectedFoodSnapshotId)) {
              throw new ApiError(422, 'MATCH_SELECTION_INVALID', '匹配选择不属于当前候选项');
            }
            return { ...candidate, included: selection.included, selectedFoodSnapshotId: selection.selectedFoodSnapshotId, provenance: [...candidate.provenance, { kind: 'OWNER_EDIT' as const, capabilityRunId: null, editedFields: ['included', 'selectedFoodSnapshotId'], capturedAt: createdAt }] };
          });
          nextState = 'MATCHES_READY';
        }
        const revision = createMealRevision({ id: newId(), draftId, parentRevisionId: current.revision.id, revisionNo: current.revision.revisionNo + 1, candidates, createdBy: 'OWNER', capabilityRunId: null, createdAt });
        try {
          const stored = repository.appendRevision({ ownerId, draftId, expectedVersion: input.expectedVersion, expectedState: current.draft.state, nextState, revision, updatedAt: createdAt });
          healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'MEAL_REVISION_CREATED', entityType: 'MEAL_DRAFT', entityId: draftId, entityVersion: stored.draft.version, metadata: { revisionId: revision.id, operation: input.operation }, createdAt });
          return { status: 201, body: { draft: stored.draft, revision: stored.revision } };
        } catch (error) {
          if (error instanceof MealDraftStateConflictError) throw new ApiError(409, 'VERSION_CONFLICT', '餐食草稿版本已变化');
          throw error;
        }
      }));
      return { ...(result.body as { draft: MealDraft; revision: MealRevision }), replayed: result.replayed };
    },
    async matchMealDraft(ownerId, draftId, input, idempotencyKey) {
      const command = { ownerId, key: idempotencyKey, operation: 'nutrition.meal_draft.match' as const, resourceId: draftId, body: input };
      const started = v07IdempotencyService.beginExternal<{
        draft: MealDraft;
        revision: MealRevision;
        matches: MealDraftDetail['matches'];
        source: NutritionSourceDescriptor;
      }>(command);
      if (started.kind === 'REPLAY') return { ...started.response.body, replayed: started.response.replayed };
      let current: MealDraftDetail;
      let included: MealCandidate[];
      try {
        current = detail(ownerId, draftId);
        assertMutableDraft(current, input, 'CANDIDATES_READY');
        included = current.revision.candidates.filter((candidate) => candidate.included);
        if (included.length > 10) throw new ApiError(422, 'MATCH_BATCH_TOO_LARGE', '一次最多匹配十个候选项');
      } catch (error) {
        if (error instanceof ApiError) v07IdempotencyService.failExternal(started.claim, error);
        throw error;
      }
      if (!options.nutritionDataProvider) {
        const error = new ApiError(503, 'NUTRITION_DATA_PROVIDER_NOT_CONFIGURED', '营养数据能力尚未配置');
        v07IdempotencyService.failExternal(started.claim, error, () => {
          createBlockedRun(ownerId, 'NUTRITION_DATA_LOOKUP', command.operation, command.resourceId, current.draft.localDate, { disclosureVersion: 'HEALTH_DISCLOSURE_V1' }, error.code);
        });
        throw error;
      }
      const provider = options.nutritionDataProvider;
      if (healthLoopRepository.countReservedCalls(ownerId, current.draft.localDate, 'NUTRITION_DATA_LOOKUP') >= 5) {
        const error = new ApiError(429, 'RATE_LIMITED', '今日能力调用次数已达上限');
        v07IdempotencyService.failExternal(started.claim, error);
        throw error;
      }
      const run = createClaimedRun({ ownerId, capability: 'NUTRITION_DATA_LOOKUP', operation: command.operation, resourceId: command.resourceId, claim: started.claim, localDate: current.draft.localDate, descriptor: provider.descriptor, disclosure: { disclosureVersion: 'HEALTH_DISCLOSURE_V1' }, nutritionSource: provider.descriptor.source });
      let snapshots: Awaited<ReturnType<typeof executeNutritionSearchBatch>>;
      try {
        snapshots = await executeNutritionSearchBatch({ queries: included.map((candidate) => ({ candidateId: candidate.candidateId, query: candidate.displayName, unit: candidate.unit, limit: 5 as const })) }, provider);
      } catch (error) {
        const kind = error instanceof NutritionProviderError ? error.kind : 'UNAVAILABLE';
        const apiError = new ApiError(503, kind === 'INVALID_RESPONSE' ? 'NUTRITION_DATA_RESPONSE_INVALID' : 'NUTRITION_DATA_PROVIDER_UNAVAILABLE', '营养数据能力当前不可用');
        const inputBytes = error instanceof NutritionProviderError ? boundedFailureBytes(error.inputBytes, V07_PROVIDER_MAX_INPUT_BYTES) : 0;
        const outputBytes = error instanceof NutritionProviderError ? boundedFailureBytes(error.outputBytes, V07_PROVIDER_MAX_OUTPUT_BYTES) : 0;
        v07IdempotencyService.failExternal(started.claim, apiError, () => {
          if (!healthLoopRepository.failCapabilityRun({ ownerId, id: run.id, leaseToken: started.claim.leaseToken, actualCalls: 1, inputBytes, outputBytes, failureCode: apiError.code, now: now().toISOString() })) throw new Error('NUTRITION_MATCH_RUN_FINALIZE_FAILED');
        });
        throw apiError;
      }
      const result = v07IdempotencyService.completeExternal(started.claim, () => {
        const latest = detail(ownerId, draftId);
        assertMutableDraft(latest, input, 'CANDIDATES_READY');
        const createdAt = now().toISOString();
        const candidates = latest.revision.candidates.map((candidate) => ({ ...candidate, selectedFoodSnapshotId: null, provenance: [...candidate.provenance, { kind: 'DATA_MATCH' as const, capabilityRunId: run.id, editedFields: ['selectedFoodSnapshotId'], capturedAt: createdAt }] }));
        const revision = createMealRevision({ id: newId(), draftId, parentRevisionId: latest.revision.id, revisionNo: latest.revision.revisionNo + 1, candidates, createdBy: 'DATA_PROVIDER', capabilityRunId: run.id, createdAt });
        try {
          const stored = repository.saveMatches({ ownerId, draftId, expectedVersion: input.expectedVersion, revisionId: latest.revision.id, source: provider.descriptor.source, adapterKind: provider.descriptor.adapterKind, evidenceKind: provider.descriptor.evidenceKind, capabilityRunId: run.id, revision, snapshots: snapshots.value, sourceSnapshotId: newId(), foodSnapshotIds: snapshots.value.flatMap((group) => group.records.map(() => newId())), updatedAt: createdAt });
          if (!healthLoopRepository.completeCapabilityRun({ ownerId, id: run.id, leaseToken: started.claim.leaseToken, actualCalls: 1, inputBytes: snapshots.inputBytes, outputBytes: snapshots.outputBytes, evidenceKind: provider.descriptor.evidenceKind, now: createdAt })) throw new Error('NUTRITION_MATCH_RUN_FINALIZE_FAILED');
          healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'MEAL_MATCHES_SAVED', entityType: 'MEAL_DRAFT', entityId: draftId, entityVersion: stored.draft.version, metadata: { capabilityRunId: run.id, sourceKind: provider.descriptor.source.sourceKind, sourceVersion: provider.descriptor.source.sourceVersion }, createdAt });
          return { status: 202, body: { draft: stored.draft, revision: stored.revision, matches: stored.matches, source: provider.descriptor.source } };
        } catch (error) {
          if (error instanceof MealDraftStateConflictError) throw new ApiError(409, 'VERSION_CONFLICT', '餐食草稿版本已变化');
          throw error;
        }
      }, () => {
        if (!healthLoopRepository.failCapabilityRun({ ownerId, id: run.id, leaseToken: started.claim.leaseToken, actualCalls: 1, inputBytes: snapshots.inputBytes, outputBytes: snapshots.outputBytes, failureCode: 'NUTRITION_MATCH_FINALIZATION_REJECTED', now: now().toISOString() })) throw new Error('NUTRITION_MATCH_RUN_FINALIZE_FAILED');
      });
      return { ...result.body, replayed: result.replayed };
    },
    confirmMealDraft(ownerId, draftId, input, idempotencyKey) {
      const result = localBody(v07IdempotencyService.executeLocal({ ownerId, key: idempotencyKey, operation: 'nutrition.meal.confirm', resourceId: draftId, body: input }, () => {
        const current = detail(ownerId, draftId);
        assertMutableDraft(current, input, 'MATCHES_READY');
        try {
          const createdAt = now().toISOString();
          const stored = repository.confirmMeal({ ownerId, draftId, expectedVersion: input.expectedVersion, revisionId: input.revisionId, mealId: newId(), entryIds: current.revision.candidates.filter((candidate) => candidate.included).map(() => newId()), now: createdAt });
          healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'MEAL_CONFIRMED', entityType: 'MEAL', entityId: stored.meal.id, entityVersion: 1, metadata: { draftId, revisionId: input.revisionId, calculationVersion: stored.meal.calculationVersion }, createdAt });
          return { status: 201, body: stored };
        } catch (error) {
          if (error instanceof MealDraftStateConflictError) throw new ApiError(409, 'VERSION_CONFLICT', '餐食草稿版本已变化');
          if (error instanceof MealConfirmationError) throw new ApiError(422, error.code, error.code === 'UNIT_MISMATCH' ? '候选份量单位与来源记录不一致' : '餐食匹配尚不完整');
          throw error;
        }
      }));
      return { ...(result.body as { draft: MealDraft; meal: MealV2 }), replayed: result.replayed };
    },
    listMealDrafts(ownerId, query) {
      const result = repository.listDrafts(ownerId, query);
      return { items: result.items, pagination: pagination(query.page, query.pageSize, result.total) };
    },
    getMealDraft: detail,
    listMealsV2(ownerId, query) {
      const result = repository.listMeals(ownerId, query);
      return { items: result.items, pagination: pagination(query.page, query.pageSize, result.total) };
    },
    getMealV2(ownerId, mealId) {
      const meal = repository.findMeal(ownerId, mealId);
      if (!meal) throw new ApiError(404, 'MEAL_NOT_FOUND', '餐食不存在');
      return meal;
    },
  };
}
