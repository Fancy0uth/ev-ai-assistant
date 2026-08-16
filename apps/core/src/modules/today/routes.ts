import { todayQuerySchema, todaySnapshotSchema } from '@ev/contracts';
import { calculateDailyStatus } from '@ev/domain';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { CalendarRepository } from '../calendar/repository';
import type { ProposalService } from '../proposals/service';
import type { TaskService } from '../tasks/service';

interface TodayRouteOptions {
  authService: AuthService;
  taskService: TaskService;
  calendarRepository: CalendarRepository;
  proposalService: ProposalService;
}

export async function registerTodayRoutes(
  app: FastifyInstance,
  options: TodayRouteOptions,
): Promise<void> {
  const { authService, taskService, calendarRepository, proposalService } = options;
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
        agents: {
          deepSeek: 'NOT_CONFIGURED',
          codex: 'NOT_CONFIGURED',
        },
      },
    });
  });
}
