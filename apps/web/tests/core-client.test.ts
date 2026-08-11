import { describe, expect, it, vi } from 'vitest';
import { CoreClientError, requestCore } from '@/lib/core-client';

const currentTask = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '另一客户端已更新的计划',
  area: 'WORK',
  priority: 'MEDIUM',
  status: 'IN_PROGRESS',
  targetDate: null,
  completedAt: null,
  version: 2,
  createdAt: '2026-08-10T09:00:00.000Z',
  updatedAt: '2026-08-10T10:00:00.000Z',
};

describe('requestCore', () => {
  it('preserves details from a validated API error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'VERSION_CONFLICT',
              message: '数据已变化，请确认最新内容后重试',
              details: { currentTask },
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    let thrown: unknown;
    try {
      await requestCore(`tasks/${currentTask.id}`, { method: 'PATCH' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CoreClientError);
    if (!(thrown instanceof CoreClientError)) throw thrown;
    expect(thrown).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      message: '数据已变化，请确认最新内容后重试',
      details: { currentTask },
    });
  });

  it('does not preserve details from an invalid API error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 409,
              message: '数据已变化，请确认最新内容后重试',
              details: { ownerId: 'should-not-be-exposed' },
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    let thrown: unknown;
    try {
      await requestCore('tasks/00000000-0000-4000-8000-000000000001', { method: 'PATCH' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CoreClientError);
    if (!(thrown instanceof CoreClientError)) throw thrown;
    expect(thrown).toMatchObject({
      status: 409,
      code: 'UNEXPECTED_RESPONSE',
      message: '请求未能完成，请稍后重试',
    });
    expect(thrown.details).toBeUndefined();
  });
});
