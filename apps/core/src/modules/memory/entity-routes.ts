import {
  deleteMemorySchema,
  entityMemoryDocumentResponseSchema,
  entityMemoryRevisionListResponseSchema,
  entityMemoryScopePathSchema,
  restoreMemorySchema,
  writeMemorySchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { createEntityMemoryService } from './entity-service';

export async function registerEntityMemoryRoutes(
  app: FastifyInstance,
  options: { authService: AuthService; entityMemoryService: ReturnType<typeof createEntityMemoryService> },
): Promise<void> {
  const guard = createAuthGuard(options.authService);

  app.get('/v1/memory/entities/:scopeType/:scopeId', { preHandler: guard }, (request) => {
    const identity = parseRequestInput(entityMemoryScopePathSchema, request.params, '实体记忆范围不符合要求');
    const document = options.entityMemoryService.read(authenticatedOwnerId(request), identity);
    if (!document) throw new ApiError(404, 'MEMORY_NOT_FOUND', '记忆不存在');
    return entityMemoryDocumentResponseSchema.parse({ data: document });
  });

  app.get('/v1/memory/entities/:scopeType/:scopeId/revisions', { preHandler: guard }, (request) => {
    const identity = parseRequestInput(entityMemoryScopePathSchema, request.params, '实体记忆范围不符合要求');
    return entityMemoryRevisionListResponseSchema.parse({
      data: options.entityMemoryService.listRevisions(authenticatedOwnerId(request), identity),
    });
  });

  app.put('/v1/memory/entities/:scopeType/:scopeId', { preHandler: guard }, (request, reply) => {
    const identity = parseRequestInput(entityMemoryScopePathSchema, request.params, '实体记忆范围不符合要求');
    const input = parseRequestInput(writeMemorySchema, request.body, '记忆内容不符合要求');
    const existed = options.entityMemoryService.read(authenticatedOwnerId(request), identity);
    const document = options.entityMemoryService.write(
      authenticatedOwnerId(request),
      identity,
      input.content,
      input.expectedVersion,
    );
    return reply.status(existed ? 200 : 201).send(entityMemoryDocumentResponseSchema.parse({ data: document }));
  });

  app.post('/v1/memory/entities/:scopeType/:scopeId/restore', { preHandler: guard }, (request) => {
    const identity = parseRequestInput(entityMemoryScopePathSchema, request.params, '实体记忆范围不符合要求');
    const input = parseRequestInput(restoreMemorySchema, request.body, '恢复版本不符合要求');
    return entityMemoryDocumentResponseSchema.parse({
      data: options.entityMemoryService.restore(
        authenticatedOwnerId(request),
        identity,
        input.revisionVersion,
        input.expectedVersion,
      ),
    });
  });

  app.delete('/v1/memory/entities/:scopeType/:scopeId', { preHandler: guard }, (request, reply) => {
    const identity = parseRequestInput(entityMemoryScopePathSchema, request.params, '实体记忆范围不符合要求');
    const input = parseRequestInput(deleteMemorySchema, request.body, '删除版本不符合要求');
    options.entityMemoryService.remove(authenticatedOwnerId(request), identity, input.expectedVersion);
    return reply.status(204).send();
  });
}
