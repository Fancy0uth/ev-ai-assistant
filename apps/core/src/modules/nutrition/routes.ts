import { createMealSchema, mealRecordResponseSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { NutritionService } from './service';

interface NutritionRouteOptions {
  authService: AuthService;
  nutritionService: NutritionService;
}

export async function registerNutritionRoutes(
  app: FastifyInstance,
  options: NutritionRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  app.post('/v1/meals', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(createMealSchema, request.body, '确认后的饮食记录不符合要求');
    const record = options.nutritionService.createConfirmedMeal(authenticatedOwnerId(request), input);
    return reply.status(201).send(mealRecordResponseSchema.parse({ data: record }));
  });
}
