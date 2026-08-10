import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksWorkspace } from '@/components/tasks/tasks-workspace';

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));

const task = {
  id: '00000000-0000-4000-8000-000000000011',
  title: '核对跨时区的任务筛选',
  area: 'WORK',
  priority: 'HIGH',
  status: 'IN_PROGRESS',
  targetDate: '2026-08-10',
  completedAt: null,
  version: 1,
  createdAt: '2026-08-10T01:00:00.000Z',
  updatedAt: '2026-08-10T01:00:00.000Z',
};

function taskResponse(
  items = [task],
  pagination = { page: 1, pageSize: 20, total: 1, totalPages: 1 },
): Response {
  return jsonResponse({ data: { items, pagination } });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(fetchMock: ReturnType<typeof vi.fn>, call = 0): string {
  return String(fetchMock.mock.calls[call]?.[0]);
}

function renderWorkspace(query = '') {
  searchParams = new URLSearchParams(query);
  return render(<TasksWorkspace />);
}

describe('TasksWorkspace', () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
  });

  it.each([
    ['WORK', '/api/core/tasks?page=1&pageSize=20&area=WORK'],
    ['STUDY', '/api/core/tasks?page=1&pageSize=20&area=STUDY'],
    ['LIFE', '/api/core/tasks?page=1&pageSize=20&area=LIFE'],
  ])('forwards the allowed %s area filter exactly', async (area, expectedUrl) => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse());
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace(`area=${area}`);

    await screen.findByText(task.title);
    expect(requestUrl(fetchMock)).toBe(expectedUrl);
  });

  it.each([
    ['OPEN', '/api/core/tasks?page=1&pageSize=20&status=OPEN'],
    ['IN_PROGRESS', '/api/core/tasks?page=1&pageSize=20&status=IN_PROGRESS'],
    ['DONE', '/api/core/tasks?page=1&pageSize=20&status=DONE'],
    ['DEFERRED', '/api/core/tasks?page=1&pageSize=20&status=DEFERRED'],
    ['CANCELLED', '/api/core/tasks?page=1&pageSize=20&status=CANCELLED'],
  ])('forwards the allowed %s status filter exactly', async (status, expectedUrl) => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse());
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace(`status=${status}`);

    await screen.findByText(task.title);
    expect(requestUrl(fetchMock)).toBe(expectedUrl);
  });

  it.each([
    ['today', '/api/core/tasks?page=1&pageSize=20&targetDate=2026-08-10'],
    [
      'future',
      '/api/core/tasks?page=1&pageSize=20&dateScope=FUTURE&referenceDate=2026-08-10',
    ],
    ['undated', '/api/core/tasks?page=1&pageSize=20&dateScope=UNDATED'],
    ['', '/api/core/tasks?page=1&pageSize=20'],
  ])('maps date=%s to the exact Core query', async (date, expectedUrl) => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse());
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace(date ? `date=${date}` : '');

    await screen.findByText(task.title);
    expect(requestUrl(fetchMock)).toBe(expectedUrl);
  });

  it('treats unknown URL values as defaults and never sends them to Core', async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse());
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace('page=not-a-number&area=OTHER&status=PAUSED&date=this-week');

    await screen.findByText(task.title);
    expect(requestUrl(fetchMock)).toBe('/api/core/tasks?page=1&pageSize=20');
    expect(screen.getByLabelText('领域筛选')).toHaveValue('');
    expect(screen.getByLabelText('状态筛选')).toHaveValue('');
    expect(screen.getByLabelText('目标日期筛选')).toHaveValue('');
  });

  it('puts filter changes in browser history and resets the page to one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace('page=3&area=WORK&status=OPEN&date=future');
    await screen.findByText(task.title);

    await user.selectOptions(screen.getByLabelText('领域筛选'), 'LIFE');

    expect(push).toHaveBeenCalledWith('/tasks?page=1&area=LIFE&status=OPEN&date=future');
  });

  it('preserves valid filters when changing server pagination pages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      taskResponse([task], { page: 2, pageSize: 20, total: 65, totalPages: 4 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace('page=2&area=WORK&status=OPEN&date=undated');
    await screen.findByText(task.title);

    await user.click(screen.getByRole('button', { name: '下一页' }));

    expect(push).toHaveBeenCalledWith('/tasks?page=3&area=WORK&status=OPEN&date=undated');
  });

  it('suppresses a stale response after the URL changes to a newer request', async () => {
    let resolveFirstResponse: ((value: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirstResponse = resolve;
    });
    const newestTask = { ...task, id: '00000000-0000-4000-8000-000000000012', title: '最新筛选结果' };
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(taskResponse([newestTask]));
    vi.stubGlobal('fetch', fetchMock);

    const rendered = renderWorkspace('area=WORK');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    searchParams = new URLSearchParams('area=LIFE');
    rendered.rerender(<TasksWorkspace />);

    expect(await screen.findByText(newestTask.title)).toBeInTheDocument();
    resolveFirstResponse?.(taskResponse());
    await vi.runAllTimersAsync();

    expect(screen.queryByText(task.title)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows loading immediately for deferred query and retry requests', async () => {
    let resolveQueryResponse: ((value: Response) => void) | undefined;
    let resolveRetryResponse: ((value: Response) => void) | undefined;
    const queryResponse = new Promise<Response>((resolve) => {
      resolveQueryResponse = resolve;
    });
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetryResponse = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockReturnValueOnce(queryResponse)
      .mockReturnValueOnce(retryResponse);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const rendered = renderWorkspace('area=WORK');
    expect(await screen.findByText(task.title)).toBeInTheDocument();

    searchParams = new URLSearchParams('area=LIFE');
    rendered.rerender(<TasksWorkspace />);
    expect(screen.getByLabelText('正在加载任务')).toBeInTheDocument();

    resolveQueryResponse?.(
      jsonResponse(
        { error: { code: 'CORE_UNAVAILABLE', message: '本地 Core 暂时不可用，请确认服务已启动' } },
        502,
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('本地 Core 暂时不可用');

    await user.click(screen.getByRole('button', { name: '重新加载' }));
    expect(screen.getByLabelText('正在加载任务')).toBeInTheDocument();

    resolveRetryResponse?.(taskResponse());
    expect(await screen.findByText(task.title)).toBeInTheDocument();
  });

  it('keeps empty results distinct from the loading state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace();

    expect(screen.getByLabelText('正在加载任务')).toBeInTheDocument();
    expect(await screen.findByText('没有匹配的任务')).toBeInTheDocument();
  });

  it('shows a retryable error when Core fails and reloads the current page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CORE_UNAVAILABLE', message: '本地 Core 暂时不可用，请确认服务已启动' } },
          502,
        ),
      )
      .mockResolvedValueOnce(taskResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace('page=2&area=STUDY');

    expect(await screen.findByRole('alert')).toHaveTextContent('本地 Core 暂时不可用');
    await user.click(screen.getByRole('button', { name: '重新加载' }));

    expect(await screen.findByText(task.title)).toBeInTheDocument();
    expect(requestUrl(fetchMock, 1)).toBe('/api/core/tasks?page=2&pageSize=20&area=STUDY');
  });

  it('redirects only a canonical authentication error to login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' } },
          401,
        ),
      ),
    );

    renderWorkspace();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a malformed 401 visible and retryable instead of redirecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: 401, message: '请先登录本地账号' } }, 401),
      ),
    );

    renderWorkspace();

    expect(await screen.findByRole('alert')).toHaveTextContent('请求未能完成，请稍后重试');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled();
  });

  it('rejects malformed successful task responses instead of rendering unvalidated data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ data: { items: [{ title: '缺少任务字段' }], pagination: {} } }),
      ),
    );

    renderWorkspace();

    expect(await screen.findByRole('alert')).toHaveTextContent('任务数据格式无法识别');
    expect(screen.queryByText('缺少任务字段')).not.toBeInTheDocument();
  });

  it('renders task metadata read-only without mutation controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse());
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace();

    expect(await screen.findByText(task.title)).toBeInTheDocument();
    const taskList = within(screen.getByRole('list', { name: '任务列表' }));
    expect(taskList.getByText('工作')).toBeInTheDocument();
    expect(taskList.getByText('高优先级')).toBeInTheDocument();
    expect(taskList.getByText('进行中')).toBeInTheDocument();
    expect(taskList.getByText('目标日期：2026-08-10')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /新建|创建|编辑|完成|延期|取消任务/ }),
    ).not.toBeInTheDocument();
  });
});
