import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiErrorSchema, taskResponseSchema, type CreateTaskInput } from '@ev/contracts';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import {
  createCalendarRepository,
  type CalendarRepository,
} from '../src/modules/calendar/repository';
import { createTaskRepository } from '../src/modules/tasks/repository';
import {
  createTaskSchedulingUnitOfWork,
  TaskSchedulingDateRequiredError,
} from '../src/modules/tasks/task-scheduling-unit-of-work';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000701';
const otherOwnerId = '00000000-0000-4000-8000-000000000702';
const localDate = '2026-08-23';
const initialTimestamp = '2026-08-23T07:00:00.000Z';
const nextTimestamp = '2026-08-23T07:30:00.000Z';

const directories: string[] = [];
const databases: Database.Database[] = [];

function scheduling() {
  return {
    durationMinutes: 75,
    earliestStartLocalTime: '09:00' as const,
    latestEndLocalTime: '12:00' as const,
    isFixed: false,
  };
}

function taskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title: '实现本地 Unit of Work',
    area: 'WORK',
    priority: 'HIGH',
    targetDate: localDate,
    scheduling: scheduling(),
    ...overrides,
  };
}

function createHarness(options: {
  calendarRepository?: CalendarRepository;
  timestamps?: string[];
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ev-task-scheduling-uow-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'app.sqlite'));
  databases.push(database);
  database
    .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
    .run(ownerId, '任务排程测试主人', 'not-used-in-this-test', initialTimestamp);

  const taskRepository = createTaskRepository(database);
  const realCalendarRepository = createCalendarRepository(database);
  const identifiers = [
    '00000000-0000-4000-8000-000000000711',
    '00000000-0000-4000-8000-000000000712',
    '00000000-0000-4000-8000-000000000713',
    '00000000-0000-4000-8000-000000000714',
    '00000000-0000-4000-8000-000000000715',
    '00000000-0000-4000-8000-000000000716',
  ];
  const timestamps = options.timestamps ?? [initialTimestamp, nextTimestamp, '2026-08-23T08:00:00.000Z'];
  let identifierIndex = 0;
  let timestampIndex = 0;
  const nowCalls: Date[] = [];
  const unitOfWork = createTaskSchedulingUnitOfWork(database, {
    taskRepository,
    calendarRepository: options.calendarRepository ?? realCalendarRepository,
    newId: () => identifiers[identifierIndex++]!,
    now: () => {
      const value = new Date(timestamps[timestampIndex++]!);
      nowCalls.push(value);
      return value;
    },
  });

  return { database, taskRepository, calendarRepository: realCalendarRepository, unitOfWork, nowCalls };
}

function assertSingleActiveRequest(harness: ReturnType<typeof createHarness>, taskId: string) {
  const requests = harness.calendarRepository.listTimeRequestsForDate(ownerId, localDate);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    source: 'PROJECT_AGENT',
    title: '实现本地 Unit of Work',
    targetDate: localDate,
    durationMinutes: 75,
    priority: 'HIGH',
    earliestStartLocalTime: '09:00',
    latestEndLocalTime: '12:00',
    isFixed: false,
    origin: { kind: 'TASK', entityId: taskId, entityVersion: 1 },
    lifecycleStatus: 'ACTIVE',
    version: 1,
    createdAt: initialTimestamp,
    updatedAt: initialTimestamp,
  });
  return requests[0]!;
}

afterEach(() => {
  while (databases.length > 0) {
    const database = databases.pop();
    if (database?.open) database.close();
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('TaskSchedulingUnitOfWork', () => {
  it('writes only an OPEN task when creation is unscheduled', () => {
    const harness = createHarness();

    const task = harness.unitOfWork.create(ownerId, taskInput({ scheduling: null }));

    expect(task).toMatchObject({ status: 'OPEN', scheduling: null, version: 1 });
    expect(harness.taskRepository.findById(ownerId, task.id)).toEqual(task);
    expect(harness.calendarRepository.listTimeRequestsForDate(ownerId, localDate)).toEqual([]);
    expect(harness.nowCalls).toHaveLength(1);
  });

  it('writes one mapped ACTIVE request with a scheduled task', () => {
    const harness = createHarness();

    const task = harness.unitOfWork.create(ownerId, taskInput());

    expect(task).toMatchObject({
      id: '00000000-0000-4000-8000-000000000711',
      status: 'OPEN',
      scheduling: scheduling(),
      version: 1,
      createdAt: initialTimestamp,
      updatedAt: initialTimestamp,
    });
    assertSingleActiveRequest(harness, task.id);
    expect(harness.nowCalls).toHaveLength(1);
  });

  it('rejects scheduling without a target date before either table is written', () => {
    const harness = createHarness();

    expect(() => harness.unitOfWork.create(ownerId, taskInput({ targetDate: null }))).toThrow(
      TaskSchedulingDateRequiredError,
    );

    expect(harness.taskRepository.list(ownerId, { page: 1, pageSize: 20 })).toEqual({
      items: [],
      total: 0,
    });
    expect(harness.calendarRepository.listTimeRequestsForDate(ownerId, localDate)).toEqual([]);
  });

  it('updates the same ACTIVE request with Task version mapping exactly once', () => {
    const harness = createHarness();
    const created = harness.unitOfWork.create(ownerId, taskInput());

    const result = harness.unitOfWork.update(ownerId, created.id, {
      version: 1,
      title: '复核事务边界',
      priority: 'MEDIUM',
      targetDate: '2026-08-24',
    });

    expect(result).toMatchObject({
      kind: 'UPDATED',
      task: {
        id: created.id,
        title: '复核事务边界',
        priority: 'MEDIUM',
        targetDate: '2026-08-24',
        version: 2,
        updatedAt: nextTimestamp,
      },
    });
    const request = harness.calendarRepository.findActiveTimeRequestByOrigin(ownerId, {
      kind: 'TASK',
      entityId: created.id,
    });
    expect(request).toMatchObject({
      id: '00000000-0000-4000-8000-000000000712',
      title: '复核事务边界',
      targetDate: '2026-08-24',
      durationMinutes: 75,
      priority: 'MEDIUM',
      origin: { kind: 'TASK', entityId: created.id, entityVersion: 2 },
      lifecycleStatus: 'ACTIVE',
      version: 2,
      updatedAt: nextTimestamp,
    });
    expect(harness.calendarRepository.listTimeRequestHistoryForOrigin(ownerId, {
      kind: 'TASK',
      entityId: created.id,
    })).toHaveLength(1);
  });

  it('clears scheduling and closes the active request as CANCELLED', () => {
    const harness = createHarness();
    const created = harness.unitOfWork.create(ownerId, taskInput());

    const result = harness.unitOfWork.update(ownerId, created.id, { version: 1, scheduling: null });

    expect(result).toMatchObject({ kind: 'UPDATED', task: { scheduling: null, version: 2 } });
    expect(harness.calendarRepository.listTimeRequestsForDate(ownerId, localDate)).toEqual([]);
    expect(harness.calendarRepository.listTimeRequestHistoryForOrigin(ownerId, {
      kind: 'TASK',
      entityId: created.id,
    })).toMatchObject([
      {
        lifecycleStatus: 'CLOSED',
        closedReason: 'CANCELLED',
        closedAt: nextTimestamp,
        version: 2,
      },
    ]);
  });

  it('completes a task by closing the request while retaining scheduling', () => {
    const harness = createHarness();
    const created = harness.unitOfWork.create(ownerId, taskInput());

    const result = harness.unitOfWork.update(ownerId, created.id, { version: 1, status: 'DONE' });

    expect(result).toMatchObject({
      kind: 'UPDATED',
      task: { status: 'DONE', scheduling: scheduling(), completedAt: nextTimestamp, version: 2 },
    });
    expect(harness.calendarRepository.listTimeRequestHistoryForOrigin(ownerId, {
      kind: 'TASK',
      entityId: created.id,
    })).toMatchObject([
      { lifecycleStatus: 'CLOSED', closedReason: 'COMPLETED', closedAt: nextTimestamp },
    ]);
  });

  it('cancels a task by closing the request as CANCELLED', () => {
    const harness = createHarness();
    const created = harness.unitOfWork.create(ownerId, taskInput());

    const result = harness.unitOfWork.update(ownerId, created.id, { version: 1, status: 'CANCELLED' });

    expect(result).toMatchObject({
      kind: 'UPDATED',
      task: { status: 'CANCELLED', scheduling: scheduling(), completedAt: null, version: 2 },
    });
    expect(harness.calendarRepository.listTimeRequestHistoryForOrigin(ownerId, {
      kind: 'TASK',
      entityId: created.id,
    })).toMatchObject([{ lifecycleStatus: 'CLOSED', closedReason: 'CANCELLED' }]);
  });

  it('reopens a terminal scheduled task by preserving history and creating a new ACTIVE request', () => {
    const harness = createHarness();
    const created = harness.unitOfWork.create(ownerId, taskInput());
    harness.unitOfWork.update(ownerId, created.id, { version: 1, status: 'DONE' });

    const reopened = harness.unitOfWork.update(ownerId, created.id, {
      version: 2,
      status: 'IN_PROGRESS',
    });

    expect(reopened).toMatchObject({
      kind: 'UPDATED',
      task: { status: 'IN_PROGRESS', scheduling: scheduling(), version: 3 },
    });
    expect(harness.calendarRepository.listTimeRequestHistoryForOrigin(ownerId, {
      kind: 'TASK',
      entityId: created.id,
    })).toMatchObject([
      { id: '00000000-0000-4000-8000-000000000712', lifecycleStatus: 'CLOSED', closedReason: 'COMPLETED' },
      {
        id: '00000000-0000-4000-8000-000000000713',
        lifecycleStatus: 'ACTIVE',
        origin: { kind: 'TASK', entityId: created.id, entityVersion: 3 },
        version: 1,
      },
    ]);
  });

  it('leaves both rows unchanged on a stale Task version', () => {
    const harness = createHarness();
    const created = harness.unitOfWork.create(ownerId, taskInput());

    const result = harness.unitOfWork.update(ownerId, created.id, {
      version: 99,
      title: '不应写入',
    });

    expect(result).toMatchObject({ kind: 'VERSION_CONFLICT', currentTask: created });
    expect(harness.taskRepository.findById(ownerId, created.id)).toEqual(created);
    expect(harness.calendarRepository.findActiveTimeRequestByOrigin(ownerId, {
      kind: 'TASK',
      entityId: created.id,
    })).toMatchObject({ title: created.title, version: 1 });
  });

  it('rolls the Task write back when Calendar creation fails', () => {
    const setup = createHarness();
    const failingCalendar: CalendarRepository = {
      ...setup.calendarRepository,
      createActiveTimeRequest() {
        throw new Error('calendar create failed');
      },
    };
    const unitOfWork = createTaskSchedulingUnitOfWork(setup.database, {
      taskRepository: setup.taskRepository,
      calendarRepository: failingCalendar,
      newId: () => '00000000-0000-4000-8000-000000000721',
      now: () => new Date(initialTimestamp),
    });

    expect(() => unitOfWork.create(ownerId, taskInput())).toThrow('calendar create failed');
    expect(setup.taskRepository.list(ownerId, { page: 1, pageSize: 20 })).toEqual({
      items: [],
      total: 0,
    });
    expect(setup.calendarRepository.listTimeRequestsForDate(ownerId, localDate)).toEqual([]);
  });

  it('rolls both rows back when Calendar update or close fails', () => {
    const updateHarness = createHarness();
    const updated = updateHarness.unitOfWork.create(ownerId, taskInput());
    const failingUpdateCalendar: CalendarRepository = {
      ...updateHarness.calendarRepository,
      updateActiveTimeRequest() {
        throw new Error('calendar update failed');
      },
    };
    const failingUpdateUnitOfWork = createTaskSchedulingUnitOfWork(updateHarness.database, {
      taskRepository: updateHarness.taskRepository,
      calendarRepository: failingUpdateCalendar,
      newId: () => '00000000-0000-4000-8000-000000000722',
      now: () => new Date(nextTimestamp),
    });

    expect(() => failingUpdateUnitOfWork.update(ownerId, updated.id, {
      version: 1,
      title: '不应持久化',
    })).toThrow('calendar update failed');
    expect(updateHarness.taskRepository.findById(ownerId, updated.id)).toEqual(updated);
    expect(updateHarness.calendarRepository.findActiveTimeRequestByOrigin(ownerId, {
      kind: 'TASK',
      entityId: updated.id,
    })).toMatchObject({ version: 1, title: updated.title });

    const closeHarness = createHarness();
    const closable = closeHarness.unitOfWork.create(ownerId, taskInput());
    const failingCloseCalendar: CalendarRepository = {
      ...closeHarness.calendarRepository,
      closeActiveTimeRequest() {
        throw new Error('calendar close failed');
      },
    };
    const failingCloseUnitOfWork = createTaskSchedulingUnitOfWork(closeHarness.database, {
      taskRepository: closeHarness.taskRepository,
      calendarRepository: failingCloseCalendar,
      newId: () => '00000000-0000-4000-8000-000000000723',
      now: () => new Date(nextTimestamp),
    });

    expect(() => failingCloseUnitOfWork.update(ownerId, closable.id, {
      version: 1,
      status: 'DONE',
    })).toThrow('calendar close failed');
    expect(closeHarness.taskRepository.findById(ownerId, closable.id)).toEqual(closable);
    expect(closeHarness.calendarRepository.findActiveTimeRequestByOrigin(ownerId, {
      kind: 'TASK',
      entityId: closable.id,
    })).toMatchObject({ version: 1, lifecycleStatus: 'ACTIVE' });
  });

  it('keeps Task storage and the transaction graph free of cross-module or network paths', () => {
    const taskRepositorySource = readFileSync(
      new URL('../src/modules/tasks/repository.ts', import.meta.url),
      'utf8',
    );
    const unitOfWorkSource = readFileSync(
      new URL('../src/modules/tasks/task-scheduling-unit-of-work.ts', import.meta.url),
      'utf8',
    );

    expect(taskRepositorySource).not.toMatch(/time_requests|CalendarRepository|createActiveTimeRequest/i);
    expect(unitOfWorkSource).not.toMatch(/\basync\b|\bawait\b|\bfetch\b|https?:|readFile|writeFile|Provider/i);
  });
});

describe('Task detail API', () => {
  let appDirectory: string | undefined;

  afterEach(async () => {
    if (appDirectory) {
      rmSync(appDirectory, { recursive: true, force: true });
      appDirectory = undefined;
    }
  });

  it('returns an authenticated normalized scheduled task and hides missing or other-owner tasks', async () => {
    appDirectory = mkdtempSync(join(tmpdir(), 'ev-task-detail-route-'));
    const databasePath = join(appDirectory, 'app.sqlite');
    const app = await buildApp({ databasePath, logger: false });
    try {
      const setup = await app.inject({
        method: 'POST',
        url: '/v1/auth/setup',
        payload: { username: 'detail-route-owner', password: 'Password123!' },
      });
      const token = /ev_session=([^;]+)/.exec(String(setup.headers['set-cookie']))?.[1];
      if (!token) throw new Error('test setup did not return a session token');

      const created = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        cookies: { ev_session: token },
        payload: taskInput(),
      });
      expect(created.statusCode).toBe(201);
      const task = taskResponseSchema.parse(created.json()).data;

      const detail = await app.inject({
        method: 'GET',
        url: `/v1/tasks/${task.id}`,
        cookies: { ev_session: token },
      });
      expect(detail.statusCode).toBe(200);
      expect(taskResponseSchema.parse(detail.json()).data).toMatchObject({
        id: task.id,
        scheduling: scheduling(),
      });

      const unauthenticated = await app.inject({ method: 'GET', url: `/v1/tasks/${task.id}` });
      expect(unauthenticated.statusCode).toBe(401);

      const missing = await app.inject({
        method: 'GET',
        url: '/v1/tasks/00000000-0000-4000-8000-000000000799',
        cookies: { ev_session: token },
      });
      expect(missing.statusCode).toBe(404);
      expect(apiErrorSchema.parse(missing.json()).error.code).toBe('TASK_NOT_FOUND');

      const outsideDatabase = openDatabase(databasePath);
      try {
        outsideDatabase.pragma('foreign_keys = OFF');
        createTaskRepository(outsideDatabase).create({
          id: '00000000-0000-4000-8000-000000000798',
          ownerId: otherOwnerId,
          title: '另一位用户的任务',
          area: 'LIFE',
          priority: 'LOW',
          status: 'OPEN',
          targetDate: localDate,
          completedAt: null,
          scheduling: null,
          version: 1,
          createdAt: initialTimestamp,
          updatedAt: initialTimestamp,
        });
      } finally {
        outsideDatabase.close();
      }

      const otherOwner = await app.inject({
        method: 'GET',
        url: '/v1/tasks/00000000-0000-4000-8000-000000000798',
        cookies: { ev_session: token },
      });
      expect(otherOwner.statusCode).toBe(404);
      expect(apiErrorSchema.parse(otherOwner.json()).error.code).toBe('TASK_NOT_FOUND');

      const missingDate = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        cookies: { ev_session: token },
        payload: taskInput({ targetDate: null }),
      });
      expect(missingDate.statusCode).toBe(400);
      expect(apiErrorSchema.parse(missingDate.json()).error.code).toBe(
        'TASK_SCHEDULING_DATE_REQUIRED',
      );
    } finally {
      await app.close();
    }
  });
});
