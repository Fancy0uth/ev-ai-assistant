import { checkInResponseSchema, checkInSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { FitnessService } from './service';

interface FitnessRouteOptions {
  authService: AuthService;
  fitnessService: FitnessService;
}

export async function registerFitnessRoutes(
  app: FastifyInstance,
  options: FitnessRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  app.post('/v1/check-ins', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(checkInSchema, request.body, '身体状态输入不符合要求');
    const result = options.fitnessService.checkIn(authenticatedOwnerId(request), input);
    return reply.status(201).send(checkInResponseSchema.parse({ data: result }));
  });
}
