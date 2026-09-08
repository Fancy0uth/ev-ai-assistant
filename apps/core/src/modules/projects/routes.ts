import {
  createProjectScopeSchema,
  projectScopeListResponseSchema,
  projectScopePathSchema,
  projectScopeResponseSchema,
  projectSnapshotResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { createProjectScopeService } from './scope-service';

export async function registerProjectScopeRoutes(
  app: FastifyInstance,
  options: { authService: AuthService; projectScopeService: ReturnType<typeof createProjectScopeService> },
): Promise<void> {
  const guard = createAuthGuard(options.authService);

  app.post('/v1/projects', { preHandler: guard }, (request, reply) => {
    const scope = options.projectScopeService.create(
      authenticatedOwnerId(request),
      parseRequestInput(createProjectScopeSchema, request.body, '项目范围不符合要求'),
    );
    return reply.status(201).send(projectScopeResponseSchema.parse({ data: scope }));
  });

  app.get('/v1/projects', { preHandler: guard }, (request) => {
    return projectScopeListResponseSchema.parse({
      data: options.projectScopeService.list(authenticatedOwnerId(request)),
    });
  });

  app.get('/v1/projects/:id/snapshot', { preHandler: guard }, (request) => {
    const { id } = parseRequestInput(projectScopePathSchema, request.params, '项目范围路径不符合要求');
    const { scope, snapshot } = options.projectScopeService.snapshot(authenticatedOwnerId(request), id);
    return projectSnapshotResponseSchema.parse({ data: { scope, files: snapshot.files } });
  });
}
