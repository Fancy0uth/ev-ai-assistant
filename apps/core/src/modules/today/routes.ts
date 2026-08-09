import { todayQuerySchema, todaySnapshotSchema } from '@ev/contracts';
import { calculateDailyStatus } from '@ev/domain';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { TaskService } from '../tasks/service';

interface TodayRouteOptions {
  authService: AuthService;
  taskService: TaskService;
}

export async function registerTodayRoutes(
  app: FastifyInstance,
  options: TodayRouteOptions,
): Promise<void> {
  const { authService, taskService } = options;
  const authGuard = createAuthGuard(authService);

  app.get('/v1/today', { preHandler: authGuard }, async (request) => {
    const { date } = parseRequestInput(
      todayQuerySchema,
      request.query,
      'Today 查询日期不符合要求',
    );
    const tasks = taskService.listForDate(authenticatedOwnerId(request), date);
    const yesterday = null;
    const status = calculateDailyStatus({ tasks, yesterday });

    return todaySnapshotSchema.parse({
      data: {
        date,
        status,
        tasks,
        yesterday,
        agents: {
          deepSeek: 'NOT_CONFIGURED',
          codex: 'NOT_CONFIGURED',
        },
      },
    });
  });
}
