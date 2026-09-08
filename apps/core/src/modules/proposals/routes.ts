import {
  apiErrorSchema,
  idempotencyKeySchema,
  proposalDecisionSchema,
  proposalListQuerySchema,
  proposalListResponseSchema,
  proposalPathParamsSchema,
  proposalResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { ProposalService } from './service';
import {
  IdempotencyConflictError,
  type IdempotencyClaim,
  type IdempotencyService,
} from '../providers/idempotency-service';

interface ProposalRouteOptions {
  authService: AuthService;
  proposalService: ProposalService;
  idempotencyService: IdempotencyService;
}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (value === undefined) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '高影响操作需要 Idempotency-Key');
  }
  if (typeof value !== 'string') {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 格式无效');
  }
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 格式无效');
  return parsed.data;
}

function sendIdempotencyClaim(reply: FastifyReply, claim: Exclude<IdempotencyClaim, { kind: 'CLAIMED' }>) {
  switch (claim.kind) {
    case 'REPLAY':
      return reply.header('Idempotency-Replayed', 'true').status(claim.status).send(claim.body);
    case 'IN_PROGRESS':
      return reply
        .header('Retry-After', '1')
        .status(409)
        .send(apiErrorSchema.parse({ error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: '相同操作仍在执行' } }));
    case 'TERMINAL':
      return reply.status(claim.status).send(claim.body);
  }
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

  app.post('/v1/proposals/:id/decision', { preHandler: authGuard }, async (request, reply) => {
    const ownerId = authenticatedOwnerId(request);
    const { id } = parseRequestInput(
      proposalPathParamsSchema,
      request.params,
      '提案路径参数不符合要求',
    );
    const input = parseRequestInput(proposalDecisionSchema, request.body, '提案决定不符合要求');
    let result: ReturnType<IdempotencyService['executeLocal']>;
    try {
      result = options.idempotencyService.executeLocal(
        {
          ownerId,
          key: idempotencyKey(request),
          operation: 'proposal.decision',
          resourceId: id,
          body: input,
        },
        () => ({
          status: 200,
          body: proposalResponseSchema.parse({ data: options.proposalService.decide(ownerId, id, input) }),
        }),
      );
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, error.code, 'Idempotency-Key 已用于不同语义的操作');
      }
      throw error;
    }
    if ('kind' in result) return sendIdempotencyClaim(reply, result);
    if (result.replayed) reply.header('Idempotency-Replayed', 'true');
    return reply.status(result.status).send(result.body);
  });
}
