import {
  eventLanguageParseInputSchema,
  eventLanguageParseResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { EventLanguageService } from './event-language';

export interface EventLanguageRouteOptions {
  authService: AuthService;
  eventLanguageService: EventLanguageService;
}

export async function registerEventLanguageRoutes(
  app: FastifyInstance,
  options: EventLanguageRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);

  app.post('/v1/event-language/parse', {
    preHandler: authGuard,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request) => {
    const input = parseRequestInput(
      eventLanguageParseInputSchema,
      request.body,
      '自然语言日程解析请求不符合要求',
    );
    const result = await options.eventLanguageService.parse(authenticatedOwnerId(request), input);
    return eventLanguageParseResponseSchema.parse({ data: result });
  });
}
