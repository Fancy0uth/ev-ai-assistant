import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ApiError, registerErrorHandling } from './http/api-error';
import { createAuthRepository } from './modules/auth/repository';
import { registerAuthRoutes } from './modules/auth/routes';
import { createAuthService } from './modules/auth/service';
import { registerHealthRoutes } from './modules/health/routes';
import { createTaskRepository } from './modules/tasks/repository';
import { registerTaskRoutes } from './modules/tasks/routes';
import { createTaskService } from './modules/tasks/service';
import { registerTodayRoutes } from './modules/today/routes';
import { openDatabase } from './storage/database';

export interface AppOptions {
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
  const taskService = createTaskService(createTaskRepository(database));
  await registerHealthRoutes(app, database);
  await registerAuthRoutes(app, {
    authService,
    secureCookies: options.secureCookies ?? false,
  });
  await registerTaskRoutes(app, { authService, taskService });
  await registerTodayRoutes(app, { authService, taskService });

  return app;
}
