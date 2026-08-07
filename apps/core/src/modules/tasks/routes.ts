import {
  createTaskSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskPathParamsSchema,
  taskResponseSchema,
  updateTaskSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { TaskService } from './service';

interface TaskRouteOptions {
  authService: AuthService;
  taskService: TaskService;
}

export async function registerTaskRoutes(
  app: FastifyInstance,
  options: TaskRouteOptions,
): Promise<void> {
  const { authService, taskService } = options;
  const authGuard = createAuthGuard(authService);

  app.post('/v1/tasks', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(createTaskSchema, request.body, '任务信息不符合要求');
    const task = taskService.create(authenticatedOwnerId(request), input);
    return reply.status(201).send(taskResponseSchema.parse({ data: task }));
  });

  app.get('/v1/tasks', { preHandler: authGuard }, async (request) => {
    const query = parseRequestInput(
      taskListQuerySchema,
      request.query,
      '任务查询参数不符合要求',
    );
    const result = taskService.list(authenticatedOwnerId(request), query);
    return taskListResponseSchema.parse({ data: result });
  });

  app.patch('/v1/tasks/:id', { preHandler: authGuard }, async (request) => {
    const { id } = parseRequestInput(
      taskPathParamsSchema,
      request.params,
      '任务路径参数不符合要求',
    );
    const input = parseRequestInput(updateTaskSchema, request.body, '任务信息不符合要求');
    const task = taskService.update(authenticatedOwnerId(request), id, input);
    return taskResponseSchema.parse({ data: task });
  });
}
