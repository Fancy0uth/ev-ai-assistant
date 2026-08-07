import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandling } from './http/api-error';
import { registerHealthRoutes } from './modules/health/routes';

export interface AppOptions {
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  registerErrorHandling(app);
  await app.register(registerHealthRoutes);

  return app;
}
