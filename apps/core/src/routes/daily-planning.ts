import {
  dailyPlanGenerationInputSchema,
  dailyPlanProposalResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../http/api-error';
import { parseRequestInput } from '../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../modules/auth/guard';
import type { AuthService } from '../modules/auth/service';
import {
  DailyPlanBaseVersionStaleError,
} from '../modules/daily-planning/repository';
import {
  DailyPlanGenerationError,
  type DailyPlanningService,
} from '../modules/daily-planning/service';

interface DailyPlanningRouteOptions {
  authService: AuthService;
  dailyPlanningService: DailyPlanningService;
}

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
}
