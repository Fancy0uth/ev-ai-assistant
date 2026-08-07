import { healthResponseSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/health/live', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'ev-core',
      version: '0.1.0',
    });
  });
}
