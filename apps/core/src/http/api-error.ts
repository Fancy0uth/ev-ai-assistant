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
    const fastifyCode = (error as { code?: string }).code;
    if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send(apiErrorSchema.parse({
        error: { code: 'IMAGE_TOO_LARGE', message: '课表截图不能超过 5 MB' },
      }));
    }
    if (fastifyCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.status(415).send(apiErrorSchema.parse({
        error: { code: 'UNSUPPORTED_IMAGE_TYPE', message: '仅支持 PNG、JPEG 或 WebP 图片' },
      }));
    }
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
