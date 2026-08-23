import { randomUUID } from 'node:crypto';
import { taskSchema, taskVersionConflictDetailsSchema } from '@ev/contracts';
import type {
  CreateTaskInput,
  NormalizedTask,
  Task,
  TaskListQuery,
  UpdateTaskInput,
} from '@ev/contracts';
import { ApiError } from '../../http/api-error';
import type { TaskRepository } from './repository';
import {
  TaskSchedulingDateRequiredError,
  type TaskSchedulingUnitOfWork,
} from './task-scheduling-unit-of-work';

interface TaskListResult {
  items: NormalizedTask[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface TaskServiceOptions {
  now?: () => Date;
  schedulingUnitOfWork?: TaskSchedulingUnitOfWork;
}

export interface TaskService {
  create(ownerId: string, input: CreateTaskInput): NormalizedTask;
  get(ownerId: string, id: string): NormalizedTask;
  list(ownerId: string, query: TaskListQuery): TaskListResult;
  listForDate(ownerId: string, targetDate: string): NormalizedTask[];
  update(ownerId: string, id: string, input: UpdateTaskInput): NormalizedTask;
}

function normalizeTask(task: Task): NormalizedTask {
  const normalized = taskSchema.parse(task);
  if (task.scheduling === undefined) Object.assign(task, { scheduling: null });
  return normalized;
}

function versionConflict(currentTask?: Task): ApiError {
  const details = currentTask
    ? taskVersionConflictDetailsSchema.parse({ currentTask: normalizeTask(currentTask) })
    : undefined;
  return new ApiError(409, 'VERSION_CONFLICT', '数据已变化，请确认最新内容后重试', details);
}

function schedulingUnitOfWorkRequired(): ApiError {
  return new ApiError(
    500,
    'TASK_SCHEDULING_UNIT_OF_WORK_REQUIRED',
    '排程任务需要本地同步事务支持',
  );
}

function schedulingDateRequired(): ApiError {
  return new ApiError(400, 'TASK_SCHEDULING_DATE_REQUIRED', '已排程任务必须指定日期');
}

export function createTaskService(
  repository: TaskRepository,
  options: TaskServiceOptions = {},
): TaskService {
  const now = options.now ?? (() => new Date());
  const schedulingUnitOfWork = options.schedulingUnitOfWork;

  return {
    create(ownerId, input) {
      if (schedulingUnitOfWork) {
        try {
          return schedulingUnitOfWork.create(ownerId, input);
        } catch (error) {
          if (error instanceof TaskSchedulingDateRequiredError) throw schedulingDateRequired();
          throw error;
        }
      }
      if ((input.scheduling ?? null) !== null) throw schedulingUnitOfWorkRequired();

      const timestamp = now().toISOString();
      return normalizeTask(repository.create({
        id: randomUUID(),
        ownerId,
        title: input.title,
        area: input.area,
        priority: input.priority,
        status: 'OPEN',
        targetDate: input.targetDate ?? null,
        completedAt: null,
        scheduling: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
    },

    get(ownerId, id) {
      const task = repository.findById(ownerId, id);
      if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在');
      return normalizeTask(task);
    },

    list(ownerId, query) {
      const page = repository.list(ownerId, query);
      return {
        items: page.items.map(normalizeTask),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: page.total,
          totalPages: Math.ceil(page.total / query.pageSize),
        },
      };
    },

    listForDate(ownerId, targetDate) {
      return repository.listForDate(ownerId, targetDate).map(normalizeTask);
    },

    update(ownerId, id, input) {
      if (schedulingUnitOfWork) {
        try {
          const result = schedulingUnitOfWork.update(ownerId, id, input);
          if (result.kind === 'UPDATED') return result.task;
          if (result.kind === 'NOT_FOUND') {
            throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在');
          }
          throw versionConflict(result.currentTask);
        } catch (error) {
          if (error instanceof TaskSchedulingDateRequiredError) throw schedulingDateRequired();
          throw error;
        }
      }

      const storedExisting = repository.findById(ownerId, id);
      if (!storedExisting) {
        throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在');
      }
      const existing = normalizeTask(storedExisting);
      if (input.scheduling !== undefined || (existing.scheduling ?? null) !== null) {
        throw schedulingUnitOfWorkRequired();
      }
      if (existing.version !== input.version) throw versionConflict(existing);

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
        scheduling: null,
        updatedAt: now().toISOString(),
        expectedVersion: input.version,
      });
      if (!updated) throw versionConflict(repository.findById(ownerId, id));
      return normalizeTask(updated);
    },
  };
}
