import type { Task } from '@ev/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const task: Task = {
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

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshotWith(tasks: Task[], date = '2026-08-07') {
  return { data: { ...emptySnapshot.data, date, tasks } };
}

const secondTask: Task = {
  ...task,
  id: '00000000-0000-4000-8000-000000000011',
  title: '第二个任务',
};

const doneTask: Task = {
  ...task,
  status: 'DONE',
  version: 2,
  completedAt: '2026-08-07T02:00:00.000Z',
};

const doneSecondTask = { ...doneTask, id: secondTask.id, title: secondTask.title };

describe('TodayDashboard', () => {
  beforeEach(() => {
    replace.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-07T04:00:00Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it.each(['success', 'authentication error'] as const)(
    'ignores an older refresh %s and keeps each concurrent write pending independently',
    async (staleResult) => {
      const firstWrite = deferredResponse();
      const secondWrite = deferredResponse();
      const olderRead = deferredResponse();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(snapshotWith([task, secondTask])))
        .mockReturnValueOnce(firstWrite.promise)
        .mockReturnValueOnce(secondWrite.promise)
        .mockReturnValueOnce(olderRead.promise)
        .mockResolvedValueOnce(jsonResponse(snapshotWith([doneTask, doneSecondTask])));
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      render(<TodayDashboard initialDate="2026-08-07" />);

      await user.click(await screen.findByRole('checkbox', { name: `完成任务：${task.title}` }));
      await user.click(screen.getByRole('checkbox', { name: `完成任务：${secondTask.title}` }));
      expect(screen.getByRole('checkbox', { name: `完成任务：${task.title}` })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: `完成任务：${secondTask.title}` })).toBeDisabled();

      await act(async () => firstWrite.resolve(jsonResponse({ data: doneTask })));
      expect(screen.getByRole('checkbox', { name: `完成任务：${task.title}` })).toBeEnabled();
      expect(screen.getByRole('checkbox', { name: `完成任务：${secondTask.title}` })).toBeDisabled();
      await act(async () => secondWrite.resolve(jsonResponse({ data: doneSecondTask })));
      expect(await screen.findByRole('checkbox', { name: `重新打开任务：${secondTask.title}` })).toBeChecked();

      await act(async () => {
        olderRead.resolve(
          staleResult === 'success'
            ? jsonResponse(snapshotWith([doneTask, secondTask]))
            : jsonResponse({ error: { code: 'AUTHENTICATION_REQUIRED', message: '旧请求已过期' } }, 401),
        );
      });

      expect(screen.getByRole('checkbox', { name: `重新打开任务：${task.title}` })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: `重新打开任务：${secondTask.title}` })).toBeChecked();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
      expect(screen.getByText('Core 已连接')).toBeInTheDocument();
    },
  );

  it('clears a committed draft before refresh and retries a failed read without resubmitting', async () => {
    const write = deferredResponse();
    const read = deferredResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockReturnValueOnce(write.promise)
      .mockReturnValueOnce(read.promise)
      .mockResolvedValueOnce(jsonResponse(populatedSnapshot));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard initialDate="2026-08-07" />);
    const input = await screen.findByLabelText('新任务');
    await user.type(input, task.title);
    await user.selectOptions(screen.getByLabelText('领域'), 'STUDY');
    await user.selectOptions(screen.getByLabelText('优先级'), 'HIGH');
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    expect(input).toBeDisabled();
    expect(screen.getByLabelText('领域')).toBeDisabled();
    expect(screen.getByLabelText('优先级')).toBeDisabled();
    await user.type(input, '不应插入');
    expect(input).toHaveValue(task.title);

    await act(async () => write.resolve(jsonResponse({ data: task }, 201)));
    expect(input).toBeEnabled();
    expect(input).toHaveValue('');
    await user.type(input, '保留下一份草稿');
    await act(async () => read.reject(new Error('connection lost')));

    expect(await screen.findByRole('alert')).toHaveTextContent('已保存，列表刷新失败');
    expect(input).toHaveValue('保留下一份草稿');
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findAllByText(task.title)).toHaveLength(2);
    expect(input).toHaveValue('保留下一份草稿');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(3);
  });

  it('preserves an uncommitted draft when saving fails', async () => {
    const write = deferredResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(emptySnapshot))
        .mockReturnValueOnce(write.promise),
    );
    const user = userEvent.setup();
    render(<TodayDashboard initialDate="2026-08-07" />);
    const input = await screen.findByLabelText('新任务');
    await user.type(input, '尚未保存的草稿');
    await user.selectOptions(screen.getByLabelText('领域'), 'LIFE');
    await user.click(screen.getByRole('button', { name: '添加到今天' }));
    await act(async () => write.reject(new Error('offline')));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('已保存');
    expect(input).toHaveValue('尚未保存的草稿');
    expect(input).toBeEnabled();
    expect(screen.getByLabelText('领域')).toHaveValue('LIFE');
  });

  it('recovers a version conflict by reading the current task before another status write', async () => {
    const newerTask = { ...task, version: 3 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(populatedSnapshot))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'CONFLICT', message: '任务已被更新，请刷新后重试' },
      }, 409))
      .mockResolvedValueOnce(jsonResponse(snapshotWith([newerTask])))
      .mockResolvedValueOnce(jsonResponse({ data: { ...doneTask, version: 4 } }))
      .mockResolvedValueOnce(jsonResponse(snapshotWith([{ ...doneTask, version: 4 }])));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard initialDate="2026-08-07" />);
    await user.click(await screen.findByRole('checkbox', { name: `完成任务：${task.title}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('任务已被更新');
    expect(screen.getByRole('checkbox', { name: `完成任务：${task.title}` })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(1);
    await user.click(screen.getByRole('checkbox', { name: `完成任务：${task.title}` }));
    expect(await screen.findByRole('checkbox', { name: `重新打开任务：${task.title}` })).toBeChecked();
    const writes = fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH');
    expect(writes.map(([, init]) => JSON.parse(init.body))).toEqual([
      { version: task.version, status: 'DONE' },
      { version: 3, status: 'DONE' },
    ]);
  });

  it.each(['focus', 'visibilitychange'] as const)(
    'updates the Shanghai day on %s without losing the draft or showing yesterday as today',
    async (event) => {
      const nextDayRead = deferredResponse();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(populatedSnapshot))
        .mockReturnValueOnce(nextDayRead.promise);
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      render(<TodayDashboard initialDate="2026-08-07" />);
      const input = await screen.findByLabelText('新任务');
      await user.type(input, '跨日保留');
      vi.setSystemTime(new Date('2026-08-07T16:00:01Z'));
      if (event === 'focus') fireEvent(window, new Event('focus'));
      else fireEvent(document, new Event('visibilitychange'));

      expect(screen.getByText('DAILY COMMAND CENTER / 2026-08-08')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: `完成任务：${task.title}` })).not.toBeInTheDocument();
      expect(input).toHaveValue('跨日保留');
      expect(fetchMock).toHaveBeenLastCalledWith('/api/core/today?date=2026-08-08', expect.anything());
      await act(async () => nextDayRead.resolve(jsonResponse(snapshotWith([], '2026-08-08'))));
      expect(screen.getByText('今天还没有任务')).toBeInTheDocument();
      expect(screen.getByLabelText('新任务')).toBe(input);
      expect(input).toHaveValue('跨日保留');
    },
  );

  it('rolls over at Shanghai midnight and removes its timer and listeners on unmount', async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T15:59:59Z'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(jsonResponse(snapshotWith([], '2026-08-08')));
    vi.stubGlobal('fetch', fetchMock);
    const rendered = render(<TodayDashboard initialDate="2026-08-07" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(screen.getByLabelText('新任务'), { target: { value: '午夜草稿' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText('DAILY COMMAND CENTER / 2026-08-08')).toBeInTheDocument();
    expect(screen.getByLabelText('新任务')).toHaveValue('午夜草稿');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/core/today?date=2026-08-08', expect.anything());

    rendered.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); });
    fireEvent(window, new Event('focus'));
    fireEvent(document, new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('submits to the current Shanghai day after idle even before a timer or focus event', async () => {
    const nextDayTask = { ...task, targetDate: '2026-08-08' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(jsonResponse({ data: nextDayTask }, 201))
      .mockResolvedValueOnce(jsonResponse(snapshotWith([nextDayTask], '2026-08-08')));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard initialDate="2026-08-07" />);
    await user.type(await screen.findByLabelText('新任务'), task.title);
    vi.setSystemTime(new Date('2026-08-07T16:00:01Z'));
    await user.click(screen.getByRole('button', { name: '添加到今天' }));
    expect(await screen.findByRole('checkbox', { name: `完成任务：${task.title}` })).toBeInTheDocument();
    const write = fetchMock.mock.calls.find(([, init]) => init.method === 'POST');
    expect(JSON.parse(write![1].body).targetDate).toBe('2026-08-08');
    expect(screen.getByText('DAILY COMMAND CENTER / 2026-08-08')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/core/today?date=2026-08-08', expect.anything());
    expect(screen.getByLabelText('新任务')).toHaveValue('');
  });

  it('does not restore yesterday when its refresh and a pending mutation finish after rollover', async () => {
    const olderRead = deferredResponse();
    const olderWrite = deferredResponse();
    const nextDayTask = { ...secondTask, title: '新一天任务', targetDate: '2026-08-08' };
    const nextDaySnapshot = snapshotWith([nextDayTask], '2026-08-08');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshotWith([task, secondTask])))
      .mockResolvedValueOnce(jsonResponse({ data: doneTask }))
      .mockReturnValueOnce(olderRead.promise)
      .mockReturnValueOnce(olderWrite.promise)
      .mockResolvedValueOnce(jsonResponse(nextDaySnapshot))
      .mockResolvedValueOnce(jsonResponse(nextDaySnapshot));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<TodayDashboard initialDate="2026-08-07" />);
    await user.click(await screen.findByRole('checkbox', { name: `完成任务：${task.title}` }));
    await user.click(screen.getByRole('checkbox', { name: `完成任务：${secondTask.title}` }));
    await user.type(screen.getByLabelText('新任务'), '另一份跨日草稿');
    vi.setSystemTime(new Date('2026-08-07T16:00:01Z'));
    fireEvent(window, new Event('focus'));
    expect(await screen.findByRole('checkbox', { name: `完成任务：${nextDayTask.title}` })).toBeInTheDocument();

    await act(async () => olderRead.resolve(jsonResponse(snapshotWith([doneTask, secondTask]))));
    expect(screen.queryByRole('checkbox', { name: `重新打开任务：${task.title}` })).not.toBeInTheDocument();
    await act(async () => olderWrite.resolve(jsonResponse({ data: doneSecondTask })));
    expect(screen.getByRole('checkbox', { name: `完成任务：${nextDayTask.title}` })).toBeEnabled();
    expect(screen.getByText('DAILY COMMAND CENTER / 2026-08-08')).toBeInTheDocument();
    expect(screen.getByLabelText('新任务')).toHaveValue('另一份跨日草稿');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/core/today?date=2026-08-08', expect.anything());
  });
});
