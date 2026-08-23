import {
  proposalDecisionSchema,
  proposalListQuerySchema,
  proposalListResponseSchema,
  proposalPathParamsSchema,
  proposalResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { ProposalService } from './service';

interface ProposalRouteOptions {
  authService: AuthService;
  proposalService: ProposalService;
}

export async function registerProposalRoutes(
  app: FastifyInstance,
  options: ProposalRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);

  app.get('/v1/proposals', { preHandler: authGuard }, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    parseRequestInput(proposalListQuerySchema, request.query, '提案查询参数不符合要求');
    const proposals = options.proposalService.listPending(ownerId);
    return proposalListResponseSchema.parse({ data: proposals });
  });

  app.get('/v1/proposals/:id', { preHandler: authGuard }, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    const { id } = parseRequestInput(
      proposalPathParamsSchema,
      request.params,
      '提案路径参数不符合要求',
    );
    const proposal = options.proposalService.findById(ownerId, id);
    return proposalResponseSchema.parse({ data: proposal });
  });

  app.post('/v1/proposals/:id/decision', { preHandler: authGuard }, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    const { id } = parseRequestInput(
      proposalPathParamsSchema,
      request.params,
      '提案路径参数不符合要求',
    );
    const input = parseRequestInput(proposalDecisionSchema, request.body, '提案决定不符合要求');
    const proposal = options.proposalService.decide(ownerId, id, input);
    return proposalResponseSchema.parse({ data: proposal });
  });
}
