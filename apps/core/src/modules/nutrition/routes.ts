import {
  confirmMealDraftSchema,
  createMealDraftSchema,
  createMealSchema,
  idempotencyKeySchema,
  matchMealDraftSchema,
  mealConfirmResponseSchema,
  mealDraftCreateResponseSchema,
  mealDraftDetailResponseSchema,
  mealDraftListQuerySchema,
  mealDraftListResponseSchema,
  mealDraftMatchResponseSchema,
  mealDraftPathParamsSchema,
  mealDraftRevisionResponseSchema,
  mealPathParamsSchema,
  mealRecordResponseSchema,
  mealV2ListQuerySchema,
  mealV2ListResponseSchema,
  mealV2ResponseSchema,
  reviseMealDraftSchema,
} from '@ev/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { NutritionService } from './service';

interface NutritionRouteOptions { authService: AuthService; nutritionService: NutritionService; }

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string') throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '命令请求必须提供 Idempotency-Key');
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 格式不正确');
  return parsed.data;
}

export async function registerNutritionRoutes(app: FastifyInstance, options: NutritionRouteOptions): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  app.post('/v1/meals', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(createMealSchema, request.body, '确认后的饮食记录不符合要求');
    const record = options.nutritionService.createConfirmedMeal(authenticatedOwnerId(request), input);
    return reply.status(201).send(mealRecordResponseSchema.parse({ data: record }));
  });
  app.post('/v1/nutrition/meal-drafts', { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parseRequestInput(createMealDraftSchema, request.body, '餐食草稿输入不符合要求');
    const result = await options.nutritionService.createMealDraft(authenticatedOwnerId(request), input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(201).send(mealDraftCreateResponseSchema.parse({ data: { draft: result.draft, revision: result.revision, disclosure: result.disclosure } }));
  });
  app.get('/v1/nutrition/meal-drafts', { preHandler: authGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = parseRequestInput(mealDraftListQuerySchema, request.query, '餐食草稿查询不符合要求');
    const result = options.nutritionService.listMealDrafts(authenticatedOwnerId(request), {
      page: query.page, pageSize: query.pageSize,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(query.localDate === undefined ? {} : { localDate: query.localDate }),
    });
    return reply.send(mealDraftListResponseSchema.parse({ data: result }));
  });
  app.get('/v1/nutrition/meal-drafts/:id', { preHandler: authGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseRequestInput(mealDraftPathParamsSchema, request.params, '餐食草稿标识不符合要求');
    const result = options.nutritionService.getMealDraft(authenticatedOwnerId(request), id);
    return reply.send(mealDraftDetailResponseSchema.parse({ data: result }));
  });
  app.post('/v1/nutrition/meal-drafts/:id/revisions', { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseRequestInput(mealDraftPathParamsSchema, request.params, '餐食草稿标识不符合要求');
    const input = parseRequestInput(reviseMealDraftSchema, request.body, '餐食草稿修订输入不符合要求');
    const result = options.nutritionService.reviseMealDraft(authenticatedOwnerId(request), id, input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(201).send(mealDraftRevisionResponseSchema.parse({ data: { draft: result.draft, revision: result.revision } }));
  });
  app.post('/v1/nutrition/meal-drafts/:id/matches', { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseRequestInput(mealDraftPathParamsSchema, request.params, '餐食草稿标识不符合要求');
    const input = parseRequestInput(matchMealDraftSchema, request.body, '餐食匹配输入不符合要求');
    const result = await options.nutritionService.matchMealDraft(authenticatedOwnerId(request), id, input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(202).send(mealDraftMatchResponseSchema.parse({ data: { draft: result.draft, revision: result.revision, matches: result.matches, source: result.source } }));
  });
  app.post('/v1/nutrition/meal-drafts/:id/confirm', { preHandler: authGuard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseRequestInput(mealDraftPathParamsSchema, request.params, '餐食草稿标识不符合要求');
    const input = parseRequestInput(confirmMealDraftSchema, request.body, '餐食确认输入不符合要求');
    const result = options.nutritionService.confirmMealDraft(authenticatedOwnerId(request), id, input, idempotencyKey(request));
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return reply.status(201).send(mealConfirmResponseSchema.parse({ data: { draft: result.draft, meal: result.meal } }));
  });
  app.get('/v1/nutrition/meals', { preHandler: authGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = parseRequestInput(mealV2ListQuerySchema, request.query, '餐食查询不符合要求');
    const result = options.nutritionService.listMealsV2(authenticatedOwnerId(request), {
      page: query.page, pageSize: query.pageSize,
      ...(query.localDate === undefined ? {} : { localDate: query.localDate }),
    });
    return reply.send(mealV2ListResponseSchema.parse({ data: result }));
  });
  app.get('/v1/nutrition/meals/:id', { preHandler: authGuard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = parseRequestInput(mealPathParamsSchema, request.params, '餐食标识不符合要求');
    const meal = options.nutritionService.getMealV2(authenticatedOwnerId(request), id);
    return reply.send(mealV2ResponseSchema.parse({ data: meal }));
  });
}
