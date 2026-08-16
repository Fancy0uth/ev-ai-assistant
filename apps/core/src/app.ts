import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ApiError, registerErrorHandling } from './http/api-error';
import { createAgentRepository } from './modules/agent/repository';
import { registerAgentRoutes } from './modules/agent/routes';
import { createAgentService } from './modules/agent/service';
import { createAuthRepository } from './modules/auth/repository';
import { registerAuthRoutes } from './modules/auth/routes';
import { createAuthService } from './modules/auth/service';
import { createCalendarRepository } from './modules/calendar/repository';
import { registerDayPlanningRoutes } from './modules/day-planning/routes';
import { createDayPlanningService } from './modules/day-planning/service';
import { registerHealthRoutes } from './modules/health/routes';
import { createProposalRepository } from './modules/proposals/repository';
import { registerProposalRoutes } from './modules/proposals/routes';
import { createProposalService } from './modules/proposals/service';
import { createTaskRepository } from './modules/tasks/repository';
import { registerTaskRoutes } from './modules/tasks/routes';
import { createTaskService } from './modules/tasks/service';
import { registerTodayRoutes } from './modules/today/routes';
import { openDatabase } from './storage/database';
import type { AgentProvider } from './modules/agent/provider';

export interface AppOptions {
  agentProvider?: AgentProvider;
  databasePath?: string;
  logger?: boolean;
  secureCookies?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  });
  const database = openDatabase(options.databasePath ?? ':memory:');

  registerErrorHandling(app);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试'),
  });
  app.decorateRequest('owner', null);
  app.addHook('onClose', async () => {
    if (database.open) database.close();
  });
  const authService = await createAuthService(createAuthRepository(database));
  const agentService = createAgentService(
    createAgentRepository(database),
    options.agentProvider ? { provider: options.agentProvider } : {},
  );
  const taskService = createTaskService(createTaskRepository(database));
  const calendarRepository = createCalendarRepository(database);
  const proposalService = createProposalService(
    createProposalRepository(database),
    calendarRepository,
  );
  const dayPlanningService = createDayPlanningService(
    calendarRepository,
    taskService,
    proposalService,
  );
  await registerHealthRoutes(app, database);
  await registerAuthRoutes(app, {
    authService,
    secureCookies: options.secureCookies ?? false,
  });
  await registerAgentRoutes(app, {
    authService,
    agentService,
    ...(options.agentProvider ? { agentProvider: options.agentProvider } : {}),
  });
  await registerTaskRoutes(app, { authService, taskService });
  await registerProposalRoutes(app, { authService, proposalService });
  await registerDayPlanningRoutes(app, { authService, dayPlanningService });
  await registerTodayRoutes(app, { authService, taskService });

  return app;
}
