import { apiErrorSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown | undefined;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send(
      apiErrorSchema.parse({
        error: {
          code: 'NOT_FOUND',
          message: '请求的资源不存在',
        },
      }),
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      const details = error.details === undefined ? {} : { details: error.details };
      return reply.status(error.statusCode).send(
        apiErrorSchema.parse({
          error: {
            code: error.code,
            message: error.message,
            ...details,
          },
        }),
      );
    }

    request.log.error({ error }, 'Unhandled Core request error');
    return reply.status(500).send(
      apiErrorSchema.parse({
        error: {
          code: 'INTERNAL_ERROR',
          message: '本地服务暂时无法完成请求',
        },
      }),
    );
  });
}
