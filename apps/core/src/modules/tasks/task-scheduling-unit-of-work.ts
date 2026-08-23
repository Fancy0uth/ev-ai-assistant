import type {
  CreateTaskInput,
  NormalizedTask,
  TaskArea,
  TaskSchedulingInput,
  TaskStatus,
  TimeRequestSource,
  UpdateTaskInput,
} from '@ev/contracts';
import { taskSchema } from '@ev/contracts';
import type Database from 'better-sqlite3';
import type { CalendarRepository } from '../calendar/repository';
import type { TaskRepository } from './repository';

export class TaskSchedulingDateRequiredError extends Error {
  constructor() {
    super('TASK_SCHEDULING_DATE_REQUIRED');
    this.name = 'TaskSchedulingDateRequiredError';
  }
}

export type TaskSchedulingUpdateResult =
  | { kind: 'UPDATED'; task: NormalizedTask }
  | { kind: 'NOT_FOUND' }
  | { kind: 'VERSION_CONFLICT'; currentTask?: NormalizedTask };

export interface TaskSchedulingUnitOfWork {
  create(ownerId: string, input: CreateTaskInput): NormalizedTask;
  update(ownerId: string, id: string, input: UpdateTaskInput): TaskSchedulingUpdateResult;
}

interface TaskSchedulingUnitOfWorkOptions {
  taskRepository: TaskRepository<NormalizedTask>;
  calendarRepository: CalendarRepository;
  newId: () => string;
  now: () => Date;
}

const schedulableStatuses: ReadonlySet<TaskStatus> = new Set([
  'OPEN',
  'IN_PROGRESS',
  'DEFERRED',
]);

function sourceForArea(area: TaskArea): TimeRequestSource {
  switch (area) {
    case 'WORK':
      return 'PROJECT_AGENT';
    case 'STUDY':
      return 'LEARNING_AGENT';
    case 'LIFE':
      return 'SCHEDULE_COORDINATOR';
  }
}

function requireSchedulingDate(
  scheduling: TaskSchedulingInput | null,
  targetDate: string | null,
): void {
  if (scheduling !== null && targetDate === null) {
    throw new TaskSchedulingDateRequiredError();
  }
}

function resolveScheduling(input: UpdateTaskInput, task: NormalizedTask): TaskSchedulingInput | null {
  return input.scheduling === undefined ? task.scheduling : input.scheduling;
}

export function createTaskSchedulingUnitOfWork(
  database: Database.Database,
  options: TaskSchedulingUnitOfWorkOptions,
): TaskSchedulingUnitOfWork {
  const create = database.transaction((ownerId: string, input: CreateTaskInput) => {
    const timestamp = options.now().toISOString();
    const scheduling = input.scheduling ?? null;
    const targetDate = input.targetDate ?? null;
    requireSchedulingDate(scheduling, targetDate);

    const task = taskSchema.parse(options.taskRepository.create({
      id: options.newId(),
      ownerId,
      title: input.title,
      area: input.area,
      priority: input.priority,
      status: 'OPEN',
      targetDate,
      completedAt: null,
      scheduling,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

    if (scheduling !== null) {
      options.calendarRepository.createActiveTimeRequest({
        id: options.newId(),
        ownerId,
        source: sourceForArea(task.area),
        title: task.title,
        targetDate: task.targetDate!,
        durationMinutes: scheduling.durationMinutes,
        priority: task.priority,
        earliestStartLocalTime: scheduling.earliestStartLocalTime,
        latestEndLocalTime: scheduling.latestEndLocalTime,
        isFixed: scheduling.isFixed,
        origin: { kind: 'TASK', entityId: task.id, entityVersion: task.version },
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return task;
  });

  const update = database.transaction(
    (ownerId: string, id: string, input: UpdateTaskInput): TaskSchedulingUpdateResult => {
      const storedExisting = options.taskRepository.findById(ownerId, id);
      if (!storedExisting) return { kind: 'NOT_FOUND' };
      const existing = taskSchema.parse(storedExisting);
      if (existing.version !== input.version) {
        return { kind: 'VERSION_CONFLICT', currentTask: existing };
      }

      const scheduling = resolveScheduling(input, existing);
      const targetDate = input.targetDate === undefined ? existing.targetDate : input.targetDate;
      requireSchedulingDate(scheduling, targetDate);
      const timestamp = options.now().toISOString();
      const status = input.status ?? existing.status;
      const completedAt = status === 'DONE' ? existing.completedAt ?? timestamp : null;
      const storedTask = options.taskRepository.update(ownerId, id, {
        title: input.title ?? existing.title,
        area: input.area ?? existing.area,
        priority: input.priority ?? existing.priority,
        status,
        targetDate,
        completedAt,
        scheduling,
        updatedAt: timestamp,
        expectedVersion: input.version,
      });
      if (!storedTask) {
        const currentTask = options.taskRepository.findById(ownerId, id);
        return currentTask
          ? { kind: 'VERSION_CONFLICT', currentTask: taskSchema.parse(currentTask) }
          : { kind: 'VERSION_CONFLICT' };
      }
      const task = taskSchema.parse(storedTask);

      const activeRequest = options.calendarRepository.findActiveTimeRequestByOrigin(ownerId, {
        kind: 'TASK',
        entityId: task.id,
      });
      const isSchedulable = schedulableStatuses.has(task.status);
      const shouldClose = !isSchedulable || scheduling === null;

      if (shouldClose) {
        if (activeRequest) {
          const closed = options.calendarRepository.closeActiveTimeRequest(ownerId, activeRequest.id, {
            expectedVersion: activeRequest.version,
            closedAt: timestamp,
            closedReason: task.status === 'DONE' ? 'COMPLETED' : 'CANCELLED',
          });
          if (!closed) throw new Error('TASK_TIME_REQUEST_SYNC_CONFLICT');
        }
        return { kind: 'UPDATED', task };
      }

      if (activeRequest) {
        const updated = options.calendarRepository.updateActiveTimeRequest(ownerId, activeRequest.id, {
          expectedVersion: activeRequest.version,
          title: task.title,
          targetDate: task.targetDate!,
          durationMinutes: scheduling.durationMinutes,
          priority: task.priority,
          earliestStartLocalTime: scheduling.earliestStartLocalTime,
          latestEndLocalTime: scheduling.latestEndLocalTime,
          isFixed: scheduling.isFixed,
          origin: { kind: 'TASK', entityId: task.id, entityVersion: task.version },
          updatedAt: timestamp,
        });
        if (!updated) throw new Error('TASK_TIME_REQUEST_SYNC_CONFLICT');
      } else {
        options.calendarRepository.createActiveTimeRequest({
          id: options.newId(),
          ownerId,
          source: sourceForArea(task.area),
          title: task.title,
          targetDate: task.targetDate!,
          durationMinutes: scheduling.durationMinutes,
          priority: task.priority,
          earliestStartLocalTime: scheduling.earliestStartLocalTime,
          latestEndLocalTime: scheduling.latestEndLocalTime,
          isFixed: scheduling.isFixed,
          origin: { kind: 'TASK', entityId: task.id, entityVersion: task.version },
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      return { kind: 'UPDATED', task };
    },
  );

  return { create, update };
}
