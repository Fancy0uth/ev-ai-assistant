import {
  confirmMemoryCompactionDraftSchema,
  createMemoryCompactionDraftSchema,
  entityMemoryScopePathSchema,
  memoryCompactionDraftDetailResponseSchema,
  memoryCompactionDraftListResponseSchema,
  memoryCompactionDraftPathSchema,
  memoryCompactionDraftResponseSchema,
  memoryCompactionOutcomeResponseSchema,
  rejectMemoryCompactionDraftSchema,
  restoreMemoryCompactionDraftSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { createMemoryCompactionService } from './compaction-service';

function draftNotFound(): ApiError {
  return new ApiError(404, 'MEMORY_COMPACTION_DRAFT_NOT_FOUND', '记忆压缩草案不存在');
}

export async function registerMemoryCompactionRoutes(
  app: FastifyInstance,
  options: { authService: AuthService; memoryCompactionService: ReturnType<typeof createMemoryCompactionService> },
): Promise<void> {
  const guard = createAuthGuard(options.authService);

  app.post('/v1/memory/compactions', { preHandler: guard }, (request, reply) => {
    const input = parseRequestInput(createMemoryCompactionDraftSchema, request.body, '记忆压缩草案不符合要求');
    const result = options.memoryCompactionService.createManualDraft(authenticatedOwnerId(request), {
      identity: { scopeType: input.scopeType, scopeId: input.scopeId },
      mode: input.mode,
      expectedVersion: input.expectedVersion,
    });
    return reply.status(result.reused ? 200 : 201).send(memoryCompactionDraftResponseSchema.parse({ data: result }));
  });

  app.get('/v1/memory/compactions/:scopeType/:scopeId', { preHandler: guard }, (request) => {
    const identity = parseRequestInput(entityMemoryScopePathSchema, request.params, '实体记忆范围不符合要求');
    return memoryCompactionDraftListResponseSchema.parse({
      data: { items: options.memoryCompactionService.listDrafts(authenticatedOwnerId(request), identity) },
    });
  });

  app.get('/v1/memory/compactions/drafts/:draftId', { preHandler: guard }, (request) => {
    const { draftId } = parseRequestInput(memoryCompactionDraftPathSchema, request.params, '记忆压缩草案不符合要求');
    const draft = options.memoryCompactionService.getDraft(authenticatedOwnerId(request), draftId);
    if (!draft) throw draftNotFound();
    return memoryCompactionDraftDetailResponseSchema.parse({ data: { draft } });
  });

  app.post('/v1/memory/compactions/drafts/:draftId/reject', { preHandler: guard }, (request) => {
    const { draftId } = parseRequestInput(memoryCompactionDraftPathSchema, request.params, '记忆压缩草案不符合要求');
    const input = parseRequestInput(rejectMemoryCompactionDraftSchema, request.body, '记忆压缩拒绝不符合要求');
    const draft = options.memoryCompactionService.reject(authenticatedOwnerId(request), draftId, input.expectedDraftVersion);
    return memoryCompactionDraftDetailResponseSchema.parse({ data: { draft } });
  });

  app.post('/v1/memory/compactions/drafts/:draftId/confirm', { preHandler: guard }, (request) => {
    const { draftId } = parseRequestInput(memoryCompactionDraftPathSchema, request.params, '记忆压缩确认不符合要求');
    const input = parseRequestInput(confirmMemoryCompactionDraftSchema, request.body, '记忆压缩确认不符合要求');
    return memoryCompactionOutcomeResponseSchema.parse({
      data: options.memoryCompactionService.confirm(authenticatedOwnerId(request), draftId, input),
    });
  });

  app.post('/v1/memory/compactions/drafts/:draftId/restore', { preHandler: guard }, (request) => {
    const { draftId } = parseRequestInput(memoryCompactionDraftPathSchema, request.params, '记忆压缩恢复不符合要求');
    const input = parseRequestInput(restoreMemoryCompactionDraftSchema, request.body, '记忆压缩恢复不符合要求');
    return memoryCompactionOutcomeResponseSchema.parse({
      data: options.memoryCompactionService.restore(authenticatedOwnerId(request), draftId, input),
    });
  });
}
