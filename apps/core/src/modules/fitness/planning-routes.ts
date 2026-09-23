import * as z from 'zod';
import {
  workoutPlanningProfileV2Schema, workoutPlanningCandidateV2Schema, workoutContextPreviewV2Schema,
  workoutDetailedPlanningCapabilityDescriptorSchema, previewWorkoutContextV2Schema, createDetailedWorkoutV2Schema,
  reviseDetailedWorkoutV2Schema, workoutRevisionV2Schema, workoutSchema, proposalSchema, workoutGoalSchema,
  workoutPathParamsSchema, workoutListQuerySchema, workoutFeedbackSchema, createWorkoutProposalSchema, idempotencyKeySchema,
} from '@ev/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { WorkoutPlanningService } from './planning-service';

const envelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema }).strict();
const profileResponse = envelope(z.object({ profile: workoutPlanningProfileV2Schema.nullable() }).strict());
const { version: _version, ...profileShape } = workoutPlanningProfileV2Schema.shape;
const putProfileSchema = z.object({ expectedVersion: z.number().int().positive().nullable(),
  profile: z.object(profileShape).strict().transform(profile => ({ ...profile, version: 1 }))
    .pipe(workoutPlanningProfileV2Schema).transform(({ version: _v, ...profile }) => profile),
}).strict();
const candidateQuery = z.object({ checkInId: z.uuid(), goal: workoutGoalSchema }).strict();
const candidateResponse = envelope(z.object({ items: z.array(workoutPlanningCandidateV2Schema).max(5) }).strict());
const memoryResponse = envelope(z.object({ items: z.array(z.object({ id: z.uuid(), version: z.number().int().positive(),
  scopeType: z.enum(['FITNESS', 'DOMAIN']), scopeId: z.string(), characters: z.number().int().nonnegative() }).strict()) }).strict());
const resultSchema = z.object({ workout: workoutSchema, revision: workoutRevisionV2Schema }).strict();
const lineage = z.object({ id: z.uuid() }).passthrough().nullable();
const detailResponse = envelope(resultSchema.extend({
  citations: z.array(z.object({ candidate: workoutPlanningCandidateV2Schema, name: z.string(), instructions: z.array(z.string()) }).strict()),
  proposal: proposalSchema.nullable(), action: lineage, timeRequest: lineage, feedback: z.unknown().nullable(),
}).strict());
const feedbackResponse = envelope(z.object({ workout: workoutSchema, feedback: z.unknown(), action: lineage,
  activitySession: z.unknown().nullable(), safetyNotice: z.literal('STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP').nullable(),
  memoryStatus: z.object({ state: z.enum(['RECORDED', 'SKIPPED_HUMAN_EDIT', 'SKIPPED_DELETED', 'REPLAYED', 'DEGRADED']), sourceId: z.string().optional() }).strict(),
}).strict());
const listResponse = envelope(z.object({
  items: z.array(z.object({ workout: workoutSchema, revisionSchema: z.enum(['WORKOUT_PLAN_V1', 'WORKOUT_PLAN_V2']) }).strict()),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().min(1).max(50), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }).strict(),
}).strict());

function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string') throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '命令请求必须提供 Idempotency-Key');
  const parsed = idempotencyKeySchema.safeParse(key);
  if (!parsed.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 格式不正确');
  return parsed.data;
}

export async function registerFitnessPlanningRoutes(app: FastifyInstance, options: {
  authService: AuthService; workoutPlanningService: WorkoutPlanningService;
}): Promise<void> {
  const service = options.workoutPlanningService;
  const preHandler = createAuthGuard(options.authService);
  const read = { preHandler, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const write = { preHandler, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const prefix = '/v1/fitness/planning';
  const pathId = (request: FastifyRequest) => parseRequestInput(workoutPathParamsSchema, request.params, '训练标识无效').id;
  app.get(prefix + '/profile', read, async request => profileResponse.parse({ data: service.getProfile(authenticatedOwnerId(request)) }));
  app.put(prefix + '/profile', write, async request => {
    const input = parseRequestInput(putProfileSchema, request.body, '训练画像无效');
    return profileResponse.parse({ data: service.putProfile(authenticatedOwnerId(request), input) });
  });
  app.get(prefix + '/capability', read, async request => envelope(workoutDetailedPlanningCapabilityDescriptorSchema).parse({ data: service.getCapability(authenticatedOwnerId(request)) }));
  app.get(prefix + '/candidates', read, async request => {
    const query = parseRequestInput(candidateQuery, request.query, '候选查询无效');
    return candidateResponse.parse({ data: service.listCandidates(authenticatedOwnerId(request), query) });
  });
  app.get(prefix + '/memory', read, async request => memoryResponse.parse({ data: service.listMemory(authenticatedOwnerId(request)) }));
  app.post(prefix + '/context/preview', write, async request => {
    const input = parseRequestInput(previewWorkoutContextV2Schema, request.body, '训练预览无效');
    return envelope(workoutContextPreviewV2Schema).parse({ data: service.previewContext(authenticatedOwnerId(request), input) });
  });
  app.post(prefix + '/workouts', write, async (request, reply) => {
    const input = parseRequestInput(createDetailedWorkoutV2Schema, request.body, '训练创建无效');
    const result = await service.createDetailedWorkout(authenticatedOwnerId(request), input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(201).send(envelope(resultSchema.extend({ totalDurationSeconds: z.number().int().positive(), capabilityRunId: z.uuid().nullable() }).strict()).parse({ data: {
      workout: result.workout, revision: result.revision, totalDurationSeconds: result.totalDurationSeconds, capabilityRunId: result.capabilityRunId,
    } }));
  });
  app.get(prefix + '/workouts', read, async request => {
    const query = parseRequestInput(workoutListQuerySchema, request.query, '训练列表查询无效');
    const result = service.listDetailedWorkouts(authenticatedOwnerId(request), { page: query.page, pageSize: query.pageSize,
      ...(query.state === undefined ? {} : { state: query.state }), ...(query.localDate === undefined ? {} : { localDate: query.localDate }) });
    return listResponse.parse({ data: result });
  });
  app.get(prefix + '/workouts/:id', read, async request => detailResponse.parse({ data: service.getDetailedWorkout(authenticatedOwnerId(request), pathId(request)) }));
  app.post(prefix + '/workouts/:id/revisions', write, async (request, reply) => {
    const input = parseRequestInput(reviseDetailedWorkoutV2Schema, request.body, '训练修订无效');
    const result = service.reviseDetailedWorkout(authenticatedOwnerId(request), pathId(request), input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(201).send(envelope(resultSchema).parse({ data: { workout: result.workout, revision: result.revision } }));
  });
  app.post(prefix + '/workouts/:id/proposal', write, async (request, reply) => {
    const input = parseRequestInput(createWorkoutProposalSchema, request.body, '训练提案无效');
    const result = service.createDetailedWorkoutProposal(authenticatedOwnerId(request), pathId(request), input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(201).send(envelope(z.object({ workout: workoutSchema, proposal: proposalSchema }).strict()).parse({ data: { workout: result.workout, proposal: result.proposal } }));
  });
  app.post(prefix + '/workouts/:id/feedback', write, async (request, reply) => {
    const input = parseRequestInput(workoutFeedbackSchema, request.body, '训练反馈无效');
    const result = service.recordDetailedWorkoutFeedback(authenticatedOwnerId(request), pathId(request), input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(201).send(feedbackResponse.parse({ data: { workout: result.workout, feedback: result.feedback, action: result.action,
      activitySession: result.activitySession, safetyNotice: result.safetyNotice, memoryStatus: result.memoryStatus } }));
  });
}
