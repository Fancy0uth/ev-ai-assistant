import {
  apiErrorSchema,
  dailyPlanDecisionBatchInputSchema,
  dailyPlanPreflightApproveInputSchema,
  dailyPlanPreflightGenerateInputSchema,
  dailyPlanPreflightPathParamsSchema,
  dailyPlanPreflightPrepareInputSchema,
  dailyPlanPreflightResponseSchema,
  dailyPlanProposalListQuerySchema,
  dailyPlanProposalResponseSchema,
  dailyPlanReviewExplanationResponseSchema,
  dailyPlanReviewListResponseSchema,
  dailyPlanReviewResponseSchema,
  dailyPlanReviewSchema,
  idempotencyKeySchema,
} from '@ev/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod';
import { ApiError } from '../http/api-error';
import { parseRequestInput } from '../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../modules/auth/guard';
import type { AuthService } from '../modules/auth/service';
import {
  DailyPlanBaseVersionStaleError,
} from '../modules/daily-planning/repository';
import {
  DailyPlanProposalNotFoundError,
  DailyPlanProposalVersionConflictError,
  type DailyPlanReviewService,
} from '../modules/daily-planning/review-service';
import {
  DailyPlanGenerationError,
  type DailyPlanningService,
} from '../modules/daily-planning/service';
import {
  DailyPlanPreflightError,
  type DailyPlanPreflightService,
} from '../modules/daily-planning/preflight-service';
import { DailyPlanValidationError } from '../modules/daily-planning/validator';
import {
  IdempotencyConflictError,
  type IdempotencyClaim,
  type IdempotencyService,
} from '../modules/providers/idempotency-service';

interface DailyPlanningRouteOptions {
  authService: AuthService;
  dailyPlanningService: DailyPlanningService;
  dailyPlanPreflightService: Pick<DailyPlanPreflightService, 'prepare' | 'approve'>;
  dailyPlanReviewService: DailyPlanReviewService;
  idempotencyService: IdempotencyService;
}

const dailyPlanProposalPathParamsSchema = z
  .object({
    proposalId: z.uuid(),
  })
  .strict();

function rethrowGenerationError(error: unknown): never {
  if (error instanceof DailyPlanBaseVersionStaleError) {
    throw new ApiError(409, 'DAILY_PLAN_BASE_VERSION_STALE', '日程已变化，请重新生成计划');
  }
  if (error instanceof DailyPlanPreflightError) {
    switch (error.code) {
      case 'DAILY_PLAN_PREFLIGHT_NOT_FOUND':
        throw new ApiError(404, error.code, '每日计划上下文不存在');
      case 'DAILY_PLAN_PREFLIGHT_VERSION_CONFLICT':
        throw new ApiError(409, error.code, '每日计划上下文已更新，请刷新后重试');
      case 'DAILY_PLAN_PREFLIGHT_NOT_APPROVABLE':
        throw new ApiError(409, error.code, '每日计划上下文当前不能批准');
      case 'DAILY_PLAN_PREFLIGHT_NOT_APPROVED':
        throw new ApiError(409, error.code, '每日计划上下文尚未批准');
      case 'DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH':
        throw new ApiError(409, error.code, '每日计划上下文与批准内容不一致');
    }
  }
  if (!(error instanceof DailyPlanGenerationError)) {
    throw error;
  }

  switch (error.code) {
    case 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED':
      throw new ApiError(409, error.code, '尚未配置每日计划 Provider 凭据');
    case 'DAILY_PLAN_PROVIDER_UNAVAILABLE':
      throw new ApiError(503, error.code, '每日计划 Provider 暂不可用');
    case 'DAILY_PLAN_PROVIDER_TIMEOUT':
      throw new ApiError(503, error.code, '每日计划 Provider 请求超时');
    case 'DAILY_PLAN_PROVIDER_QUOTA_EXCEEDED':
      throw new ApiError(429, error.code, '每日计划 Provider 配额已用尽，请稍后重试');
    case 'DAILY_PLAN_PROVIDER_RESPONSE_REJECTED':
      throw new ApiError(422, error.code, '每日计划 Provider 返回内容未通过完整性策略');
    case 'DAILY_PLAN_MODEL_OUTPUT_INVALID':
      throw new ApiError(422, error.code, '每日计划 Provider 返回结果不符合要求');
    case 'DAILY_PLAN_VALIDATION_FAILED':
      throw new ApiError(422, error.code, '每日计划建议未通过本地校验');
    default:
      throw error;
  }
}

function rethrowReviewError(error: unknown): never {
  if (error instanceof DailyPlanProposalNotFoundError) {
    throw new ApiError(404, error.code, '每日计划草案不存在');
  }
  if (error instanceof DailyPlanProposalVersionConflictError) {
    throw new ApiError(409, error.code, '每日计划草案已更新，请刷新后重试', {
      currentReview: dailyPlanReviewSchema.parse(error.review),
    });
  }
  if (error instanceof DailyPlanValidationError) {
    throw new ApiError(422, 'DAILY_PLAN_VALIDATION_FAILED', '每日计划决策未通过本地校验');
  }
  throw error;
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
  if (!parsed.success) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 格式无效');
  }
  return parsed.data;
}

function apiErrorBody(error: ApiError): unknown {
  return apiErrorSchema.parse({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  });
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

function toGenerationApiError(error: unknown): ApiError {
  try {
    rethrowGenerationError(error);
  } catch (mapped) {
    if (mapped instanceof ApiError) return mapped;
    throw mapped;
  }
}

export async function registerDailyPlanningRoutes(
  app: FastifyInstance,
  options: DailyPlanningRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);

  app.post('/v1/daily-plans/preflights', { preHandler: authGuard }, (request, reply) => {
    const ownerId = authenticatedOwnerId(request);
    const input = parseRequestInput(
      dailyPlanPreflightPrepareInputSchema,
      request.body,
      '每日计划上下文请求不符合要求',
    );
    try {
      const preflight = options.dailyPlanPreflightService.prepare(ownerId, input.localDate, 'MANUAL');
      return reply.status(201).send(dailyPlanPreflightResponseSchema.parse({ data: preflight }));
    } catch (error) {
      return rethrowGenerationError(error);
    }
  });

  app.post('/v1/daily-plans/preflights/:id/approve', { preHandler: authGuard }, (request) => {
    const ownerId = authenticatedOwnerId(request);
    const { id } = parseRequestInput(
      dailyPlanPreflightPathParamsSchema,
      request.params,
      '每日计划上下文路径参数不符合要求',
    );
    const input = parseRequestInput(
      dailyPlanPreflightApproveInputSchema,
      request.body,
      '每日计划上下文批准请求不符合要求',
    );
    try {
      return dailyPlanPreflightResponseSchema.parse({
        data: options.dailyPlanPreflightService.approve(
          ownerId,
          id,
          input.expectedPreflightVersion,
          input.items,
        ),
      });
    } catch (error) {
      return rethrowGenerationError(error);
    }
  });

  app.post('/v1/daily-plans/generate', { preHandler: authGuard }, async (request, reply) => {
    const ownerId = authenticatedOwnerId(request);
    const input = parseRequestInput(
      dailyPlanPreflightGenerateInputSchema,
      request.body,
      '每日计划生成请求不符合要求',
    );

    let claim: IdempotencyClaim;
    try {
      claim = options.idempotencyService.claim({
        ownerId,
        key: idempotencyKey(request),
        operation: 'daily_plan.generate',
        resourceId: input.preflightId,
        body: input,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, error.code, 'Idempotency-Key 已用于不同语义的操作');
      }
      throw error;
    }
    if (claim.kind !== 'CLAIMED') return sendIdempotencyClaim(reply, claim);

    try {
      const proposal = await options.dailyPlanningService.generateApprovedPreflight({
        ownerId,
        preflightId: input.preflightId,
        expectedPreflightVersion: input.expectedPreflightVersion,
        execution: {
          idempotencyRecordId: claim.recordId,
          leaseToken: claim.leaseToken,
          attemptCount: claim.attemptCount,
          recovered: claim.recovered,
        },
      });
      const body = dailyPlanProposalResponseSchema.parse({ data: proposal });
      if (!options.idempotencyService.complete({ ...claim, status: 201, body })) {
        return sendIdempotencyClaim(reply, {
          kind: 'TERMINAL',
          status: 503,
          body: apiErrorSchema.parse({
            error: {
              code: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
              message: '每日计划生成结果已过期，请重新发起。',
            },
          }),
        });
      }
      return reply.status(201).send(body);
    } catch (error) {
      const mapped = toGenerationApiError(error);
      const body = apiErrorBody(mapped);
      const finalized = options.idempotencyService.fail({
        ...claim,
        status: mapped.statusCode,
        body,
        failureCode: mapped.code,
      });
      if (!finalized) {
        return sendIdempotencyClaim(reply, {
          kind: 'TERMINAL',
          status: 503,
          body: apiErrorSchema.parse({
            error: {
              code: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
              message: '每日计划生成结果已过期，请重新发起。',
            },
          }),
        });
      }
      return reply.status(mapped.statusCode).send(body);
    }
  });

  app.get('/v1/daily-plans/proposals', { preHandler: authGuard }, (request) => {
    const ownerId = authenticatedOwnerId(request);
    const query = parseRequestInput(
      dailyPlanProposalListQuerySchema,
      request.query,
      '每日计划草案查询参数不符合要求',
    );
    return dailyPlanReviewListResponseSchema.parse({
      data: options.dailyPlanReviewService.listProposals(ownerId, {
        page: query.page,
        pageSize: query.pageSize,
        ...(query.localDate === undefined ? {} : { localDate: query.localDate }),
      }),
    });
  });

  app.get('/v1/daily-plans/proposals/:proposalId', { preHandler: authGuard }, (request) => {
    const ownerId = authenticatedOwnerId(request);
    const { proposalId } = parseRequestInput(
      dailyPlanProposalPathParamsSchema,
      request.params,
      '每日计划草案路径参数不符合要求',
    );

    try {
      return dailyPlanReviewResponseSchema.parse({
        data: options.dailyPlanReviewService.getReview(ownerId, proposalId),
      });
    } catch (error) {
      return rethrowReviewError(error);
    }
  });

  app.get('/v1/daily-plans/proposals/:proposalId/explanation', { preHandler: authGuard }, (request) => {
    const ownerId = authenticatedOwnerId(request);
    const { proposalId } = parseRequestInput(
      dailyPlanProposalPathParamsSchema,
      request.params,
      '每日计划草案路径参数不符合要求',
    );

    try {
      return dailyPlanReviewExplanationResponseSchema.parse({
        data: options.dailyPlanReviewService.getExplanation(ownerId, proposalId),
      });
    } catch (error) {
      return rethrowReviewError(error);
    }
  });

  app.post('/v1/daily-plans/proposals/:proposalId/decisions', { preHandler: authGuard }, (request, reply) => {
    const ownerId = authenticatedOwnerId(request);
    const { proposalId } = parseRequestInput(
      dailyPlanProposalPathParamsSchema,
      request.params,
      '每日计划草案路径参数不符合要求',
    );
    const input = parseRequestInput(
      dailyPlanDecisionBatchInputSchema,
      request.body,
      '每日计划草案决定不符合要求',
    );

    let result: ReturnType<IdempotencyService['executeLocal']>;
    try {
      result = options.idempotencyService.executeLocal(
        {
          ownerId,
          key: idempotencyKey(request),
          operation: 'daily_plan.proposal.decision',
          resourceId: proposalId,
          body: input,
        },
        () => {
          try {
            const decision = options.dailyPlanReviewService.submitDecisions(ownerId, proposalId, input);
            if (decision.kind === 'stale') {
              const stale = new ApiError(
                409,
                'DAILY_PLAN_BASE_VERSION_STALE',
                '日程已变化，草案已失效，请刷新后重试',
                { currentReview: dailyPlanReviewSchema.parse(decision.review) },
              );
              return { status: 409, body: apiErrorBody(stale) };
            }
            return {
              status: 200,
              body: dailyPlanReviewResponseSchema.parse({
                data: decision.review,
              }),
            };
          } catch (error) {
            return rethrowReviewError(error);
          }
        },
      );
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, error.code, 'Idempotency-Key 已用于不同语义的操作');
      }
      throw error;
    }
    if ('kind' in result) {
      return sendIdempotencyClaim(reply, result);
    }
    if (result.replayed) reply.header('Idempotency-Replayed', 'true');
    return reply.status(result.status).send(result.body);
  });
}
