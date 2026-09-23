import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import * as z from 'zod';
import {
  previewWorkoutContextV2Schema, createDetailedWorkoutV2Schema, workoutPlanningInputV2Schema,
  workoutContextPreviewV2Schema, workoutContextReceiptV2Schema, workoutPlanningCandidateV2Schema,
  workoutGoalSchema, workoutRevisionV2Schema,
  type PreviewWorkoutContextV2, type CreateDetailedWorkoutV2, type WorkoutPlanningInputV2,
  type WorkoutContextPreviewV2, type WorkoutContextReceiptV2, type WorkoutPlanningProfileV2,
  type WorkoutPlanningCandidateV2, type WorkoutRevisionV2,
} from '@ev/contracts';
import { validateWorkoutPlanV2 } from '@ev/domain';
import { ApiError } from '../../http/api-error';
import { loadInternalExerciseCatalog } from './catalog';
import { PUBLIC_GUIDANCE_POLICY, publicGuidanceFor } from './public-guidance';
import { createFitnessRepository, type WorkoutCandidateSnapshot, type FitnessMemoryMetadata } from './repository';

export const FITNESS_PLANNING_POLICY = PUBLIC_GUIDANCE_POLICY;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const candidateQuerySchema = z.object({
  checkInId: z.uuid(), goal: workoutGoalSchema,
  sourceKind: z.enum(['INTERNAL_STARTER', 'EXTERNAL_DATASET']).optional(),
}).strict();
export type FitnessCandidateQuery = z.infer<typeof candidateQuerySchema>;
export interface ResolvedWorkoutContextV2 {
  payload: WorkoutPlanningInputV2;
  receipt: WorkoutContextReceiptV2;
  citations: WorkoutCandidateSnapshot[];
}
export interface FitnessPlanningContextService {
  readProfile(ownerId: string): WorkoutPlanningProfileV2 | undefined;
  saveProfile(ownerId: string, input: { expectedVersion: number | null; profile: Omit<WorkoutPlanningProfileV2, 'version'> }): WorkoutPlanningProfileV2;
  listCandidates(ownerId: string, query: FitnessCandidateQuery): WorkoutPlanningCandidateV2[];
  listSelectableCurrentFitnessMemory(ownerId: string): FitnessMemoryMetadata[];
  preview(ownerId: string, input: PreviewWorkoutContextV2): WorkoutContextPreviewV2;
  resolveConfirmed(ownerId: string, input: CreateDetailedWorkoutV2): ResolvedWorkoutContextV2;
  revalidateCurrent(ownerId: string, revision: WorkoutRevisionV2, citations: WorkoutCandidateSnapshot[]): WorkoutPlanningInputV2;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map((key) => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function changed(): never { throw new ApiError(409, 'WORKOUT_CONTEXT_CHANGED', '训练依据已变化，请重新预览'); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(422, 'WORKOUT_CONTEXT_INVALID', '训练上下文无效或超过上限');
  return result.data;
}

export function createFitnessPlanningContextService(
  database: Database.Database,
  options: { now?: () => Date } = {},
): FitnessPlanningContextService {
  const repository = createFitnessRepository(database);
  const now = options.now ?? (() => new Date());
  const catalog = loadInternalExerciseCatalog();

  const readBasis = (ownerId: string, checkInId: string, at: string) => {
    const checkIn = repository.findCheckIn(ownerId, checkInId);
    const profile = repository.readProfile(ownerId);
    if (!checkIn || !profile) throw new ApiError(404, 'WORKOUT_CONTEXT_NOT_FOUND', '缺少当前训练状态或画像');
    const current = repository.findLatestEffectiveCheckIn(ownerId, at);
    if (!current) changed();
    if (current.hasPain || current.acuteRisk || current.safety.eligibility !== 'ELIGIBLE' || repository.hasRecentPain(ownerId, at)) {
      throw new ApiError(422, 'WORKOUT_SAFETY_BLOCKED', '停止训练并寻求专业帮助');
    }
    if (current.id !== checkIn.id || current.version !== checkIn.version) changed();
    if (!profile.limitationsComplete || profile.limitations === 'UNKNOWN' || profile.limitations.length !== 0) {
      throw new ApiError(422, 'WORKOUT_PROFESSIONAL_CONFIRMATION_REQUIRED', '当前限制需要专业确认，无法确定适用候选');
    }
    if (profile.generalExerciseScope !== 'GENERAL_ADULT_19_64_V1') {
      throw new ApiError(422, 'WORKOUT_APPLICABILITY_CONFIRMATION_REQUIRED', '请先核对并确认一般成人运动指导的适用条件；不符合或不确定时请咨询专业人员');
    }
    return { checkIn, profile };
  };

  const snapshots = (ownerId: string, query: FitnessCandidateQuery, at: string): WorkoutCandidateSnapshot[] => {
    const { checkIn, profile } = readBasis(ownerId, query.checkInId, at);
    if (query.sourceKind === 'EXTERNAL_DATASET') {
      // FIT02 reviews hold free-text populations, not a machine-verifiable owner applicability grant.
      throw new ApiError(422, 'WORKOUT_PROFESSIONAL_CONFIRMATION_REQUIRED', '外部审核范围尚不能确定适用于当前用户');
    }
    if (!profile.goals.includes(query.goal)) throw new ApiError(422, 'WORKOUT_GOAL_MISMATCH', '目标未在画像中选择');
    if (query.goal !== 'STRENGTH') throw new ApiError(422, 'WORKOUT_GUIDANCE_GOAL_UNAVAILABLE', '当前有公开依据的组合仅支持一般力量训练；其他目标尚无完整适用依据');
    return catalog.items.flatMap((item) => {
      const supported = publicGuidanceFor(item);
      if (!supported || !item.equipment.every(equipment => equipment === 'NONE' || profile.availableEquipment.includes(equipment))) return [];
      const candidate = parse(workoutPlanningCandidateV2Schema, {
        citationId: digest({ citation: item.citation.citationId, guidance: supported, policy: FITNESS_PLANNING_POLICY }),
        sourceKind: 'INTERNAL_STARTER', source: item.citation.catalogId, version: item.citation.catalogVersion,
        hash: item.citation.catalogHash, itemHash: item.citation.itemHash,
        technicalSummary: item.name + ': ' + item.neutralTechniqueText,
        // Walking supports preparation/recovery phases of this strength session, not its main strength stimulus.
        goals: ['STRENGTH'], equipment: item.equipment, intensityCap: 'LOW',
        parameterLimits: supported.limits, publicGuidance: supported.guidance,
        eligibility: { status: 'ELIGIBLE', limitations: [], reviewRef: null, policyRef: FITNESS_PLANNING_POLICY },
      });
      return [{ candidate, name: item.name, instructions: [item.neutralTechniqueText] }];
    });
  };

  const build = (ownerId: string, input: PreviewWorkoutContextV2, at: string) => {
    const { checkIn, profile } = readBasis(ownerId, input.checkInId, at);
    if (checkIn.version !== input.expectedCheckInVersion || profile.version !== input.expectedProfileVersion) changed();
    const fields = input.authorization.allowedFields;
    for (const required of ['PROFILE_GOALS', 'PROFILE_EQUIPMENT', 'PROFILE_LIMITATIONS', 'CHECK_IN', 'CANDIDATES', 'SCHEDULING'] as const) {
      if (!fields.includes(required)) throw new ApiError(422, 'WORKOUT_AUTHORIZATION_REQUIRED', '必要的上下文字段尚未授权');
    }
    if (input.authorization.selectedFitnessMemoryIds.length && !fields.includes('FITNESS_MEMORY')) {
      throw new ApiError(422, 'WORKOUT_AUTHORIZATION_REQUIRED', '记忆正文尚未授权');
    }
    const available = snapshots(ownerId, { checkInId: input.checkInId, goal: input.goal }, at);
    const citations = input.candidateCitationIds.map((id) => {
      const snapshot = available.find((entry) => entry.candidate.citationId === id);
      if (!snapshot) changed();
      return snapshot;
    });
    if (!['WARMUP', 'MAIN', 'COOLDOWN'].every(phase => citations.some(({ candidate }) => candidate.publicGuidance?.phases.some(p => p === phase)))) {
      throw new ApiError(422, 'WORKOUT_GUIDANCE_PHASES_MISSING', '请保留慢走及至少一个适用的力量动作，才能覆盖热身、主训练和放松');
    }
    const memories = input.authorization.selectedFitnessMemoryIds.map((id) => {
      const memory = repository.readCurrentFitnessMemory(ownerId, id);
      if (!memory) changed();
      return memory;
    });
    const profilePayload = {
      ...profile,
      experience: fields.includes('PROFILE_EXPERIENCE') ? profile.experience : 'UNKNOWN',
      weeklyTrainingDays: fields.includes('PROFILE_EXPERIENCE') ? profile.weeklyTrainingDays : 0,
      bodyMeasurements: fields.includes('PROFILE_BODY_MEASUREMENTS') ? profile.bodyMeasurements : { weight: null, height: null },
      fitnessDescription: fields.includes('PROFILE_FITNESS_DESCRIPTION') ? profile.fitnessDescription : null,
    };
    const payload = parse(workoutPlanningInputV2Schema, {
      schemaVersion: 'WORKOUT_PLANNING_V2', policyVersion: FITNESS_PLANNING_POLICY, goal: input.goal, scheduling: input.scheduling,
      checkIn: { id: checkIn.id, version: checkIn.version, localDate: checkIn.localDate, hasPain: checkIn.hasPain, acuteRisk: checkIn.acuteRisk, safety: checkIn.safety },
      profile: profilePayload, authorization: input.authorization,
      recentFeedback: fields.includes('RECENT_FEEDBACK') ? repository.listRecentFeedback(ownerId, at) : [],
      selectedFitnessMemory: memories.map(({ id, content }) => ({ id, content })),
      candidates: citations.map(({ candidate }) => candidate),
    });
    const memoryRefs = memories.map(({ id, version, scopeType, scopeId }) => ({ id, version, scopeType, scopeId }));
    // Hash includes owner, exact current memory UUIDs/versions and full technical candidate/review/policy values.
    const contextHash = digest({ ownerId, payload, memoryRefs });
    const receiptFields = {
      schemaVersion: 'WORKOUT_PLANNING_V2' as const, contextHash, disclosureVersion: 'HEALTH_DISCLOSURE_V2' as const,
      allowedFields: fields, checkInId: checkIn.id, checkInVersion: checkIn.version, profileVersion: profile.version,
      candidateReferences: payload.candidates.map(({ citationId, sourceKind, source, version, hash, itemHash }) =>
        ({ citationId, sourceKind, source, version, hash, itemHash })),
    };
    return { payload, citations, contextHash, receiptFields };
  };

  return {
    readProfile: repository.readProfile,
    saveProfile(ownerId, input) {
      if (input.expectedVersion !== null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
        throw new ApiError(422, 'WORKOUT_PROFILE_VERSION_INVALID', '画像版本无效');
      }
      try { return repository.saveProfile(ownerId, input, now().toISOString()); }
      catch (error) { if (error instanceof z.ZodError) throw new ApiError(422, 'WORKOUT_PROFILE_INVALID', '画像内容无效'); throw error; }
    },
    listCandidates(ownerId, query) {
      return repository.transaction(() => snapshots(ownerId, parse(candidateQuerySchema, query), now().toISOString()).slice(0, 5).map(({ candidate }) => candidate));
    },
    listSelectableCurrentFitnessMemory: repository.listSelectableCurrentFitnessMemory,
    preview(ownerId, raw) {
      const input = parse(previewWorkoutContextV2Schema, raw);
      return repository.transaction(() => {
        const at = now().toISOString();
        const built = build(ownerId, input, at);
        const preview = parse(workoutContextPreviewV2Schema, {
          schemaVersion: 'WORKOUT_PLANNING_V2', payload: built.payload, contextHash: built.contextHash,
          previewReceipt: { ...built.receiptFields, previewedAt: at },
          fieldCounts: { feedback: built.payload.recentFeedback.length, fitnessMemory: built.payload.selectedFitnessMemory.length,
            candidates: built.payload.candidates.length, utf8Bytes: Buffer.byteLength(JSON.stringify(built.payload)) },
        });
        repository.savePreview(ownerId, built.contextHash, input, at, new Date(Date.parse(at) + PREVIEW_TTL_MS).toISOString());
        return preview;
      });
    },
    resolveConfirmed(ownerId, raw) {
      const input = parse(createDetailedWorkoutV2Schema, raw);
      return repository.transaction(() => {
        const at = now().toISOString();
        const stored = repository.readPreview(ownerId, input.contextHash, at);
        if (!stored) changed();
        const selection = parse(previewWorkoutContextV2Schema, stored);
        if (input.goal !== selection.goal || canonical(input.scheduling) !== canonical(selection.scheduling)
          || input.checkInId !== selection.checkInId || input.expectedCheckInVersion !== selection.expectedCheckInVersion
          || input.expectedProfileVersion !== selection.expectedProfileVersion
          || input.disclosureVersion !== selection.authorization.disclosureVersion
          || canonical([...input.allowedFields].sort()) !== canonical([...selection.authorization.allowedFields].sort())) changed();
        let built: ReturnType<typeof build>;
        try { built = build(ownerId, selection, at); }
        catch (error) {
          if (error instanceof ApiError && error.code === 'WORKOUT_SAFETY_BLOCKED') throw error;
          changed();
        }
        if (built.contextHash !== input.contextHash) changed();
        const receipt = parse(workoutContextReceiptV2Schema, { ...built.receiptFields, consentedAt: at });
        return { payload: built.payload, citations: built.citations, receipt };
      });
    },
    revalidateCurrent(ownerId, rawRevision, citations) {
      return repository.transaction(() => {
        const revision = parse(workoutRevisionV2Schema, rawRevision);
        const at = now().toISOString();
        const { profile, checkIn } = readBasis(ownerId, revision.contextReceipt.checkInId, at);
        if (profile.version !== revision.contextReceipt.profileVersion || checkIn.version !== revision.contextReceipt.checkInVersion
          || revision.policyVersion !== FITNESS_PLANNING_POLICY) changed();
        const authorization = { disclosureVersion: revision.contextReceipt.disclosureVersion,
          allowedFields: revision.contextReceipt.allowedFields, selectedFitnessMemoryIds: [] };
        const built = build(ownerId, {
          schemaVersion: 'WORKOUT_PLANNING_V2', goal: revision.goal, scheduling: revision.scheduling,
          checkInId: checkIn.id, expectedCheckInVersion: checkIn.version, expectedProfileVersion: profile.version,
          authorization, candidateCitationIds: revision.contextReceipt.candidateReferences.map((ref) => ref.citationId),
        }, at);
        if (canonical(built.citations) !== canonical(citations)
          || canonical(built.receiptFields.candidateReferences) !== canonical(revision.contextReceipt.candidateReferences)) changed();
        const totalDurationSeconds = revision.items.reduce((total, item) => total
          + item.rounds * (item.durationSeconds ?? item.reps! * item.secondsPerRep!)
          + (item.rounds - 1) * item.restSeconds + item.transitionSeconds, 0);
        try {
          validateWorkoutPlanV2(built.payload, {
            schemaVersion: 'WORKOUT_PLAN_V2', title: revision.title, rationale: revision.rationale, goal: revision.goal,
            items: revision.items, alternatives: revision.alternatives, totalDurationSeconds,
          });
        } catch { throw new ApiError(422, 'WORKOUT_PLAN_INVALID', '计划不满足当前技术约束'); }
        return built.payload;
      });
    },
  };
}
