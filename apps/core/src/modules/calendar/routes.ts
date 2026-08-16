import { createTermSchema, termListResponseSchema, termResponseSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { CalendarService } from './service';

interface CalendarRouteOptions {
  authService: AuthService;
  calendarService: CalendarService;
}

export async function registerCalendarRoutes(
  app: FastifyInstance,
  options: CalendarRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);

  app.post('/v1/terms', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(createTermSchema, request.body, '学期信息不符合要求');
    const term = options.calendarService.createTerm(authenticatedOwnerId(request), input);
    return reply.status(201).send(termResponseSchema.parse({ data: term }));
  });

  app.get('/v1/terms', { preHandler: authGuard }, async (request) => {
    const terms = options.calendarService.listTerms(authenticatedOwnerId(request));
    return termListResponseSchema.parse({ data: terms });
  });
}
