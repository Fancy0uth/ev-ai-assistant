import {
  createTaskSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskPathParamsSchema,
  taskResponseSchema,
  updateTaskSchema,
} from '@ev/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { ApiError } from '../../http/api-error';
import { createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { TaskService } from './service';

interface TaskRouteOptions {
  authService: AuthService;
  taskService: TaskService;
}

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(422, 'VALIDATION_ERROR', '任务信息不符合要求', {
      issues: result.error.issues.map(({ code, message, path }) => ({ code, message, path })),
    });
  }
  return result.data;
}

function ownerId(request: FastifyRequest): string {
  if (!request.owner) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', '请先登录本地账号');
  }
  return request.owner.id;
}

export async function registerTaskRoutes(
  app: FastifyInstance,
  options: TaskRouteOptions,
): Promise<void> {
  const { authService, taskService } = options;
  const authGuard = createAuthGuard(authService);

  app.post('/v1/tasks', { preHandler: authGuard }, async (request, reply) => {
    const task = taskService.create(ownerId(request), parseInput(createTaskSchema, request.body));
    return reply.status(201).send(taskResponseSchema.parse({ data: task }));
  });

  app.get('/v1/tasks', { preHandler: authGuard }, async (request) => {
    const query = parseInput(taskListQuerySchema, request.query);
    const result = taskService.list(ownerId(request), query);
    return taskListResponseSchema.parse({ data: result });
  });

  app.patch('/v1/tasks/:id', { preHandler: authGuard }, async (request) => {
    const { id } = parseInput(taskPathParamsSchema, request.params);
    const input = parseInput(updateTaskSchema, request.body);
    const task = taskService.update(ownerId(request), id, input);
    return taskResponseSchema.parse({ data: task });
  });
}
