import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  taskListResponseSchema,
  taskResponseSchema,
  taskVersionConflictDetailsSchema,
} from '@ev/contracts';
import type { Task, TaskListQuery } from '@ev/contracts';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { ApiError } from '../src/http/api-error';
import { createTaskRepository } from '../src/modules/tasks/repository';
import type { TaskRepository } from '../src/modules/tasks/repository';
import { createTaskService } from '../src/modules/tasks/service';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};

const taskInput = {
  title: '完成 Core 任务闭环',
  area: 'WORK',
  priority: 'HIGH',
  targetDate: '2026-08-07',
} as const;

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('versioned local task API', () => {
  let app: FastifyInstance | undefined;
  let testDirectory: string;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'ev-core-tasks-'));
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(testDirectory, { recursive: true, force: true });
  });

  async function createAuthenticatedApp(): Promise<{ token: string }> {
    app = await buildApp({
      databasePath: join(testDirectory, 'app.sqlite'),
      logger: false,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    return { token: readSessionToken(setup.headers['set-cookie']) };
  }

  it('creates, filters, lists and completes the signed-in owner task', async () => {
    const { token } = await createAuthenticatedApp();
    const created = await app!.inject({
      method: 'POST',
      url: '/v1/tasks',
      cookies: { ev_session: token },
      payload: taskInput,
    });

    expect(created.statusCode).toBe(201);
    const task = taskResponseSchema.parse(created.json()).data;
    expect(task).toMatchObject({
      ...taskInput,
      status: 'OPEN',
      completedAt: null,
      version: 1,
    });

    await app!.inject({
      method: 'POST',
      url: '/v1/tasks',
      cookies: { ev_session: token },
      payload: { ...taskInput, title: '明天再做', targetDate: '2026-08-08' },
    });
    const listed = await app!.inject({
      method: 'GET',
      url: '/v1/tasks?page=1&pageSize=999&targetDate=2026-08-07',
      cookies: { ev_session: token },
    });
    expect(listed.statusCode).toBe(200);
    expect(taskListResponseSchema.parse(listed.json()).data).toMatchObject({
      items: [{ id: task.id, title: task.title }],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });

    const completed = await app!.inject({
      method: 'PATCH',
      url: `/v1/tasks/${task.id}`,
      cookies: { ev_session: token },
      payload: { version: task.version, status: 'DONE' },
    });
    expect(completed.statusCode).toBe(200);
    expect(taskResponseSchema.parse(completed.json()).data).toMatchObject({
      id: task.id,
      title: task.title,
      area: task.area,
      priority: task.priority,
      targetDate: task.targetDate,
      status: 'DONE',
      version: 2,
    });
    expect(completed.json().data.completedAt).toBeTruthy();

    const openTask = await app!.inject({
      method: 'POST',
      url: '/v1/tasks',
      cookies: { ev_session: token },
      payload: { ...taskInput, title: '保持开放', priority: 'LOW' },
    });
    const ordered = await app!.inject({
      method: 'GET',
      url: '/v1/tasks?targetDate=2026-08-07',
      cookies: { ev_session: token },
    });
    expect(taskListResponseSchema.parse(ordered.json()).data.items.map(({ title }) => title)).toEqual([
      '保持开放',
      task.title,
    ]);

    const reopened = await app!.inject({
      method: 'PATCH',
      url: `/v1/tasks/${task.id}`,
      cookies: { ev_session: token },
      payload: { version: 2, status: 'IN_PROGRESS' },
    });
    expect(taskResponseSchema.parse(reopened.json()).data).toMatchObject({
      status: 'IN_PROGRESS',
      completedAt: null,
      version: 3,
    });

    await app!.close();
    app = undefined;
    const database = openDatabase(join(testDirectory, 'app.sqlite'));
    const repository = createTaskRepository(database);
    const owner = database.prepare('select id from owners').get() as { id: string };
    const otherOwnerId = '00000000-0000-4000-8000-000000000001';
    expect(repository.findById(otherOwnerId, task.id)).toBeUndefined();
    expect(
      repository.list(otherOwnerId, { page: 1, pageSize: 50 }).items,
    ).toEqual([]);
    expect(
      repository.update(otherOwnerId, task.id, {
        title: task.title,
        area: task.area,
        priority: task.priority,
        status: 'CANCELLED',
        targetDate: task.targetDate,
        completedAt: null,
        updatedAt: new Date().toISOString(),
        expectedVersion: 3,
      }),
    ).toBeUndefined();
    expect(repository.findById(owner.id, task.id)).toMatchObject({
      status: 'IN_PROGRESS',
      version: 3,
    });
    database.close();

    expect(taskResponseSchema.parse(openTask.json()).data.status).toBe('OPEN');
  });

  it('returns stable errors for auth, validation, missing tasks and stale versions', async () => {
    app = await buildApp({
      databasePath: join(testDirectory, 'app.sqlite'),
      logger: false,
    });
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: taskInput,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    const token = readSessionToken(setup.headers['set-cookie']);
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      cookies: { ev_session: token },
      payload: { ...taskInput, title: '   ' },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

    const missing = await app.inject({
      method: 'PATCH',
      url: '/v1/tasks/00000000-0000-4000-8000-000000000000',
      cookies: { ev_session: token },
      payload: { version: 1, status: 'DONE' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('TASK_NOT_FOUND');

    const created = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      cookies: { ev_session: token },
      payload: taskInput,
    });
    const task = taskResponseSchema.parse(created.json()).data;
    await app.inject({
      method: 'PATCH',
      url: `/v1/tasks/${task.id}`,
      cookies: { ev_session: token },
      payload: { version: 1, status: 'IN_PROGRESS' },
    });
    const stale = await app.inject({
      method: 'PATCH',
      url: `/v1/tasks/${task.id}`,
      cookies: { ev_session: token },
      payload: { version: 1, status: 'DONE' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: 'VERSION_CONFLICT',
      message: '数据已变化，请确认最新内容后重试',
    });
    expect(taskVersionConflictDetailsSchema.parse(stale.json().error.details).currentTask).toMatchObject({
      id: task.id,
      status: 'IN_PROGRESS',
      version: 2,
    });
    expect(JSON.stringify(stale.json())).not.toMatch(/ownerId|cookie|password|session|token/i);
  });
});

describe('task list repository filters', () => {
  const ownerId = '00000000-0000-4000-8000-000000000101';
  const otherOwnerId = '00000000-0000-4000-8000-000000000102';
  let database: Database.Database;
  let repository: TaskRepository;
  let service: ReturnType<typeof createTaskService>;
  let filterDirectory: string;

  const fixtureTasks = [
    ['工作开放今天', 'WORK', 'OPEN', '2026-08-10'],
    ['学习进行未来', 'STUDY', 'IN_PROGRESS', '2026-08-11'],
    ['生活完成未来', 'LIFE', 'DONE', '2026-08-12'],
    ['工作延期过去', 'WORK', 'DEFERRED', '2026-08-09'],
    ['学习取消未安排', 'STUDY', 'CANCELLED', null],
    ['工作开放未安排', 'WORK', 'OPEN', null],
    ['生活开放今天', 'LIFE', 'OPEN', '2026-08-10'],
    ['工作开放未来', 'WORK', 'OPEN', '2026-08-11'],
    ['工作开放更晚', 'WORK', 'OPEN', '2026-08-12'],
    ['学习开放未来', 'STUDY', 'OPEN', '2026-08-13'],
  ] as const;

  beforeEach(() => {
    filterDirectory = mkdtempSync(join(tmpdir(), 'ev-core-task-filters-'));
    database = openDatabase(join(filterDirectory, 'app.sqlite'));
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, '筛选测试主人', 'not-used-in-this-test', '2026-08-01T00:00:00.000Z');
    repository = createTaskRepository(database);
    service = createTaskService(repository);

    fixtureTasks.forEach(([title, area, status, targetDate], index) => {
      repository.create({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ownerId,
        title,
        area,
        priority: 'MEDIUM',
        status,
        targetDate,
        completedAt: null,
        version: 1,
        createdAt: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
        updatedAt: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
      });
    });
  });

  afterEach(() => {
    database.close();
    rmSync(filterDirectory, { recursive: true, force: true });
  });

  function titles(query: TaskListQuery): string[] {
    return repository.list(ownerId, query).items.map((task) => task.title);
  }

  it.each([
    [
      'area',
      { page: 1, pageSize: 20, area: 'WORK' },
      ['工作开放今天', '工作开放未安排', '工作开放未来', '工作开放更晚', '工作延期过去'],
    ],
    [
      'status',
      { page: 1, pageSize: 20, status: 'IN_PROGRESS' },
      ['学习进行未来'],
    ],
    [
      'exact targetDate',
      { page: 1, pageSize: 20, targetDate: '2026-08-10' },
      ['工作开放今天', '生活开放今天'],
    ],
  ] satisfies Array<[string, TaskListQuery, string[]]>)('filters by %s', (_filter, query, expected) => {
    expect(titles(query)).toEqual(expected);
  });

  it('includes only dates strictly after the FUTURE reference date', () => {
    expect(
      titles({ page: 1, pageSize: 20, dateScope: 'FUTURE', referenceDate: '2026-08-10' }),
    ).toEqual(['学习进行未来', '工作开放未来', '工作开放更晚', '学习开放未来', '生活完成未来']);
  });

  it('includes only null target dates for UNDATED', () => {
    expect(titles({ page: 1, pageSize: 20, dateScope: 'UNDATED' })).toEqual([
      '工作开放未安排',
      '学习取消未安排',
    ]);
  });

  it('applies combined filters before computing page items and totals', () => {
    const result = service.list(ownerId, {
      page: 1,
      pageSize: 1,
      area: 'WORK',
      status: 'OPEN',
      dateScope: 'FUTURE',
      referenceDate: '2026-08-10',
    });

    expect(result.items.map((task) => task.title)).toEqual(['工作开放未来']);
    expect(result.pagination).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('always isolates a filtered list to the requested owner', () => {
    expect(
      repository.list(otherOwnerId, {
        page: 1,
        pageSize: 20,
        area: 'WORK',
        status: 'OPEN',
        dateScope: 'FUTURE',
        referenceDate: '2026-08-10',
      }),
    ).toEqual({ items: [], total: 0 });
  });
});

describe('task version conflict races', () => {
  it('returns the latest same-owner task after update loses a race', () => {
    const ownerId = '00000000-0000-4000-8000-000000000001';
    const id = '00000000-0000-4000-8000-000000000002';
    const initialTask: Task = {
      id,
      title: '更新项目计划',
      area: 'WORK',
      priority: 'MEDIUM',
      status: 'OPEN',
      targetDate: null,
      completedAt: null,
      version: 1,
      createdAt: '2026-08-10T09:00:00.000Z',
      updatedAt: '2026-08-10T09:00:00.000Z',
    };
    const latestTask: Task = {
      ...initialTask,
      title: '另一客户端已更新的计划',
      status: 'IN_PROGRESS',
      version: 2,
      updatedAt: '2026-08-10T10:00:00.000Z',
    };
    const findByIdCalls: Array<[string, string]> = [];
    const repository: TaskRepository = {
      create: () => initialTask,
      findById(foundOwnerId, foundId) {
        findByIdCalls.push([foundOwnerId, foundId]);
        return findByIdCalls.length === 1 ? initialTask : latestTask;
      },
      list: () => ({ items: [], total: 0 }),
      listForDate: () => [],
      update: () => undefined,
    };
    const service = createTaskService(repository, {
      now: () => new Date('2026-08-10T10:01:00.000Z'),
    });

    let thrown: unknown;
    try {
      service.update(ownerId, id, { version: 1, status: 'DONE' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    if (!(thrown instanceof ApiError)) throw thrown;
    expect(thrown).toMatchObject({
      statusCode: 409,
      code: 'VERSION_CONFLICT',
      message: '数据已变化，请确认最新内容后重试',
    });
    expect(taskVersionConflictDetailsSchema.parse(thrown.details)).toEqual({ currentTask: latestTask });
    expect(findByIdCalls).toEqual([
      [ownerId, id],
      [ownerId, id],
    ]);
    expect(JSON.stringify(thrown.details)).not.toMatch(/ownerId|cookie|password|session|token/i);
  });
});
