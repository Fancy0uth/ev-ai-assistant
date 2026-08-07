import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayDashboard } from '@/components/today/today-dashboard';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const emptySnapshot = {
  data: {
    date: '2026-08-07',
    status: {
      score: 78,
      level: 'STEADY',
      source: 'RULES_V1',
      reasons: ['今天没有待处理任务'],
      priorities: [],
    },
    tasks: [],
    yesterday: null,
    agents: { deepSeek: 'NOT_CONFIGURED', codex: 'NOT_CONFIGURED' },
  },
};

const task = {
  id: '00000000-0000-4000-8000-000000000010',
  title: '完成第一个真实闭环',
  area: 'WORK',
  priority: 'MEDIUM',
  status: 'OPEN',
  targetDate: '2026-08-07',
  completedAt: null,
  version: 1,
  createdAt: '2026-08-07T01:00:00.000Z',
  updatedAt: '2026-08-07T01:00:00.000Z',
};

const populatedSnapshot = {
  data: {
    ...emptySnapshot.data,
    status: {
      ...emptySnapshot.data.status,
      reasons: ['今天有 1 个待处理任务，负载可控'],
      priorities: [
        {
          id: task.id,
          title: task.title,
          area: task.area,
          priority: task.priority,
          status: task.status,
        },
      ],
    },
    tasks: [task],
  },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TodayDashboard', () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it('creates a task and refreshes the Today status from the server', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(jsonResponse({ data: task }, 201))
      .mockResolvedValueOnce(jsonResponse(populatedSnapshot));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate="2026-08-07" />);
    expect(await screen.findByText('今天还没有任务')).toBeInTheDocument();

    await user.type(screen.getByLabelText('新任务'), task.title);
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    expect(await screen.findAllByText(task.title)).toHaveLength(2);
    expect(screen.getAllByText('规则引擎')).toHaveLength(3);
    expect(screen.getAllByText('Milestone 0.6')).toHaveLength(2);
    const renderedIds = Array.from(document.querySelectorAll('[id]'), ({ id }) => id);
    expect(new Set(renderedIds).size).toBe(renderedIds.length);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('routes an expired session to login instead of showing a fake dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' },
          },
          401,
        ),
      ),
    );

    render(<TodayDashboard initialDate="2026-08-07" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('规则引擎')).not.toBeInTheDocument();
  });
});
