import {
  agentRunListResponseSchema,
  agentRunResponseSchema,
  createAgentRunSchema,
  providerListResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { ProviderService } from './service';

interface ProviderRouteOptions {
  authService: AuthService;
  providerService: ProviderService;
}

export async function registerProviderRoutes(
  app: FastifyInstance,
  options: ProviderRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  app.get('/v1/providers', { preHandler: authGuard }, async () => {
    return providerListResponseSchema.parse({ data: options.providerService.listProfiles() });
  });
  app.get('/v1/agent-runs', { preHandler: authGuard }, async (request) => {
    return agentRunListResponseSchema.parse({
      data: options.providerService.listRuns(authenticatedOwnerId(request)),
    });
  });
  app.post('/v1/agent-runs', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(createAgentRunSchema, request.body, 'Agent Run 请求不符合要求');
    const run = await options.providerService.startRun(authenticatedOwnerId(request), input);
    return reply.status(201).send(agentRunResponseSchema.parse({ data: run }));
  });
}
