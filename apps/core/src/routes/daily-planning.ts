import {
  dailyPlanDecisionBatchInputSchema,
  dailyPlanGenerationInputSchema,
  dailyPlanProposalListQuerySchema,
  dailyPlanProposalResponseSchema,
  dailyPlanReviewExplanationResponseSchema,
  dailyPlanReviewListResponseSchema,
  dailyPlanReviewResponseSchema,
  dailyPlanReviewSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import { ApiError } from '../http/api-error';
import { parseRequestInput } from '../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../modules/auth/guard';
import type { AuthService } from '../modules/auth/service';
import {
  DailyPlanBaseVersionStaleError,
  DailyPlanReviewBaseVersionStaleError,
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
import { DailyPlanValidationError } from '../modules/daily-planning/validator';

interface DailyPlanningRouteOptions {
  authService: AuthService;
  dailyPlanningService: DailyPlanningService;
  dailyPlanReviewService: DailyPlanReviewService;
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
  if (!(error instanceof DailyPlanGenerationError)) {
    throw error;
  }

  switch (error.code) {
    case 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED':
      throw new ApiError(409, error.code, '尚未配置每日计划 Provider 凭据');
    case 'DAILY_PLAN_PROVIDER_UNAVAILABLE':
      throw new ApiError(503, error.code, '每日计划 Provider 暂不可用');
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
  if (error instanceof DailyPlanReviewBaseVersionStaleError) {
    throw new ApiError(409, 'DAILY_PLAN_BASE_VERSION_STALE', '日程已变化，草案已失效，请刷新后重试', {
      currentReview: dailyPlanReviewSchema.parse(error.review),
    });
  }
  if (error instanceof DailyPlanValidationError) {
    throw new ApiError(422, 'DAILY_PLAN_VALIDATION_FAILED', '每日计划决策未通过本地校验');
  }
  throw error;
}

export async function registerDailyPlanningRoutes(
  app: FastifyInstance,
  options: DailyPlanningRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);

  app.post('/v1/daily-plans/generate', { preHandler: authGuard }, async (request, reply) => {
    const ownerId = authenticatedOwnerId(request);
    const input = parseRequestInput(
      dailyPlanGenerationInputSchema,
      request.body,
      '每日计划生成请求不符合要求',
    );

    try {
      const proposal = await options.dailyPlanningService.generateDailyPlan({
        ownerId,
        localDate: input.localDate,
        trigger: 'MANUAL',
      });
      return reply.status(201).send(dailyPlanProposalResponseSchema.parse({ data: proposal }));
    } catch (error) {
      return rethrowGenerationError(error);
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

  app.post('/v1/daily-plans/proposals/:proposalId/decisions', { preHandler: authGuard }, (request) => {
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

    try {
      return dailyPlanReviewResponseSchema.parse({
        data: options.dailyPlanReviewService.submitDecisions(ownerId, proposalId, input),
      });
    } catch (error) {
      return rethrowReviewError(error);
    }
  });
}
