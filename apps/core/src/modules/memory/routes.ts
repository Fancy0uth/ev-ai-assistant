import {
  deleteMemorySchema,
  memoryDocumentListResponseSchema,
  memoryDocumentResponseSchema,
  memoryRevisionListResponseSchema,
  memoryScopePathSchema,
  restoreMemorySchema,
  writeMemorySchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { createMemoryService } from './service';

export async function registerMemoryRoutes(
  app: FastifyInstance,
  options: { authService: AuthService; memoryService: ReturnType<typeof createMemoryService> },
): Promise<void> {
  const guard = createAuthGuard(options.authService);

  app.get('/v1/memory', { preHandler: guard }, (request) => {
    return memoryDocumentListResponseSchema.parse({
      data: options.memoryService.list(authenticatedOwnerId(request)),
    });
  });

  app.get('/v1/memory/:scope/revisions', { preHandler: guard }, (request) => {
    const { scope } = parseRequestInput(memoryScopePathSchema, request.params, '记忆范围不符合要求');
    return memoryRevisionListResponseSchema.parse({
      data: options.memoryService.listRevisions(authenticatedOwnerId(request), scope),
    });
  });

  app.put('/v1/memory/:scope', { preHandler: guard }, (request, reply) => {
    const { scope } = parseRequestInput(memoryScopePathSchema, request.params, '记忆范围不符合要求');
    const input = parseRequestInput(writeMemorySchema, request.body, '记忆内容不符合要求');
    const existed = options.memoryService.read(authenticatedOwnerId(request), scope);
    const document = options.memoryService.write(
      authenticatedOwnerId(request),
      scope,
      input.content,
      input.expectedVersion,
    );
    return reply.status(existed ? 200 : 201).send(memoryDocumentResponseSchema.parse({ data: document }));
  });

  app.post('/v1/memory/:scope/restore', { preHandler: guard }, (request) => {
    const { scope } = parseRequestInput(memoryScopePathSchema, request.params, '记忆范围不符合要求');
    const input = parseRequestInput(restoreMemorySchema, request.body, '恢复版本不符合要求');
    return memoryDocumentResponseSchema.parse({
      data: options.memoryService.restore(
        authenticatedOwnerId(request),
        scope,
        input.revisionVersion,
        input.expectedVersion,
      ),
    });
  });

  app.delete('/v1/memory/:scope', { preHandler: guard }, (request, reply) => {
    const { scope } = parseRequestInput(memoryScopePathSchema, request.params, '记忆范围不符合要求');
    const input = parseRequestInput(deleteMemorySchema, request.body, '删除版本不符合要求');
    options.memoryService.remove(authenticatedOwnerId(request), scope, input.expectedVersion);
    return reply.status(204).send();
  });
}
