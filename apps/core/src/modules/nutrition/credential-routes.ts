import { apiErrorSchema, nutritionCredentialDeleteSchema, nutritionCredentialResponseSchema, nutritionCredentialWriteSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { SecretStoreUnavailableError } from '../providers/secret-store';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { NutritionCredentialService } from './credential-service';

export async function registerNutritionCredentialRoutes(app: FastifyInstance, options: { authService: AuthService; credentials: NutritionCredentialService }): Promise<void> {
  const routeOptions = {
    onRequest: createAuthGuard(options.authService),
    errorHandler(error: Error & { code?: string }, _request: unknown, reply: import('fastify').FastifyReply) {
      if (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') return reply.status(400).send(apiErrorSchema.parse({ error: { code: 'INVALID_REQUEST', message: '请求 JSON 格式不正确' } }));
      if (error instanceof SecretStoreUnavailableError) return reply.status(503).send(apiErrorSchema.parse({ error: { code: 'SECRET_STORE_UNAVAILABLE', message: '本地密钥存储暂时不可用' } }));
      throw error;
    },
  };
  app.get('/v1/providers/usda/credential', routeOptions, async (request) =>
    nutritionCredentialResponseSchema.parse({ data: options.credentials.getMetadata(authenticatedOwnerId(request)) }));
  app.put('/v1/providers/usda/credential', routeOptions, async (request) => {
    const input = parseRequestInput(nutritionCredentialWriteSchema, request.body, '营养数据凭据不符合要求');
    return nutritionCredentialResponseSchema.parse({ data: await options.credentials.save(authenticatedOwnerId(request), input.apiKey) });
  });
  app.delete('/v1/providers/usda/credential', routeOptions, async (request) => {
    parseRequestInput(nutritionCredentialDeleteSchema, request.body, '请确认移除营养数据凭据');
    const ownerId = authenticatedOwnerId(request);
    options.credentials.remove(ownerId);
    return nutritionCredentialResponseSchema.parse({ data: options.credentials.getMetadata(ownerId) });
  });
}
