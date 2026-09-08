import { dayPathParamsSchema, dayViewResponseSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { DayPlanningService } from './service';

interface DayPlanningRouteOptions {
  authService: AuthService;
  dayPlanningService: DayPlanningService;
}

export async function registerDayPlanningRoutes(
  app: FastifyInstance,
  options: DayPlanningRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  app.get('/v1/days/:date', { preHandler: authGuard }, async (request) => {
    const { date } = parseRequestInput(
      dayPathParamsSchema,
      request.params,
      '日期路径参数不符合要求',
    );
    const day = options.dayPlanningService.getDay(authenticatedOwnerId(request), date);
    return dayViewResponseSchema.parse({ data: day });
  });
}
