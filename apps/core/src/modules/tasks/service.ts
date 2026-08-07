import { randomUUID } from 'node:crypto';
import type { CreateTaskInput, Task, TaskListQuery, UpdateTaskInput } from '@ev/contracts';
import { ApiError } from '../../http/api-error';
import type { TaskRepository } from './repository';

interface TaskListResult {
  items: Task[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface TaskServiceOptions {
  now?: () => Date;
}

export interface TaskService {
  create(ownerId: string, input: CreateTaskInput): Task;
  list(ownerId: string, query: TaskListQuery): TaskListResult;
  update(ownerId: string, id: string, input: UpdateTaskInput): Task;
}

function versionConflict(): ApiError {
  return new ApiError(409, 'VERSION_CONFLICT', '数据已变化，请确认最新内容后重试');
}

export function createTaskService(
  repository: TaskRepository,
  options: TaskServiceOptions = {},
): TaskService {
  const now = options.now ?? (() => new Date());

  return {
    create(ownerId, input) {
      const timestamp = now().toISOString();
      return repository.create({
        id: randomUUID(),
        ownerId,
        title: input.title,
        area: input.area,
        priority: input.priority,
        status: 'OPEN',
        targetDate: input.targetDate ?? null,
        completedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },

    list(ownerId, query) {
      const page = repository.list(ownerId, query);
      return {
        items: page.items,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: page.total,
          totalPages: Math.ceil(page.total / query.pageSize),
        },
      };
    },

    update(ownerId, id, input) {
      const existing = repository.findById(ownerId, id);
      if (!existing) {
        throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在');
      }
      if (existing.version !== input.version) throw versionConflict();

      const status = input.status ?? existing.status;
      let completedAt = existing.completedAt;
      if (status === 'DONE') completedAt ??= now().toISOString();
      else completedAt = null;

      const updated = repository.update(ownerId, id, {
        title: input.title ?? existing.title,
        area: input.area ?? existing.area,
        priority: input.priority ?? existing.priority,
        status,
        targetDate: input.targetDate === undefined ? existing.targetDate : input.targetDate,
        completedAt,
        updatedAt: now().toISOString(),
        expectedVersion: input.version,
      });
      if (!updated) throw versionConflict();
      return updated;
    },
  };
}
