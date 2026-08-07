import { healthResponseSchema, readinessResponseSchema } from '@ev/contracts';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(
  app: FastifyInstance,
  database: Database.Database,
): Promise<void> {
  app.get('/v1/health/live', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'ev-core',
      version: '0.1.0',
    });
  });

  app.get('/v1/health/ready', async (_request, reply) => {
    try {
      database.prepare('select 1').get();
      return readinessResponseSchema.parse({
        status: 'ready',
        checks: { database: 'up' },
      });
    } catch {
      return reply.status(503).send(
        readinessResponseSchema.parse({
          status: 'not_ready',
          checks: { database: 'down' },
        }),
      );
    }
  });
}
