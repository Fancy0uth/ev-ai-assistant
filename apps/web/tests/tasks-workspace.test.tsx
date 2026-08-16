import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@ev/contracts';
import { TasksWorkspace } from '@/components/tasks/tasks-workspace';

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));

const task: Task = {
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
  items: Task[] = [task],
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

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call: number): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

function mutationResponse(responseTask = task): Response {
  return jsonResponse({ data: responseTask });
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

  it('keeps every task control at the mobile font and touch-target floor despite editor button specificity', () => {
    const dashboardCss = readFileSync(resolve(process.cwd(), 'src/app/dashboard.css'), 'utf8');
    const mobileCss = dashboardCss;
    const mobileControlRule = mobileCss.match(
      /\.task-composer input,[\s\S]*?\.tasks-pagination button\s*\{[\s\S]*?\}/,
    )?.[0];
    const mobileEditorActionRule = mobileCss.match(
      /\.task-editor__actions button:first-child,\s*\.task-editor__actions button:last-child\s*\{[\s\S]*?\}/,
    )?.[0];

    expect(mobileControlRule).toBeDefined();
    expect(mobileControlRule).toContain('min-height: 2.75rem;');
    expect(mobileControlRule).toContain('font-size: 1rem;');
    expect(mobileControlRule).toContain('.task-composer input');
    expect(mobileControlRule).toContain('.task-composer select');
    expect(mobileControlRule).toContain('.composer-submit');
    expect(mobileControlRule).toContain('.task-secondary-action');
    expect(mobileControlRule).toContain('.tasks-filters input');
    expect(mobileControlRule).toContain('.tasks-filters select');
    expect(mobileControlRule).toContain('.task-creator > button');
    expect(mobileControlRule).toContain('.task-editor__fields input');
    expect(mobileControlRule).toContain('.task-editor__fields select');
    expect(mobileControlRule).toContain('.task-editor__actions button');
    expect(mobileControlRule).toContain('.task-defer-control input');
    expect(mobileControlRule).toContain('.task-defer-control button');
    expect(mobileControlRule).toContain('.task-edit-button');
    expect(mobileControlRule).toContain('.task-actions > button');
    expect(mobileControlRule).toContain('.tasks-failure button');
    expect(mobileEditorActionRule).toBeDefined();
    expect(mobileEditorActionRule).toContain('min-height: 2.75rem;');
    expect(mobileEditorActionRule).toContain('font-size: 1rem;');
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

  it('creates a nullable-date task once, resets the form, and reloads the current page once', async () => {
    const createdTask: Task = {
      ...task,
      id: '00000000-0000-4000-8000-000000000013',
      title: '整理本周项目进度',
      priority: 'MEDIUM',
      targetDate: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(createdTask))
      .mockResolvedValueOnce(taskResponse([createdTask]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace('area=WORK');
    await screen.findByText(task.title);

    await user.type(screen.getByLabelText('新建任务标题'), createdTask.title);
    await user.selectOptions(screen.getByLabelText('新建任务优先级'), 'MEDIUM');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestUrl(fetchMock, 1)).toBe('/api/core/tasks');
    expect(requestBody(fetchMock, 1)).toEqual({
      title: createdTask.title,
      area: 'WORK',
      priority: 'MEDIUM',
      targetDate: null,
    });
    expect(screen.getByLabelText('新建任务标题')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('任务已创建');
  });

  it('keeps the creation form and current list when a successful mutation body fails task schema validation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { id: task.id, title: '缺少任务字段' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.type(screen.getByLabelText('新建任务标题'), '需要完整响应的任务');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('任务数据格式无法识别');
    expect(screen.getByLabelText('新建任务标题')).toHaveValue('需要完整响应的任务');
    expect(screen.getByText(task.title)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('edits a task with its current version and returns focus to the edit control', async () => {
    const editedTask: Task = {
      ...task,
      title: '更新后的跨时区筛选核对',
      area: 'STUDY',
      priority: 'LOW',
      targetDate: '2026-08-18',
      version: 2,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(editedTask))
      .mockResolvedValueOnce(taskResponse([editedTask]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);

    await user.click(screen.getByRole('button', { name: `编辑任务：${task.title}` }));
    const titleField = await screen.findByLabelText('编辑任务标题');
    expect(titleField).toHaveFocus();
    await user.clear(titleField);
    await user.type(titleField, editedTask.title);
    await user.selectOptions(screen.getByLabelText('编辑任务领域'), editedTask.area);
    await user.selectOptions(screen.getByLabelText('编辑任务优先级'), editedTask.priority);
    fireEvent.change(screen.getByLabelText('编辑任务目标日期'), {
      target: { value: editedTask.targetDate },
    });
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestUrl(fetchMock, 1)).toBe(`/api/core/tasks/${task.id}`);
    expect(requestBody(fetchMock, 1)).toEqual({
      version: 1,
      title: editedTask.title,
      area: 'STUDY',
      priority: 'LOW',
      targetDate: '2026-08-18',
    });
    expect(screen.getByRole('button', { name: `编辑任务：${editedTask.title}` })).toHaveFocus();
  });

  it('keeps an unsaved editor draft when another task mutation reloads the same task version', async () => {
    const otherTask: Task = {
      ...task,
      id: '00000000-0000-4000-8000-000000000015',
      title: '另一个需要完成的任务',
    };
    const completedOtherTask: Task = {
      ...otherTask,
      status: 'DONE',
      version: 2,
      completedAt: '2026-08-10T02:00:00.000Z',
    };
    const draftTitle = '尚未保存的编辑草稿';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse([task, otherTask]))
      .mockResolvedValueOnce(mutationResponse(completedOtherTask))
      .mockResolvedValueOnce(taskResponse([task, completedOtherTask]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `编辑任务：${task.title}` }));
    const titleField = await screen.findByLabelText('编辑任务标题');
    await user.clear(titleField);
    await user.type(titleField, draftTitle);

    await user.click(screen.getByRole('button', { name: `完成任务：${otherTask.title}` }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(titleField).toHaveValue(draftTitle);
    expect(requestUrl(fetchMock, 1)).toBe(`/api/core/tasks/${otherTask.id}`);
    expect(requestBody(fetchMock, 1)).toEqual({ version: 1, status: 'DONE' });
  });

  it('returns focus to the edit trigger immediately when editing is cancelled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    const editTrigger = screen.getByRole('button', { name: `编辑任务：${task.title}` });
    await user.click(editTrigger);
    await screen.findByLabelText('编辑任务标题');
    await user.click(screen.getByRole('button', { name: '取消编辑' }));

    expect(editTrigger).toHaveFocus();
  });

  it('moves focus to the stable Tasks heading when a saved task disappears from the filtered page', async () => {
    const editedTask: Task = { ...task, area: 'STUDY', version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(editedTask))
      .mockResolvedValueOnce(taskResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace('area=WORK');
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `编辑任务：${task.title}` }));
    await user.selectOptions(screen.getByLabelText('编辑任务领域'), 'STUDY');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestUrl(fetchMock, 1)).toBe(`/api/core/tasks/${task.id}`);
    expect(requestBody(fetchMock, 1)).toEqual({
      version: 1,
      title: task.title,
      area: 'STUDY',
      priority: task.priority,
      targetDate: task.targetDate,
    });
    expect(screen.getByRole('heading', { name: '任务工作台' })).toHaveFocus();
  });

  it('completes a task with exactly the current version and one write request', async () => {
    const completedTask: Task = {
      ...task,
      status: 'DONE',
      version: 2,
      completedAt: '2026-08-10T02:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(completedTask))
      .mockResolvedValueOnce(taskResponse([completedTask]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `完成任务：${task.title}` }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestBody(fetchMock, 1)).toEqual({ version: 1, status: 'DONE' });
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'PATCH')).toHaveLength(1);
  });

  it('keeps the last complete filtered page after a successful patch reload fails', async () => {
    const completedTask: Task = {
      ...task,
      status: 'DONE',
      version: 2,
      completedAt: '2026-08-10T02:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(completedTask))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CORE_UNAVAILABLE', message: '本地 Core 暂时不可用，请确认服务已启动' } },
          502,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace('status=IN_PROGRESS');
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `完成任务：${task.title}` }));

    expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败');
    expect(requestUrl(fetchMock, 0)).toBe('/api/core/tasks?page=1&pageSize=20&status=IN_PROGRESS');
    expect(requestUrl(fetchMock, 1)).toBe(`/api/core/tasks/${task.id}`);
    expect(requestBody(fetchMock, 1)).toEqual({ version: 1, status: 'DONE' });
    expect(requestUrl(fetchMock, 2)).toBe('/api/core/tasks?page=1&pageSize=20&status=IN_PROGRESS');
    const taskList = within(screen.getByRole('list', { name: '任务列表' }));
    expect(taskList.getByText('进行中')).toBeInTheDocument();
    expect(taskList.queryByText('已完成')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'PATCH')).toHaveLength(1);
  });

  it('rejects a successful patch response for a different resource without replacing the trusted page', async () => {
    const otherTask: Task = {
      ...task,
      id: '00000000-0000-4000-8000-000000000016',
      title: '页面中的另一项任务',
    };
    const mismatchedTask: Task = {
      ...otherTask,
      title: '不可信的错误资源响应',
      status: 'DONE',
      version: 2,
      completedAt: '2026-08-10T02:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse([task, otherTask]))
      .mockResolvedValueOnce(mutationResponse(mismatchedTask));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `完成任务：${task.title}` }));

    expect(await screen.findByRole('alert')).toHaveTextContent('任务响应与请求不一致');
    expect(requestUrl(fetchMock, 1)).toBe(`/api/core/tasks/${task.id}`);
    expect(requestBody(fetchMock, 1)).toEqual({ version: 1, status: 'DONE' });
    expect(screen.getByText(otherTask.title)).toBeInTheDocument();
    expect(screen.queryByText(mismatchedTask.title)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reveals the deferred date control, retains its value, and sends an explicitly changed date', async () => {
    const deferredTask: Task = { ...task, status: 'DEFERRED', targetDate: '2026-08-20', version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(deferredTask))
      .mockResolvedValueOnce(taskResponse([deferredTask]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `延期任务：${task.title}` }));

    const targetDateField = screen.getByLabelText('延期目标日期');
    expect(targetDateField).toHaveValue('2026-08-10');
    fireEvent.change(targetDateField, { target: { value: '2026-08-20' } });
    await user.click(screen.getByRole('button', { name: '确认延期' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestBody(fetchMock, 1)).toEqual({
      version: 1,
      status: 'DEFERRED',
      targetDate: '2026-08-20',
    });
  });

  it('allows a deferred task date to be cleared explicitly', async () => {
    const deferredTask: Task = { ...task, status: 'DEFERRED', targetDate: null, version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(deferredTask))
      .mockResolvedValueOnce(taskResponse([deferredTask]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `延期任务：${task.title}` }));
    fireEvent.change(screen.getByLabelText('延期目标日期'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: '确认延期' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestBody(fetchMock, 1)).toEqual({ version: 1, status: 'DEFERRED', targetDate: null });
  });

  it('cancels a task with its current version', async () => {
    const cancelledTask: Task = { ...task, status: 'CANCELLED', version: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(cancelledTask))
      .mockResolvedValueOnce(taskResponse([cancelledTask]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `取消任务：${task.title}` }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestBody(fetchMock, 1)).toEqual({ version: 1, status: 'CANCELLED' });
  });

  it('uses a validated conflict currentTask, persists the conflict alert, and never retries the patch', async () => {
    const currentTask = {
      ...task,
      title: '服务器上的最新任务内容',
      status: 'IN_PROGRESS',
      version: 2,
      updatedAt: '2026-08-10T03:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'VERSION_CONFLICT',
              message: '数据已变化，请确认最新内容后重试',
              details: { currentTask },
            },
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `完成任务：${task.title}` }));

    expect(await screen.findByRole('alert')).toHaveTextContent('服务器上的最新版本');
    expect(screen.getByText(currentTask.title)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1)).toEqual({ version: 1, status: 'DONE' });
  });

  it('rejects a version-conflict currentTask for a different resource without replacing the trusted page', async () => {
    const otherTask: Task = {
      ...task,
      id: '00000000-0000-4000-8000-000000000017',
      title: '冲突前页面中的另一项任务',
    };
    const mismatchedCurrentTask: Task = {
      ...otherTask,
      title: '不可信的冲突资源响应',
      version: 2,
      updatedAt: '2026-08-10T03:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse([task, otherTask]))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'VERSION_CONFLICT',
              message: '数据已变化，请确认最新内容后重试',
              details: { currentTask: mismatchedCurrentTask },
            },
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `完成任务：${task.title}` }));

    expect(await screen.findByRole('alert')).toHaveTextContent('任务响应与请求不一致');
    expect(requestUrl(fetchMock, 1)).toBe(`/api/core/tasks/${task.id}`);
    expect(requestBody(fetchMock, 1)).toEqual({ version: 1, status: 'DONE' });
    expect(screen.getByText(otherTask.title)).toBeInTheDocument();
    expect(screen.queryByText(mismatchedCurrentTask.title)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not replace the trusted list when version-conflict details are malformed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'VERSION_CONFLICT',
              message: '数据已变化，请确认最新内容后重试',
              details: { currentTask: { id: task.id, title: '不可信的残缺内容' } },
            },
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `完成任务：${task.title}` }));

    expect(await screen.findByRole('alert')).toHaveTextContent('最新数据格式无法识别');
    expect(screen.getByText(task.title)).toBeInTheDocument();
    expect(screen.queryByText('不可信的残缺内容')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves the task list for a non-authentication mutation failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CORE_UNAVAILABLE', message: '本地 Core 暂时不可用，请确认服务已启动' } },
          502,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `完成任务：${task.title}` }));

    expect(await screen.findByRole('alert')).toHaveTextContent('本地 Core 暂时不可用');
    expect(screen.getByText(task.title)).toBeInTheDocument();
  });

  it('redirects a canonical mutation 401 to login without discarding the current list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' } },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.click(screen.getByRole('button', { name: `完成任务：${task.title}` }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.getByText(task.title)).toBeInTheDocument();
  });

  it('does not repeat a successful write when its one reload fails', async () => {
    const createdTask: Task = {
      ...task,
      id: '00000000-0000-4000-8000-000000000014',
      title: '保存后刷新失败的任务',
      targetDate: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(taskResponse())
      .mockResolvedValueOnce(mutationResponse(createdTask))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CORE_UNAVAILABLE', message: '本地 Core 暂时不可用，请确认服务已启动' } },
          502,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    renderWorkspace();
    await screen.findByText(task.title);
    await user.type(screen.getByLabelText('新建任务标题'), createdTask.title);
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('刷新失败');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'POST')).toHaveLength(1);
    expect(screen.getByText(task.title)).toBeInTheDocument();
  });

  it('does not expose state-changing actions for terminal tasks', async () => {
    const doneTask: Task = {
      ...task,
      id: '00000000-0000-4000-8000-000000000018',
      title: '已完成的终态任务',
      status: 'DONE',
      version: 2,
      completedAt: '2026-08-10T02:00:00.000Z',
    };
    const cancelledTask: Task = {
      ...task,
      id: '00000000-0000-4000-8000-000000000019',
      title: '已取消的终态任务',
      status: 'CANCELLED',
      version: 2,
    };
    const fetchMock = vi.fn().mockResolvedValue(taskResponse([doneTask, cancelledTask]));
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace();
    await screen.findByText(doneTask.title);
    expect(screen.queryByRole('button', { name: `完成任务：${doneTask.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `延期任务：${doneTask.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `取消任务：${doneTask.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `完成任务：${cancelledTask.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `延期任务：${cancelledTask.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `取消任务：${cancelledTask.title}` })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders task metadata with the frozen mutation controls but no delete, bulk, drag, calendar, or reopen UI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskResponse());
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace();

    expect(await screen.findByText(task.title)).toBeInTheDocument();
    const taskList = within(screen.getByRole('list', { name: '任务列表' }));
    expect(taskList.getByText('工作')).toBeInTheDocument();
    expect(taskList.getByText('高优先级')).toBeInTheDocument();
    expect(taskList.getByText('进行中')).toBeInTheDocument();
    expect(taskList.getByText('目标日期：2026-08-10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `编辑任务：${task.title}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `完成任务：${task.title}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `延期任务：${task.title}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `取消任务：${task.title}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除|批量|拖拽|日历|重新打开|恢复/ })).not.toBeInTheDocument();
  });
});
