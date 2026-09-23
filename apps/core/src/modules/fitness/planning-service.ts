import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  APP_VERSION, createDetailedWorkoutV2Schema, reviseDetailedWorkoutV2Schema, workoutRevisionV2Schema,
  workoutPlanningOutputV2Schema, workoutDetailedPlanningCapabilityDescriptorSchema, workoutFeedbackSchema,
  type Workout, type WorkoutRevisionV2, type Proposal, type CreateDetailedWorkoutV2,
  type ReviseDetailedWorkoutV2, type PreviewWorkoutContextV2, type WorkoutFeedbackInput,
} from '@ev/contracts';
import { validateWorkoutPlanV2, type WorkoutPlanningProvider } from '@ev/domain';
import { ApiError, V07DailyQuotaError } from '../../http/api-error';
import type { CalendarRepository } from '../calendar/repository';
import type { V07IdempotencyService } from '../health-loop/idempotency-service';
import { canonicalJson, type V07HealthLoopRepository } from '../health-loop/repository';
import { executeV07ProviderBoundary, V07ProviderBoundaryError } from '../health-loop/provider-boundary';
import type { createEntityMemoryService } from '../memory/entity-service';
import { createFitnessPlanningContextService, type FitnessCandidateQuery, type FitnessPlanningContextService } from './planning-context';
import { createFitnessRepository, WorkoutProposalStateConflictError } from './repository';
import type { FitnessService } from './service';
import { createFitnessFeedbackMemory, type FitnessFeedbackMemoryStatus } from './feedback-memory';

export interface WorkoutPlanningServiceOptions {
  now?: () => Date;
  newId?: () => string;
  workoutPlanningProvider?: WorkoutPlanningProvider;
  isConfigured?: (ownerId: string) => boolean;
  memory?: ReturnType<typeof createEntityMemoryService>;
}
export function workoutPlanContentHash(revision: WorkoutRevisionV2): string {
  const { id: _id, contentHash: _hash, createdAt: _at, ...content } = revision;
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}
export function workoutPlanCitationIds(revision: WorkoutRevisionV2): string[] {
  return [...new Set([...revision.items, ...revision.alternatives.map(a => a.item)].map(i => i.citationId))];
}
function conflict(): never { throw new ApiError(409, 'WORKOUT_CONTEXT_CHANGED', '训练版本或依据已变化，请重新审阅'); }

export function createWorkoutPlanningService(
  database: Database.Database, calendar: CalendarRepository, fitness: FitnessService,
  health: V07HealthLoopRepository, idempotency: V07IdempotencyService, options: WorkoutPlanningServiceOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const repository = createFitnessRepository(database);
  const context = createFitnessPlanningContextService(database, { now });
  const feedbackMemory = createFitnessFeedbackMemory(database, options.memory, { now });
  const configured = (owner: string) => !!options.workoutPlanningProvider && (options.isConfigured?.(owner) ?? true);
  function detail(owner: string, id: string) {
    const workout = repository.findWorkout(owner, id);
    if (!workout) throw new ApiError(404, 'WORKOUT_NOT_FOUND', '训练不存在');
    if (repository.currentRevisionSchema(owner, id) !== 'WORKOUT_PLAN_V2') throw new ApiError(409, 'WORKOUT_SCHEMA_MISMATCH', '请使用对应版本的训练入口');
    const stored = repository.findWorkoutRevisionV2(owner, workout.currentRevisionId);
    if (!stored || stored.revision.workoutId !== id) conflict();
    return { workout, ...stored };
  }
  function validateStored(owner: string, revision: WorkoutRevisionV2, citations: ReturnType<typeof detail>['citations']) {
    if (workoutPlanContentHash(revision) !== revision.contentHash) conflict();
    context.revalidateCurrent(owner, revision, citations);
  }
  function audit(ownerId: string, workout: Workout, eventType: string) {
    health.appendAudit({ id: newId(), ownerId, eventType, entityType: 'WORKOUT', entityId: workout.id,
      entityVersion: workout.version, metadata: { revisionId: workout.currentRevisionId }, createdAt: now().toISOString() });
  }
  return {
    getProfile(owner: string) { return { profile: context.readProfile(owner) ?? null }; },
    putProfile(owner: string, input: Parameters<FitnessPlanningContextService['saveProfile']>[1]) { return { profile: context.saveProfile(owner, input) }; },
    listCandidates(owner: string, query: FitnessCandidateQuery) { return { items: context.listCandidates(owner, query) }; },
    listMemory(owner: string) { return { items: context.listSelectableCurrentFitnessMemory(owner) }; },
    previewContext(owner: string, input: PreviewWorkoutContextV2) { return context.preview(owner, input); },
    getCapability(owner: string) {
      const ready = configured(owner);
      return workoutDetailedPlanningCapabilityDescriptorSchema.parse({ capability: 'WORKOUT_DETAILED_PLANNING',
        availability: ready ? 'READY' : 'NOT_CONFIGURED', disclosureVersion: 'HEALTH_DISCLOSURE_V2', policyVersion: 'HEALTH_CAPABILITY_POLICY_V1',
        realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED', ...(ready ? options.workoutPlanningProvider!.descriptor : {
          providerId: null, providerLabel: 'Not configured', adapterKind: 'NONE', evidenceKind: 'NONE',
        }) });
    },
    async createDetailedWorkout(ownerId: string, raw: CreateDetailedWorkoutV2, key: string) {
      const parsed = createDetailedWorkoutV2Schema.safeParse(raw);
      if (!parsed.success) throw new ApiError(422, 'WORKOUT_PLAN_INPUT_INVALID', '训练输入无效');
      const input = parsed.data;
      type Result = { workout: Workout; revision: WorkoutRevisionV2; totalDurationSeconds: number; capabilityRunId: string };
      const started = idempotency.beginExternal<Result>({ ownerId, key, operation: 'fitness.workout.create', resourceId: input.checkInId, body: input });
      if (started.kind === 'REPLAY') return { ...started.response.body, replayed: true };
      const claim = started.claim;
      const capabilityRunId = newId();
      let reserved = false;
      let actualCalls = 0;
      let inputBytes = 0;
      let outputBytes = 0;
      try {
        const resolved = repository.transaction(() => {
          const value = context.resolveConfirmed(ownerId, input);
          if (!configured(ownerId)) throw new ApiError(503, 'HEALTH_TEXT_PROVIDER_NOT_CONFIGURED', '详细训练能力尚未配置');
          if (health.countReservedWorkoutCalls(ownerId, value.payload.checkIn.localDate) >= 5) throw new V07DailyQuotaError('今日训练调用已达上限');
          const provider = options.workoutPlanningProvider!;
          const timestamp = now().toISOString();
          health.createClaimedCapabilityRun({ id: capabilityRunId, ownerId, capability: 'WORKOUT_DETAILED_PLANNING',
            operation: 'fitness.workout.create', resourceId: input.checkInId, providerId: provider.descriptor.providerId,
            providerLabel: provider.descriptor.providerLabel, adapterKind: provider.descriptor.adapterKind,
            disclosureVersion: 'HEALTH_DISCLOSURE_V2', disclosure: value.receipt, localDate: value.payload.checkIn.localDate,
            appVersion: APP_VERSION, idempotencyKey: key, requestHash: claim.requestHash, leaseToken: claim.leaseToken,
            leaseExpiresAt: claim.leaseExpiresAt, deadlineAt: new Date(now().getTime() + 8000).toISOString(), createdAt: timestamp });
          return value;
        });
        reserved = true;
        const provider = options.workoutPlanningProvider!;
        const generated = await executeV07ProviderBoundary({ input: resolved.payload,
          invoke: (payload, signal) => { actualCalls = 1; return provider.generateWorkout(ownerId, payload, signal); },
          parseOutput: output => workoutPlanningOutputV2Schema.parse(output),
          correlateOutput: (output, payload) => { validateWorkoutPlanV2(payload, output); } });
        inputBytes = generated.inputBytes; outputBytes = generated.outputBytes;
        const finished = idempotency.completeExternal(claim, () => {
          // Rebuild the authorized payload after awaiting the provider; reject stale consent before saving.
          context.resolveConfirmed(ownerId, input);
          const timestamp = now().toISOString();
          const workoutId = newId();
          const { totalDurationSeconds, ...plan } = generated.value;
          const revision = workoutRevisionV2Schema.parse({ ...plan, id: newId(), workoutId, parentRevisionId: null, revisionNo: 1,
            scheduling: resolved.payload.scheduling, contextReceipt: resolved.receipt, policyVersion: resolved.payload.policyVersion,
            provenance: [{ kind: 'MODEL_SELECTION', capabilityRunId, editedFields: ['title', 'rationale', 'items', 'alternatives'], capturedAt: timestamp }],
            contentHash: '0'.repeat(64), createdAt: timestamp });
          revision.contentHash = workoutPlanContentHash(revision);
          context.revalidateCurrent(ownerId, revision, resolved.citations);
          const workout: Workout = { id: workoutId, checkInId: input.checkInId,
            signalId: repository.findCheckIn(ownerId, input.checkInId)!.signalId, generationMode: 'ASSISTED', state: 'DRAFT',
            currentRevisionId: revision.id, proposalId: null, actionId: null, timeRequestId: null, feedbackId: null,
            version: 1, createdAt: timestamp, updatedAt: timestamp };
          repository.createWorkoutWithRevisionV2({ ownerId, workout, revision, citations: resolved.citations });
          if (!health.completeCapabilityRun({ ownerId, id: capabilityRunId, leaseToken: claim.leaseToken, actualCalls,
            inputBytes, outputBytes, evidenceKind: provider.descriptor.evidenceKind, now: timestamp })) throw new ApiError(409, 'WORKOUT_RUN_STALE', '训练请求已失效');
          audit(ownerId, workout, 'WORKOUT_DRAFT_CREATED');
          return { status: 201, body: { workout, revision, totalDurationSeconds, capabilityRunId } };
        }, () => {
          health.failCapabilityRun({ ownerId, id: capabilityRunId, leaseToken: claim.leaseToken, actualCalls, inputBytes, outputBytes,
            failureCode: 'WORKOUT_FINALIZATION_REJECTED', now: now().toISOString() });
        });
        return { ...finished.body, replayed: finished.replayed };
      } catch (caught) {
        const run = health.findCapabilityRun(ownerId, capabilityRunId);
        if (run?.state === 'FAILED') throw caught; // already terminalized by completeExternal
        if (caught instanceof V07ProviderBoundaryError) {
          inputBytes = Math.min(caught.inputBytes ?? 0, 24000); outputBytes = Math.min(caught.outputBytes ?? 0, 12000);
        }
        const error = caught instanceof ApiError ? caught : new ApiError(503, 'HEALTH_TEXT_PROVIDER_UNAVAILABLE', '详细训练能力当前不可用');
        idempotency.failExternal(claim, error, () => {
          if (reserved) health.failCapabilityRun({ ownerId, id: capabilityRunId, leaseToken: claim.leaseToken, actualCalls,
            inputBytes, outputBytes, failureCode: error.code, now: now().toISOString() });
        });
        throw error;
      }
    },
    reviseDetailedWorkout(owner: string, id: string, raw: ReviseDetailedWorkoutV2, key: string) {
      const parsed = reviseDetailedWorkoutV2Schema.safeParse(raw);
      if (!parsed.success) throw new ApiError(422, 'WORKOUT_PLAN_INPUT_INVALID', '训练编辑无效');
      const input = parsed.data;
      const result = idempotency.executeLocal({ ownerId: owner, key, operation: 'fitness.workout.revise', resourceId: id, body: input }, () => {
        const current = detail(owner, id);
        if (current.workout.state !== 'DRAFT' || current.workout.version !== input.expectedVersion || current.revision.id !== input.parentRevisionId) conflict();
        validateStored(owner, current.revision, current.citations);
        if (canonicalJson(input.contextReceipt) !== canonicalJson(current.revision.contextReceipt) || input.policyVersion !== current.revision.policyVersion) conflict();
        const { expectedVersion: _expected, ...changes } = input;
        const timestamp = now().toISOString();
        const revision = workoutRevisionV2Schema.parse({ ...current.revision, ...changes, id: newId(), revisionNo: current.revision.revisionNo + 1,
          provenance: [...current.revision.provenance.slice(-9), { kind: 'OWNER_EDIT', capabilityRunId: null, editedFields: ['title', 'rationale', 'items', 'alternatives', 'scheduling'], capturedAt: timestamp }], createdAt: timestamp });
        revision.contentHash = workoutPlanContentHash(revision);
        context.revalidateCurrent(owner, revision, current.citations);
        const stored = repository.appendWorkoutRevisionV2({ ownerId: owner, workoutId: id, expectedVersion: input.expectedVersion,
          revision, citations: current.citations, updatedAt: timestamp });
        if (!stored) conflict();
        audit(owner, stored.workout, 'WORKOUT_REVISION_CREATED');
        return { status: 201, body: stored };
      });
      return { ...result.body, replayed: result.replayed };
    },
    listDetailedWorkouts(owner: string, query: { page: number; pageSize: number; state?: Workout['state']; localDate?: string }) {
      if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 50) throw new ApiError(422, 'PAGINATION_INVALID', '分页参数无效');
      const page = repository.listWorkouts(owner, query);
      return { items: page.items.map(workout => {
        const revisionSchema = repository.currentRevisionSchema(owner, workout.id);
        if (!revisionSchema) conflict();
        return { workout, revisionSchema };
      }), pagination: { page: query.page, pageSize: query.pageSize, total: page.total, totalPages: Math.ceil(page.total / query.pageSize) } };
    },
    getDetailedWorkout(owner: string, id: string) {
      const stored = detail(owner, id);
      const action = repository.findWorkoutAction(owner, id) ?? null;
      return { ...stored, proposal: repository.findWorkoutProposal(owner, id) ?? null, action,
        timeRequest: action ? calendar.listTimeRequestHistoryForOrigin(owner, { kind: 'ACTION', entityId: action.id }).at(-1) ?? null : null,
        feedback: repository.findWorkoutFeedback(owner, id) ?? null };
    },
    createDetailedWorkoutProposal(owner: string, id: string, input: { expectedVersion: number; revisionId: string }, key: string) {
      const result = idempotency.executeLocal({ ownerId: owner, key, operation: 'fitness.workout.propose', resourceId: id, body: input }, () => {
        const { workout, revision, citations } = detail(owner, id);
        if (workout.state !== 'DRAFT' || workout.version !== input.expectedVersion || revision.id !== input.revisionId) conflict();
        validateStored(owner, revision, citations);
        const timestamp = now().toISOString();
        const proposal: Proposal = { id: newId(), kind: 'WORKOUT', status: 'PENDING', source: 'FITNESS_AGENT', title: revision.title,
          changes: [{ operation: 'CREATE_WORKOUT_ACTION', workout: { workoutId: id, revisionId: revision.id, expectedWorkoutVersion: workout.version + 1, contentHash: revision.contentHash },
            action: { id: newId(), title: revision.title, targetDate: revision.scheduling.targetDate, status: 'OPEN', kind: 'FITNESS', version: 1, createdAt: timestamp, updatedAt: timestamp },
            scheduling: { timeRequestId: newId(), durationMinutes: revision.scheduling.durationMinutes, priority: revision.scheduling.priority,
              earliestStartLocalTime: revision.scheduling.earliestStartLocalTime, latestEndLocalTime: revision.scheduling.latestEndLocalTime, isFixed: false }, citationIds: workoutPlanCitationIds(revision) }],
          version: 1, createdAt: timestamp, expiresAt: null };
        try {
          const marked = repository.createWorkoutProposal({ ownerId: owner, workoutId: id, expectedVersion: input.expectedVersion, revisionId: revision.id, proposal, updatedAt: timestamp });
          audit(owner, marked, 'WORKOUT_PROPOSAL_CREATED');
          return { status: 201, body: { workout: marked, proposal } };
        } catch (error) { if (error instanceof WorkoutProposalStateConflictError) conflict(); throw error; }
      });
      return { ...result.body, replayed: result.replayed };
    },
    recordDetailedWorkoutFeedback(owner: string, id: string, input: WorkoutFeedbackInput, key: string) {
      detail(owner, id);
      const parsed = workoutFeedbackSchema.safeParse(input);
      if (!parsed.success) throw new ApiError(422, 'WORKOUT_FEEDBACK_INVALID', '训练反馈无效');
      const result = fitness.recordWorkoutFeedback(owner, id, parsed.data, key);
      const memoryStatus: FitnessFeedbackMemoryStatus = result.replayed ? { state: 'REPLAYED' }
        : feedbackMemory.record(owner, id, String(result.feedback.id));
      return { ...result, memoryStatus };
    },
  };
}
export type WorkoutPlanningService = ReturnType<typeof createWorkoutPlanningService>;
