import {
  createEventProposalInputSchema,
  createTermSchema,
  eventPathParamsSchema,
  eventResponseSchema,
  proposalResponseSchema,
  termListResponseSchema,
  termResponseSchema,
} from '@ev/contracts';
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
    const ownerId = authenticatedOwnerId(request);
    const input = parseRequestInput(createTermSchema, request.body, '学期信息不符合要求');
    const term = options.calendarService.createTerm(ownerId, input);
    return reply.status(201).send(termResponseSchema.parse({ data: term }));
  });

  app.get('/v1/terms', { preHandler: authGuard }, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    const terms = options.calendarService.listTerms(ownerId);
    return termListResponseSchema.parse({ data: terms });
  });

  app.post('/v1/event-proposals', { preHandler: authGuard }, (request, reply) => {
    const ownerId = authenticatedOwnerId(request);
    const input = parseRequestInput(
      createEventProposalInputSchema,
      request.body,
      '日程提案请求不符合要求',
    );
    const proposal = options.calendarService.createEventProposal(ownerId, input);
    return reply.status(201).send(proposalResponseSchema.parse({ data: proposal }));
  });

  app.get('/v1/events/:id', { preHandler: authGuard }, (request) => {
    const ownerId = authenticatedOwnerId(request);
    const { id } = parseRequestInput(eventPathParamsSchema, request.params, '日程路径参数不符合要求');
    const event = options.calendarService.getEvent(ownerId, id);
    return eventResponseSchema.parse({ data: event });
  });
}
