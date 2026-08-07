import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandling } from './http/api-error';
import { registerHealthRoutes } from './modules/health/routes';
import { openDatabase } from './storage/database';

export interface AppOptions {
  databasePath?: string;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  });
  const database = openDatabase(options.databasePath ?? ':memory:');

  registerErrorHandling(app);
  app.addHook('onClose', async () => {
    if (database.open) database.close();
  });
  await registerHealthRoutes(app, database);

  return app;
}
