import { describe, expect, it } from 'vitest';
import {
  createTaskSchema,
  credentialsSchema,
  healthResponseSchema,
  taskListQuerySchema,
  updateTaskSchema,
} from '../src/index';

describe('healthResponseSchema', () => {
  it('rejects a health response without a service version', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});

describe('credentialsSchema', () => {
  it('rejects passwords shorter than twelve characters', () => {
    expect(
      credentialsSchema.safeParse({ username: 'codex', password: 'too-short' }).success,
    ).toBe(false);
  });

  it('accepts Unicode letters in a local owner username', () => {
    expect(
      credentialsSchema.safeParse({
        username: '本地主人',
        password: 'correct horse battery staple',
      }).success,
    ).toBe(true);
  });
});

describe('task contracts', () => {
  it('normalizes task titles and clamps list page size', () => {
    expect(
      createTaskSchema.parse({
        title: '  完成 Core 任务闭环  ',
        area: 'WORK',
        priority: 'HIGH',
        targetDate: '2026-08-07',
      }).title,
    ).toBe('完成 Core 任务闭环');
    expect(taskListQuerySchema.parse({ pageSize: '999' }).pageSize).toBe(100);
    expect(taskListQuerySchema.parse({ pageSize: '0' }).pageSize).toBe(1);
  });

  it('requires a version and at least one changed field for updates', () => {
    expect(updateTaskSchema.safeParse({ status: 'DONE' }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 1, status: 'DONE' }).success).toBe(true);
  });
});
