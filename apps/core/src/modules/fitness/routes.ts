import {
  checkInResponseSchema,
  checkInSchema,
  createFitnessCheckInSchema,
  createWorkoutRevisionSchema,
  createWorkoutSchema,
  exerciseListQuerySchema,
  exerciseListResponseSchema,
  fitnessCheckInListQuerySchema,
  fitnessCheckInListResponseSchema,
  fitnessCheckInResponseSchema,
  idempotencyKeySchema,
  workoutCreateResponseSchema,
  workoutDetailResponseSchema,
  workoutListQuerySchema,
  workoutListResponseSchema,
  workoutPathParamsSchema,
  workoutRevisionResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { FitnessService } from './service';

interface FitnessRouteOptions { authService: AuthService; fitnessService: FitnessService; }

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string') throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '命令请求必须提供 Idempotency-Key');
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 格式不正确');
  return parsed.data;
}

export async function registerFitnessRoutes(app: FastifyInstance, options: FitnessRouteOptions): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  app.post('/v1/check-ins', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(checkInSchema, request.body, '身体状态输入不符合要求');
    const result = options.fitnessService.checkIn(authenticatedOwnerId(request), input);
    return reply.status(201).send(checkInResponseSchema.parse({ data: result }));
  });
  app.post('/v1/fitness/check-ins', { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parseRequestInput(createFitnessCheckInSchema, request.body, '训练状态输入不符合要求');
    const result = options.fitnessService.checkInV2(authenticatedOwnerId(request), input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    const data = { checkIn: result.checkIn, signal: result.signal };
    return reply.status(201).send(fitnessCheckInResponseSchema.parse({ data }));
  });
  app.get('/v1/fitness/check-ins', { preHandler: authGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = parseRequestInput(fitnessCheckInListQuerySchema, request.query, '训练状态查询不符合要求');
    const result = options.fitnessService.listCheckIns(authenticatedOwnerId(request), {
      page: query.page, pageSize: query.pageSize,
      ...(query.localDate === undefined ? {} : { localDate: query.localDate }),
      ...(query.eligibility === undefined ? {} : { eligibility: query.eligibility }),
    });
    return reply.send(fitnessCheckInListResponseSchema.parse({ data: result }));
  });
  app.get('/v1/fitness/exercises', { preHandler: authGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = parseRequestInput(exerciseListQuerySchema, request.query, '训练目录查询不符合要求');
    const result = options.fitnessService.listExercises(authenticatedOwnerId(request), {
      checkInId: query.checkInId, page: query.page, pageSize: query.pageSize,
      ...(query.query === undefined ? {} : { query: query.query }),
      ...(query.goal === undefined ? {} : { goal: query.goal }),
      ...(query.equipment === undefined ? {} : { equipment: query.equipment }),
    });
    return reply.send(exerciseListResponseSchema.parse({ data: result }));
  });
  app.post('/v1/fitness/workouts', { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parseRequestInput(createWorkoutSchema, request.body, '训练草稿输入不符合要求');
    const result = await options.fitnessService.createWorkout(authenticatedOwnerId(request), input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    const data = { workout: result.workout, revision: result.revision, disclosure: result.disclosure };
    return reply.status(201).send(workoutCreateResponseSchema.parse({ data }));
  });
  app.post('/v1/fitness/workouts/:id/revisions', { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseRequestInput(workoutPathParamsSchema, request.params, '训练草稿标识不符合要求');
    const input = parseRequestInput(createWorkoutRevisionSchema, request.body, '训练修订输入不符合要求');
    const result = options.fitnessService.reviseWorkout(authenticatedOwnerId(request), id, input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    const data = { workout: result.workout, revision: result.revision };
    return reply.status(201).send(workoutRevisionResponseSchema.parse({ data }));
  });
  app.get('/v1/fitness/workouts', { preHandler: authGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = parseRequestInput(workoutListQuerySchema, request.query, '训练草稿查询不符合要求');
    const result = options.fitnessService.listWorkouts(authenticatedOwnerId(request), {
      page: query.page, pageSize: query.pageSize,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(query.localDate === undefined ? {} : { localDate: query.localDate }),
    });
    return reply.send(workoutListResponseSchema.parse({ data: result }));
  });
  app.get('/v1/fitness/workouts/:id', { preHandler: authGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseRequestInput(workoutPathParamsSchema, request.params, '训练草稿标识不符合要求');
    const result = options.fitnessService.getWorkout(authenticatedOwnerId(request), id);
    return reply.send(workoutDetailResponseSchema.parse({ data: result }));
  });
}
