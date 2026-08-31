import { createHash, randomUUID } from 'node:crypto';
import {
  APP_VERSION,
  type CheckInInput,
  type CreateFitnessCheckInInput,
  type CreateWorkoutInput,
  type ExerciseCitation,
  type HealthTextProvider,
  type Signal,
  type Workout,
  type WorkoutRevision,
  workoutTextSelectionOutputSchema,
} from '@ev/contracts';
import {
  calculateRecovery,
  createWorkoutDefaultsV1,
  deriveWorkoutSafetyV1,
  rankExerciseCatalogV1,
} from '@ev/domain';
import { ApiError } from '../../http/api-error';
import type { CalendarRepository } from '../calendar/repository';
import type { V07IdempotencyService } from '../health-loop/idempotency-service';
import type { V07HealthLoopRepository } from '../health-loop/repository';
import { loadInternalExerciseCatalog, type LoadedInternalExerciseCatalog } from './catalog';
import type { FitnessRepository } from './repository';

type CheckIn = NonNullable<ReturnType<FitnessRepository['findCheckIn']>>;
type WorkoutRevisionInput = {
  expectedVersion: number;
  parentRevisionId: string;
  title: string;
  rationale: string;
  items: WorkoutRevision['items'];
  scheduling: WorkoutRevision['scheduling'];
};
interface Pagination { page: number; pageSize: number; total: number; totalPages: number; }

export interface FitnessService {
  checkIn(ownerId: string, input: CheckInInput): { signal: Signal; assessment: ReturnType<typeof calculateRecovery> };
  checkInV2(ownerId: string, input: CreateFitnessCheckInInput, idempotencyKey: string): { checkIn: CheckIn; signal: Signal; replayed: boolean };
  listCheckIns(ownerId: string, query: { localDate?: string; eligibility?: 'BLOCKED' | 'ELIGIBLE'; page: number; pageSize: number }): { items: CheckIn[]; pagination: Pagination };
  listExercises(ownerId: string, query: { checkInId: string; goal?: CreateWorkoutInput['goal']; equipment?: string[]; query?: string; page: number; pageSize: number }): { safety: CheckIn['safety']; manifest: LoadedInternalExerciseCatalog['manifest']; items: LoadedInternalExerciseCatalog['items']; pagination: Pagination };
  createWorkout(ownerId: string, input: CreateWorkoutInput, idempotencyKey: string): Promise<{ workout: Workout; revision: WorkoutRevision; disclosure: unknown | null; replayed: boolean }>;
  reviseWorkout(ownerId: string, workoutId: string, input: WorkoutRevisionInput, idempotencyKey: string): { workout: Workout; revision: WorkoutRevision; replayed: boolean };
  listWorkouts(ownerId: string, query: { state?: Workout['state']; localDate?: string; page: number; pageSize: number }): { items: Workout[]; pagination: Pagination };
  getWorkout(ownerId: string, workoutId: string): { workout: Workout; checkIn: CheckIn; revision: WorkoutRevision; proposal: null; action: null; timeRequest: null; feedback: null };
}

function pagination(page: number, pageSize: number, total: number): Pagination {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isInProgress<T>(value: { kind: 'IN_PROGRESS'; retryAfterSeconds: 1 } | T): value is { kind: 'IN_PROGRESS'; retryAfterSeconds: 1 } {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'IN_PROGRESS';
}

function safetyOrThrow(checkIn: CheckIn): void {
  if (checkIn.safety.eligibility === 'BLOCKED') {
    throw new ApiError(422, 'WORKOUT_BLOCKED_BY_SAFETY', '已报告疼痛或急性风险，无法创建训练计划');
  }
}

function eligibleSafety(checkIn: CheckIn): Extract<CheckIn['safety'], { eligibility: 'ELIGIBLE' }> {
  safetyOrThrow(checkIn);
  return checkIn.safety as Extract<CheckIn['safety'], { eligibility: 'ELIGIBLE' }>;
}

function validateScheduling(checkIn: CheckIn, scheduling: WorkoutRevision['scheduling']): void {
  safetyOrThrow(checkIn);
  if (scheduling.durationMinutes > checkIn.safety.maxDurationMinutes) {
    throw new ApiError(422, 'SAFETY_POLICY_VIOLATION', '训练时长超过当前恢复状态允许范围');
  }
}

function validateCitations(citations: readonly ExerciseCitation[], catalog: LoadedInternalExerciseCatalog): LoadedInternalExerciseCatalog['items'] {
  const byCitationId = new Map(catalog.items.map((item) => [item.citation.citationId, item]));
  const selected = citations.map((citation) => {
    const item = byCitationId.get(citation.citationId);
    if (!item || canonicalJson(item.citation) !== canonicalJson(citation)) {
      throw new ApiError(422, 'CITATION_INVALID', '训练动作引用不属于当前内部目录');
    }
    return item;
  });
  if (new Set(selected.map((item) => item.exerciseId)).size !== selected.length) {
    throw new ApiError(422, 'CITATION_INVALID', '训练动作引用不能重复');
  }
  return selected;
}

export async function executeWorkoutTextSelection(input: {
  goal: CreateWorkoutInput['goal'];
  maxDurationMinutes: 30 | 45 | 60;
  intensityCap: 'LOW' | 'MODERATE';
  catalog: LoadedInternalExerciseCatalog['items'];
}, provider: HealthTextProvider): Promise<{ title: string; rationale: string; orderedCitationIds: string[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const output = await provider.selectWorkout({
      schemaVersion: 'WORKOUT_TEXT_SELECTION_V1', goal: input.goal,
      maxDurationMinutes: input.maxDurationMinutes, intensityCap: input.intensityCap,
      catalog: input.catalog.map((item) => ({
        citationId: item.citation.citationId, name: item.name,
        neutralTechniqueText: item.neutralTechniqueText, tags: item.movementTags,
      })),
    }, controller.signal);
    return workoutTextSelectionOutputSchema.parse(output);
  } finally {
    clearTimeout(timeout);
  }
}

export function createFitnessService(
  fitnessRepository: FitnessRepository,
  calendarRepository: CalendarRepository,
  healthLoopRepository: V07HealthLoopRepository,
  v07IdempotencyService: V07IdempotencyService,
  options: { now?: () => Date; newId?: () => string; catalog?: LoadedInternalExerciseCatalog; healthTextProvider?: HealthTextProvider } = {},
): FitnessService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const catalog = options.catalog ?? loadInternalExerciseCatalog();
  const catalogRef = { id: catalog.manifest.catalogId, version: catalog.manifest.catalogVersion, hash: catalog.manifest.contentSha256 };

  const createRevision = (input: {
    workoutId: string; parentRevisionId: string | null; revisionNo: number; title: string; rationale: string;
    items: WorkoutRevision['items']; scheduling: WorkoutRevision['scheduling']; provenance: WorkoutRevision['provenance']; createdAt: string;
  }): WorkoutRevision => ({
    id: newId(), workoutId: input.workoutId, parentRevisionId: input.parentRevisionId, revisionNo: input.revisionNo,
    title: input.title, rationale: input.rationale, items: input.items, scheduling: input.scheduling, provenance: input.provenance,
    contentHash: contentHash({ parentRevisionId: input.parentRevisionId, title: input.title, rationale: input.rationale, items: input.items, scheduling: input.scheduling, provenance: input.provenance }),
    createdAt: input.createdAt,
  });

  return {
    checkIn(ownerId, input) {
      const assessment = calculateRecovery(input);
      const timestamp = now().toISOString();
      const signal = calendarRepository.createSignal({ id: newId(), ownerId, localDate: input.localDate, kind: 'RECOVERY', value: assessment.score, source: 'CHECK_IN', version: 1, createdAt: timestamp, updatedAt: timestamp });
      return { signal, assessment };
    },
    checkInV2(ownerId, input, idempotencyKey) {
      const result = v07IdempotencyService.executeLocal({ ownerId, key: idempotencyKey, operation: 'fitness.check_in.create', resourceId: `fitness-check-in:${input.localDate}`, body: input }, () => fitnessRepository.transaction(() => {
        const timestamp = now().toISOString();
        const assessment = calculateRecovery({ sleepHours: input.sleepMinutes / 60, energy: input.energyLevel, discomfort: input.discomfortLevel });
        const recovery = { score: assessment.score, level: assessment.level, reasonCodes: assessment.reasons };
        const safety = deriveWorkoutSafetyV1(input);
        const signal = calendarRepository.createSignal({ id: newId(), ownerId, localDate: input.localDate, kind: 'RECOVERY', value: recovery.score, source: 'CHECK_IN', version: 1, createdAt: timestamp, updatedAt: timestamp });
        const checkIn = fitnessRepository.createCheckIn({ ownerId, raw: input, checkIn: { id: newId(), signalId: signal.id, ...input, recovery, safety, policyVersion: 'WORKOUT_SAFETY_V1', version: 1, createdAt: timestamp } });
        healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'FITNESS_CHECK_IN_CREATED', entityType: 'FITNESS_CHECK_IN', entityId: checkIn.id, entityVersion: 1, metadata: { policyVersion: checkIn.policyVersion, reasonCodes: checkIn.safety.reasonCodes }, createdAt: timestamp });
        return { status: 201, body: { checkIn, signal } };
      }));
      if (isInProgress(result)) throw new ApiError(409, 'IN_PROGRESS', '请求仍在处理中');
      return { ...(result.body as { checkIn: CheckIn; signal: Signal }), replayed: result.replayed };
    },
    listCheckIns(ownerId, query) {
      const result = fitnessRepository.listCheckIns(ownerId, query);
      return { items: result.items, pagination: pagination(query.page, query.pageSize, result.total) };
    },
    listExercises(ownerId, query) {
      const checkIn = fitnessRepository.findCheckIn(ownerId, query.checkInId);
      if (!checkIn) throw new ApiError(404, 'FITNESS_CHECK_IN_NOT_FOUND', '训练状态记录不存在');
      if (checkIn.safety.eligibility === 'BLOCKED') {
        return { safety: checkIn.safety, manifest: catalog.manifest, items: [], pagination: pagination(query.page, query.pageSize, 0) };
      }
      const ranked = rankExerciseCatalogV1({ safety: checkIn.safety, goal: query.goal ?? 'RECOVERY', availableEquipment: query.equipment ?? [], query: query.query ?? null, items: catalog.items, limit: 5 });
      const byId = new Map(catalog.items.map((item) => [item.exerciseId, item]));
      const items = ranked.map((item) => byId.get(item.exerciseId) as LoadedInternalExerciseCatalog['items'][number]);
      return { safety: checkIn.safety, manifest: catalog.manifest, items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), pagination: pagination(query.page, query.pageSize, items.length) };
    },
    async createWorkout(ownerId, input, idempotencyKey) {
      const checkIn = fitnessRepository.findCheckIn(ownerId, input.checkInId);
      if (!checkIn) throw new ApiError(404, 'FITNESS_CHECK_IN_NOT_FOUND', '训练状态记录不存在');
      validateScheduling(checkIn, input.scheduling);
      const safety = eligibleSafety(checkIn);
      let intensityCap: 'LOW' | 'MODERATE' = safety.intensityCap;
      const timestamp = now().toISOString();
      let selectedCitations: ExerciseCitation[];
      let title: string;
      let rationale: string;
      let provenance: WorkoutRevision['provenance'];
      let disclosure: unknown | null = null;
      if (input.mode === 'MANUAL') {
        const byCitationId = new Map(catalog.items.map((item) => [item.citation.citationId, item.citation]));
        selectedCitations = input.citationIds.map((citationId) => {
          const citation = byCitationId.get(citationId);
          if (!citation) throw new ApiError(422, 'CITATION_INVALID', '训练动作引用不属于当前内部目录');
          return citation;
        });
        title = `${input.goal} review workout`;
        rationale = '由已验证内部目录生成，等待主人确认。';
        provenance = [{ kind: 'RULES', capabilityRunId: null, editedFields: [], capturedAt: timestamp }];
        const result = v07IdempotencyService.executeLocal({
          ownerId, key: idempotencyKey, operation: 'fitness.workout.create', resourceId: input.checkInId, body: input,
        }, () => {
          const selectedItems = validateCitations(selectedCitations, catalog);
          const items = createWorkoutDefaultsV1({ citations: selectedItems.map((item) => item.citation), catalogItems: catalog.items, durationMinutes: input.scheduling.durationMinutes, intensityCap });
          const workoutId = newId();
          const revision = createRevision({ workoutId, parentRevisionId: null, revisionNo: 1, title, rationale, items, scheduling: input.scheduling, provenance, createdAt: timestamp });
          const workout: Workout = { id: workoutId, checkInId: checkIn.id, signalId: checkIn.signalId, generationMode: input.mode, state: 'DRAFT', currentRevisionId: revision.id, proposalId: null, actionId: null, timeRequestId: null, feedbackId: null, version: 1, createdAt: timestamp, updatedAt: timestamp };
          const stored = fitnessRepository.createWorkoutWithRevision({ ownerId, workout, revision, catalog: catalogRef });
          healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'WORKOUT_DRAFT_CREATED', entityType: 'WORKOUT', entityId: workout.id, entityVersion: workout.version, metadata: { generationMode: workout.generationMode, revisionId: revision.id }, createdAt: timestamp });
          return { status: 201, body: { ...stored, disclosure } };
        });
        if (isInProgress(result)) throw new ApiError(409, 'IN_PROGRESS', '请求仍在处理中');
        return { ...(result.body as { workout: Workout; revision: WorkoutRevision; disclosure: unknown | null }), replayed: result.replayed };
      } else {
        const capabilityRunId = newId();
        if (!options.healthTextProvider) {
          healthLoopRepository.createCapabilityRun({ id: capabilityRunId, ownerId, capability: 'WORKOUT_TEXT_SELECTION', operation: 'fitness.workout.create', resourceId: input.checkInId, providerId: null, providerLabel: 'Not configured', adapterKind: 'NONE', evidenceKind: 'NONE', disclosure: { disclosureVersion: input.disclosureVersion }, status: 'BLOCKED_PROVIDER', localDate: checkIn.localDate, appVersion: APP_VERSION, createdAt: timestamp });
          healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'HEALTH_CAPABILITY_BLOCKED', entityType: 'CAPABILITY_RUN', entityId: capabilityRunId, entityVersion: 1, metadata: { capability: 'WORKOUT_TEXT_SELECTION', code: 'HEALTH_TEXT_PROVIDER_NOT_CONFIGURED' }, createdAt: timestamp });
          throw new ApiError(503, 'HEALTH_TEXT_PROVIDER_NOT_CONFIGURED', '训练文本能力尚未配置');
        }
        if (healthLoopRepository.countReservedCalls(ownerId, checkIn.localDate, 'WORKOUT_TEXT_SELECTION') >= 5) throw new ApiError(429, 'RATE_LIMITED', '今日训练文本能力调用次数已达上限');
        const candidates = this.listExercises(ownerId, { checkInId: input.checkInId, goal: input.goal, equipment: input.availableEquipment, page: 1, pageSize: 5 }).items;
        if (candidates.length === 0) throw new ApiError(422, 'CITATION_INVALID', '没有满足当前约束的训练动作');
        healthLoopRepository.createCapabilityRun({ id: capabilityRunId, ownerId, capability: 'WORKOUT_TEXT_SELECTION', operation: 'fitness.workout.create', resourceId: input.checkInId, providerId: options.healthTextProvider.descriptor.providerId, providerLabel: options.healthTextProvider.descriptor.providerLabel, adapterKind: options.healthTextProvider.descriptor.adapterKind, evidenceKind: options.healthTextProvider.descriptor.evidenceKind, disclosure: { disclosureVersion: input.disclosureVersion }, status: 'AWAITING_DISCLOSURE', localDate: checkIn.localDate, appVersion: APP_VERSION, createdAt: timestamp });
        const leaseToken = newId();
        const claimed = healthLoopRepository.claimCapabilityRun({ ownerId, id: capabilityRunId, key: idempotencyKey, requestHash: contentHash({ goal: input.goal, citations: candidates.map((item) => item.citation.citationId) }), leaseToken, deadlineAt: new Date(Date.parse(timestamp) + 8_000).toISOString(), leaseExpiresAt: new Date(Date.parse(timestamp) + 10_000).toISOString(), reservedCalls: 1, now: timestamp });
        if (!claimed) throw new ApiError(409, 'IN_PROGRESS', '训练文本能力仍在处理中');
        let selection: Awaited<ReturnType<typeof executeWorkoutTextSelection>>;
        try {
          selection = await executeWorkoutTextSelection({ goal: input.goal, maxDurationMinutes: safety.maxDurationMinutes, intensityCap: safety.intensityCap, catalog: candidates }, options.healthTextProvider);
        } catch {
          healthLoopRepository.failCapabilityRun({ ownerId, id: capabilityRunId, leaseToken, actualCalls: 1, inputBytes: 0, outputBytes: 0, failureCode: 'HEALTH_TEXT_PROVIDER_INVALID_RESPONSE', now: now().toISOString() });
          throw new ApiError(503, 'HEALTH_TEXT_PROVIDER_UNAVAILABLE', '训练文本能力当前不可用');
        }
        const current = fitnessRepository.findCheckIn(ownerId, input.checkInId);
        if (!current) throw new ApiError(404, 'FITNESS_CHECK_IN_NOT_FOUND', '训练状态记录不存在');
        validateScheduling(current, input.scheduling);
        const currentSafety = eligibleSafety(current);
        intensityCap = currentSafety.intensityCap;
        const citationsById = new Map(candidates.map((item) => [item.citation.citationId, item.citation]));
        selectedCitations = selection.orderedCitationIds.map((citationId) => {
          const citation = citationsById.get(citationId);
          if (!citation) throw new ApiError(503, 'HEALTH_TEXT_PROVIDER_UNAVAILABLE', '训练文本能力返回了无效引用');
          return citation;
        });
        healthLoopRepository.completeCapabilityRun({ ownerId, id: capabilityRunId, leaseToken, actualCalls: 1, inputBytes: 0, outputBytes: 0, evidenceKind: options.healthTextProvider.descriptor.evidenceKind, now: now().toISOString() });
        title = selection.title;
        rationale = selection.rationale;
        provenance = [{ kind: 'MODEL_SELECTION', capabilityRunId, editedFields: ['title', 'rationale', 'orderedCitationIds'], capturedAt: timestamp }];
        disclosure = { capabilityRunId, disclosureVersion: input.disclosureVersion };
      }
      const selectedItems = validateCitations(selectedCitations, catalog);
      const items = createWorkoutDefaultsV1({ citations: selectedItems.map((item) => item.citation), catalogItems: catalog.items, durationMinutes: input.scheduling.durationMinutes, intensityCap });
      const workoutId = newId();
      const revision = createRevision({ workoutId, parentRevisionId: null, revisionNo: 1, title, rationale, items, scheduling: input.scheduling, provenance, createdAt: timestamp });
      const workout: Workout = { id: workoutId, checkInId: checkIn.id, signalId: checkIn.signalId, generationMode: input.mode, state: 'DRAFT', currentRevisionId: revision.id, proposalId: null, actionId: null, timeRequestId: null, feedbackId: null, version: 1, createdAt: timestamp, updatedAt: timestamp };
      const stored = fitnessRepository.createWorkoutWithRevision({ ownerId, workout, revision, catalog: catalogRef });
      healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'WORKOUT_DRAFT_CREATED', entityType: 'WORKOUT', entityId: workout.id, entityVersion: workout.version, metadata: { generationMode: workout.generationMode, revisionId: revision.id }, createdAt: timestamp });
      return { ...stored, disclosure, replayed: false };
    },
    reviseWorkout(ownerId, workoutId, input, idempotencyKey) {
      const result = v07IdempotencyService.executeLocal({ ownerId, key: idempotencyKey, operation: 'fitness.workout.revise', resourceId: workoutId, body: input }, () => {
        const workout = fitnessRepository.findWorkout(ownerId, workoutId);
        if (!workout) throw new ApiError(404, 'WORKOUT_NOT_FOUND', '训练草稿不存在');
        if (workout.state !== 'DRAFT') throw new ApiError(422, 'WORKOUT_NOT_EDITABLE', '当前训练不可修改');
        if (workout.currentRevisionId !== input.parentRevisionId) throw new ApiError(409, 'REVISION_PARENT_STALE', '训练版本已变化');
        const checkIn = fitnessRepository.findCheckIn(ownerId, workout.checkInId);
        if (!checkIn) throw new ApiError(404, 'FITNESS_CHECK_IN_NOT_FOUND', '训练状态记录不存在');
        validateScheduling(checkIn, input.scheduling);
        validateCitations(input.items.map((item) => item.citation), catalog);
        const timestamp = now().toISOString();
        const revision = createRevision({ workoutId, parentRevisionId: input.parentRevisionId, revisionNo: (fitnessRepository.findWorkoutRevision(ownerId, input.parentRevisionId)?.revisionNo ?? 0) + 1, title: input.title, rationale: input.rationale, items: input.items, scheduling: input.scheduling, provenance: [{ kind: 'OWNER_EDIT', capabilityRunId: null, editedFields: ['title', 'rationale', 'items', 'scheduling'], capturedAt: timestamp }], createdAt: timestamp });
        const stored = fitnessRepository.appendWorkoutRevision({ ownerId, workoutId, expectedVersion: input.expectedVersion, revision, catalog: catalogRef, updatedAt: timestamp });
        if (!stored) throw new ApiError(409, 'VERSION_CONFLICT', '训练版本已变化');
        healthLoopRepository.appendAudit({ id: newId(), ownerId, eventType: 'WORKOUT_REVISION_CREATED', entityType: 'WORKOUT', entityId: workoutId, entityVersion: stored.workout.version, metadata: { revisionId: revision.id }, createdAt: timestamp });
        return { status: 201, body: stored };
      });
      if (isInProgress(result)) throw new ApiError(409, 'IN_PROGRESS', '请求仍在处理中');
      return { ...(result.body as { workout: Workout; revision: WorkoutRevision }), replayed: result.replayed };
    },
    listWorkouts(ownerId, query) {
      const result = fitnessRepository.listWorkouts(ownerId, query);
      return { items: result.items, pagination: pagination(query.page, query.pageSize, result.total) };
    },
    getWorkout(ownerId, workoutId) {
      const workout = fitnessRepository.findWorkout(ownerId, workoutId);
      if (!workout) throw new ApiError(404, 'WORKOUT_NOT_FOUND', '训练草稿不存在');
      const checkIn = fitnessRepository.findCheckIn(ownerId, workout.checkInId);
      const revision = fitnessRepository.findWorkoutRevision(ownerId, workout.currentRevisionId);
      if (!checkIn || !revision) throw new Error('WORKOUT_LINEAGE_CORRUPT');
      return { workout, checkIn, revision, proposal: null, action: null, timeRequest: null, feedback: null };
    },
  };
}
