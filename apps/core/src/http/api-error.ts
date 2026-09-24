import { apiErrorSchema } from '@ev/contracts';
import { errorCodes, type FastifyInstance } from 'fastify';

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

    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = '本地服务暂时无法完成请求';

    if (
      error instanceof errorCodes.FST_ERR_CTP_INVALID_JSON_BODY ||
      error instanceof errorCodes.FST_ERR_CTP_EMPTY_JSON_BODY ||
      error instanceof errorCodes.FST_ERR_CTP_INVALID_CONTENT_LENGTH
    ) {
      statusCode = 400;
      code = 'BAD_REQUEST';
      message = '请求正文格式无效';
    } else if (error instanceof errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE) {
      statusCode = 415;
      code = 'UNSUPPORTED_MEDIA_TYPE';
      message = '不支持此请求正文类型';
    } else if (error instanceof errorCodes.FST_ERR_CTP_BODY_TOO_LARGE) {
      statusCode = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = '请求正文超出大小限制';
    } else {
      request.log.error({ error }, 'Unhandled Core request error');
    }

    return reply.status(statusCode).send(
      apiErrorSchema.parse({
        error: {
          code,
          message,
        },
      }),
    );
  });
}
