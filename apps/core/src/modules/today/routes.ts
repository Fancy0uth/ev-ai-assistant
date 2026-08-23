import {
  todayQuerySchema,
  todaySnapshotSchema,
  type TodayDailyPlanSummary,
} from '@ev/contracts';
import { calculateDailyStatus } from '@ev/domain';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { CalendarRepository } from '../calendar/repository';
import type { DailyPlanReviewService } from '../daily-planning/review-service';
import type { ProposalService } from '../proposals/service';
import type { ProviderCredentialService } from '../providers/credential-service';
import type { TaskService } from '../tasks/service';

interface TodayRouteOptions {
  authService: AuthService;
  taskService: TaskService;
  calendarRepository: CalendarRepository;
  proposalService: ProposalService;
  dailyPlanReviewService: DailyPlanReviewService;
  providerCredentialService: ProviderCredentialService;
}

function dailyPlanSummary(
  ownerId: string,
  date: string,
  dailyPlanReviewService: DailyPlanReviewService,
  providerCredentialService: ProviderCredentialService,
): TodayDailyPlanSummary {
  const latest = dailyPlanReviewService.listProposals(ownerId, {
    localDate: date,
    page: 1,
    pageSize: 1,
  }).items[0];

  if (!latest) {
    return providerCredentialService.getMetadata(ownerId).state === 'CONFIGURED'
      ? { status: 'READY_TO_GENERATE', proposalId: null, pendingItemCount: 0 }
      : { status: 'NOT_CONFIGURED', proposalId: null, pendingItemCount: 0 };
  }

  switch (latest.proposal.status) {
    case 'PENDING_REVIEW':
    case 'PARTIALLY_APPLIED':
      return {
        status: latest.proposal.status,
        proposalId: latest.proposal.id,
        pendingItemCount: latest.proposal.items.filter((item) => item.status === 'PENDING_REVIEW').length,
      };
    case 'APPLIED':
    case 'REJECTED':
    case 'STALE':
      return {
        status: latest.proposal.status,
        proposalId: latest.proposal.id,
        pendingItemCount: 0,
      };
  }
}

export async function registerTodayRoutes(
  app: FastifyInstance,
  options: TodayRouteOptions,
): Promise<void> {
  const {
    authService,
    taskService,
    calendarRepository,
    proposalService,
    dailyPlanReviewService,
    providerCredentialService,
  } = options;
  const authGuard = createAuthGuard(authService);

  app.get('/v1/today', { preHandler: authGuard }, async (request) => {
    const { date } = parseRequestInput(
      todayQuerySchema,
      request.query,
      'Today 查询日期不符合要求',
    );
    const ownerId = authenticatedOwnerId(request);
    const tasks = taskService.listForDate(ownerId, date);
    const yesterday = null;
    const status = calculateDailyStatus({ tasks, yesterday });

    return todaySnapshotSchema.parse({
      data: {
        date,
        status,
        tasks,
        events: calendarRepository.listEventsForDate(ownerId, date),
        signals: calendarRepository.listSignalsForDate(ownerId, date),
        pendingProposals: proposalService.listPending(ownerId),
        yesterday,
        dailyPlan: dailyPlanSummary(
          ownerId,
          date,
          dailyPlanReviewService,
          providerCredentialService,
        ),
        agents: {
          deepSeek: 'NOT_CONFIGURED',
          codex: 'NOT_CONFIGURED',
        },
      },
    });
  });
}
