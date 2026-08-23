import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const unbrokenTaskTitle = 'x'.repeat(200);

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

const recoverySnapshot = {
  data: {
    ...emptySnapshot.data,
    signals: [
      {
        id: '00000000-0000-4000-8000-000000000111',
        localDate: '2026-08-07',
        kind: 'RECOVERY',
        value: 25,
        source: 'CHECK_IN',
        version: 1,
        createdAt: '2026-08-07T01:00:00.000Z',
        updatedAt: '2026-08-07T01:00:00.000Z',
      },
    ],
  },
};

const longTitleSnapshot = {
  data: {
    ...populatedSnapshot.data,
    status: {
      ...populatedSnapshot.data.status,
      priorities: [
        {
          ...populatedSnapshot.data.status.priorities[0],
          title: unbrokenTaskTitle,
        },
      ],
    },
    tasks: [{ ...task, title: unbrokenTaskTitle }],
  },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call: number): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
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

    expect(await screen.findAllByText(task.title)).toHaveLength(3);
    expect(screen.getAllByText('规则引擎')).toHaveLength(1);
    expect(screen.queryByText('Milestone 0.6')).not.toBeInTheDocument();
    const renderedIds = Array.from(document.querySelectorAll('[id]'), ({ id }) => id);
    expect(new Set(renderedIds).size).toBe(renderedIds.length);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows the latest local recovery signal as a decision input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(recoverySnapshot)));

    render(<TodayDashboard initialDate="2026-08-07" />);

    expect(await screen.findByText('恢复状态')).toBeInTheDocument();
    expect(screen.getAllByText('注意恢复')).toHaveLength(2);
    expect(screen.getByText('25 / 100')).toBeInTheDocument();
    expect(screen.getByText('来自本地打卡，不构成医疗判断')).toBeInTheDocument();
  });

  it('puts today\'s schedule, concrete actions, recovery summary, and plan review entry in the control console', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        ...recoverySnapshot.data,
        tasks: [task],
        events: [
          {
            id: '00000000-0000-4000-8000-000000000222',
            calendarRuleId: null,
            title: '深度学习课程',
            kind: 'COURSE',
            localDate: '2026-08-07',
            startLocalTime: '09:00',
            endLocalTime: '10:40',
            isHard: true,
            status: 'CONFIRMED',
            version: 1,
            createdAt: '2026-08-07T01:00:00.000Z',
            updatedAt: '2026-08-07T01:00:00.000Z',
          },
        ],
        dailyPlan: {
          status: 'PENDING_REVIEW',
          proposalId: '00000000-0000-4000-8000-000000000333',
          pendingItemCount: 2,
        },
      },
    })));

    render(<TodayDashboard initialDate="2026-08-07" />);

    expect(await screen.findByRole('heading', { name: '今天的控制台' })).toBeInTheDocument();
    expect(screen.getByText('深度学习课程')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `在控制台处理开发任务：${task.title}` })).toHaveAttribute('href', '/projects');
    expect(document.querySelector('.day-console__recovery')).toHaveTextContent('注意恢复');
    expect(screen.getByText(/有 2 项建议等待你的审核/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看并确认今日计划' })).toHaveAttribute(
      'href',
      '/daily-plan?date=2026-08-07',
    );
  });

  it('links each daily domain to its dedicated workspace instead of a generic todo flow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(emptySnapshot)));

    render(<TodayDashboard initialDate="2026-08-07" />);

    await screen.findByText('今天还没有任务');
    expect(screen.getByRole('link', { name: '打开日程与课表模块' })).toHaveAttribute('href', '/schedule');
    expect(screen.getByRole('link', { name: '打开学习模块' })).toHaveAttribute('href', '/learning');
    expect(screen.getByRole('link', { name: '打开训练恢复模块' })).toHaveAttribute('href', '/fitness');
    expect(screen.getByRole('link', { name: '打开饮食模块' })).toHaveAttribute('href', '/nutrition');
    expect(screen.getByRole('link', { name: '打开项目模块' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: '打开记忆模块' })).toHaveAttribute('href', '/memory');
  });

  it('gives a concrete work task a direct route into its domain workspace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(populatedSnapshot)));

    render(<TodayDashboard initialDate="2026-08-07" />);

    expect(await screen.findByRole('link', { name: `处理开发任务：${task.title}` })).toHaveAttribute(
      'href',
      '/projects',
    );
  });

  it('acknowledges a schema-valid create before its background Today projection settles', async () => {
    const unresolvedProjection = new Promise<Response>(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(jsonResponse({ data: task }, 201))
      .mockReturnValueOnce(unresolvedProjection);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate="2026-08-07" />);
    await screen.findByText('今天还没有任务');

    await user.type(screen.getByLabelText('新任务'), task.title);
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('新任务')).toHaveValue('');
    expect(screen.getByRole('button', { name: '添加到今天' })).toBeEnabled();
    const refreshStatus = screen.getByText('正在刷新今天的数据', { selector: '.core-connection' });
    expect(refreshStatus).toHaveAttribute('aria-busy', 'true');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/tasks')).toHaveLength(1);
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/core/today?date=2026-08-07');
  });

  it('keeps a schema-valid saved task separate from a failed Today projection refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(jsonResponse({ data: task }, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CORE_UNAVAILABLE', message: '今天的数据刷新失败' } },
          503,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(populatedSnapshot));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate="2026-08-07" />);
    await screen.findByText('今天还没有任务');

    await user.type(screen.getByLabelText('新任务'), task.title);
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    expect(await screen.findByText('任务已保存，但今天的数据刷新失败')).toBeInTheDocument();
    expect(screen.getByLabelText('新任务')).toHaveValue('');
    expect(requestBody(fetchMock, 1)).toEqual({
      title: task.title,
      area: 'WORK',
      priority: 'MEDIUM',
      targetDate: '2026-08-07',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole('button', { name: '重新加载今天的数据' }));

    expect(await screen.findAllByText(task.title)).toHaveLength(3);
    expect(screen.queryByText('任务已保存，但今天的数据刷新失败')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/tasks')).toHaveLength(1);
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/core/today?date=2026-08-07');
  });

  it('preserves the draft and snapshot when the create response is malformed without refreshing Today', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(jsonResponse({ data: { id: task.id } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate="2026-08-07" />);
    await screen.findByText('今天还没有任务');

    await user.type(screen.getByLabelText('新任务'), task.title);
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('新任务')).toHaveValue(task.title);
    expect(screen.getByText('今天还没有任务')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves the draft and snapshot when the create request fails without refreshing Today', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'TASK_CREATE_FAILED', message: '任务未保存，请稍后重试' } },
          500,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate="2026-08-07" />);
    await screen.findByText('今天还没有任务');

    await user.type(screen.getByLabelText('新任务'), task.title);
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    expect(await screen.findByText('任务未保存，请稍后重试')).toBeInTheDocument();
    expect(screen.getByLabelText('新任务')).toHaveValue(task.title);
    expect(screen.getByText('今天还没有任务')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a later create failure visible while a saved task still needs projection recovery', async () => {
    const secondTitle = '补充今天的真实任务';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(jsonResponse({ data: task }, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CORE_UNAVAILABLE', message: '今天的数据刷新失败' } },
          503,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'TASK_CREATE_FAILED', message: '补充任务未保存，请稍后重试' } },
          500,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate="2026-08-07" />);
    await screen.findByText('今天还没有任务');

    await user.type(screen.getByLabelText('新任务'), task.title);
    await user.click(screen.getByRole('button', { name: '添加到今天' }));
    await screen.findByText('任务已保存，但今天的数据刷新失败');

    await user.type(screen.getByLabelText('新任务'), secondTitle);
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    expect(await screen.findByText('补充任务未保存，请稍后重试')).toBeInTheDocument();
    expect(screen.getByText('任务已保存，但今天的数据刷新失败')).toBeInTheDocument();
    expect(screen.getByLabelText('新任务')).toHaveValue(secondTitle);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps canonical authentication errors routed to login after a create attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySnapshot))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' } },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate="2026-08-07" />);
    await screen.findByText('今天还没有任务');

    await user.type(screen.getByLabelText('新任务'), task.title);
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.getByLabelText('新任务')).toHaveValue(task.title);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends one POST when the same composer submit is dispatched twice before the response returns', async () => {
    const unresolvedPost = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(emptySnapshot)).mockReturnValue(unresolvedPost);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate="2026-08-07" />);
    await screen.findByText('今天还没有任务');

    await user.type(screen.getByLabelText('新任务'), task.title);
    const form = screen.getByRole('button', { name: '添加到今天' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/tasks')).toHaveLength(1);
  });

  it('keeps unbroken Today task and priority titles inside explicit shrink-or-truncate chains', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(longTitleSnapshot));
    vi.stubGlobal('fetch', fetchMock);

    render(<TodayDashboard initialDate="2026-08-07" />);

    expect(unbrokenTaskTitle).toHaveLength(200);
    expect(await screen.findAllByText(unbrokenTaskTitle)).toHaveLength(3);
    expect(screen.getByText(unbrokenTaskTitle, { selector: '.task-row__titleline p' }).closest('.task-row__content')).not.toBeNull();
    expect(screen.getByText(unbrokenTaskTitle, { selector: '.priority-list p' }).closest('.priority-list li')).not.toBeNull();

    const dashboardCss = readFileSync(resolve(process.cwd(), 'src/app/dashboard.css'), 'utf8');
    const taskContentRule = dashboardCss.match(/\.task-row__content\s*\{[\s\S]*?\n\}/)?.[0];
    const taskTitleRule = dashboardCss.match(/\.task-row__titleline p\s*\{[\s\S]*?\n\}/)?.[0];
    const mobileDashboardCss = dashboardCss.slice(dashboardCss.indexOf('@media (max-width: 42rem) {'));
    const mobileTitlelineRule = mobileDashboardCss.match(/\.task-row__titleline\s*\{[\s\S]*?\n\s*\}/)?.[0];
    const mobileTaskTitleRule = mobileDashboardCss.match(/\.task-row__titleline p\s*\{[\s\S]*?\n\s*\}/)?.[0];
    const priorityItemRule = dashboardCss.match(/\.priority-list li\s*\{[\s\S]*?\n\}/)?.[0];
    const priorityTitleRule = dashboardCss.match(/\.priority-list p\s*\{[\s\S]*?\n\}/)?.[0];

    expect(taskContentRule).toContain('min-width: 0;');
    expect(taskTitleRule).toContain('overflow: hidden;');
    expect(mobileTitlelineRule).toContain('align-items: stretch;');
    expect(mobileTitlelineRule).toContain('min-width: 0;');
    expect(mobileTitlelineRule).toContain('width: 100%;');
    expect(mobileTitlelineRule).toContain('max-width: 100%;');
    expect(mobileTaskTitleRule).toContain('min-width: 0;');
    expect(mobileTaskTitleRule).toContain('width: 100%;');
    expect(mobileTaskTitleRule).toContain('max-width: 100%;');
    expect(priorityItemRule).toContain('grid-template-columns: auto minmax(0, 1fr) auto;');
    expect(priorityItemRule).toContain('min-width: 0;');
    expect(priorityTitleRule).toContain('min-width: 0;');
    expect(priorityTitleRule).toContain('overflow: hidden;');
  });

  it('keeps Today composer controls at the established mobile font and touch-target floor', () => {
    const dashboardCss = readFileSync(resolve(process.cwd(), 'src/app/dashboard.css'), 'utf8');
    const mobileCss = dashboardCss;
    const mobileComposerRule = mobileCss.match(
      /\.task-composer input,[\s\S]*?\.tasks-pagination button\s*\{[\s\S]*?\n\}/,
    )?.[0];

    expect(mobileComposerRule).toBeDefined();
    expect(mobileComposerRule).toContain('.task-composer input');
    expect(mobileComposerRule).toContain('.task-composer select');
    expect(mobileComposerRule).toContain('.composer-submit');
    expect(mobileComposerRule).toContain('min-height: 2.75rem;');
    expect(mobileComposerRule).toContain('font-size: 1rem;');
  });

  it('keeps the daily control console readable on desktop and stacked on iPhone widths', () => {
    const dashboardCss = readFileSync(resolve(process.cwd(), 'src/app/dashboard.css'), 'utf8');
    const controlGridRule = dashboardCss.match(
      /\.day-console__grid\s*\{\s*display: grid;[\s\S]*?\n\}/,
    )?.[0];
    const dailyPlanCardRule = dashboardCss.match(
      /\.daily-plan-status-card\s*\{\s*display: grid;[\s\S]*?\n\}/,
    )?.[0];
    const mobileControlGridRule = dashboardCss.match(
      /@media \(max-width: 42rem\) \{\s*\.day-console__grid\s*\{[\s\S]*?\n\s*\}/,
    )?.[0];

    expect(controlGridRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(dailyPlanCardRule).toContain('display: grid;');
    expect(mobileControlGridRule).toContain('grid-template-columns: 1fr;');
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
