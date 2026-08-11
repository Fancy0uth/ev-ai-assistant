import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthBootstrap } from '@/components/auth/auth-bootstrap';
import { AppShell } from '@/components/shell/app-shell';
import { TodayDashboard } from '@/components/today/today-dashboard';

const navigation = vi.hoisted(() => ({ pathname: '/today', replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function validSessionResponse(): Response {
  return jsonResponse({
    data: {
      authenticated: true,
      owner: {
        id: '7e9c1f92-3647-40e9-9e42-054702dd1762',
        username: 'owner',
      },
    },
  });
}

function renderShell() {
  return render(
    <AppShell>
      <p>今天画布</p>
    </AppShell>,
  );
}

describe('AppShell navigation', () => {
  beforeEach(() => {
    navigation.pathname = '/today';
    navigation.replace.mockReset();
  });

  it('uses real dashboard route hrefs in both navigation regions', () => {
    renderShell();

    for (const navigationName of ['主导航', '移动端主导航']) {
      const nav = screen.getByRole('navigation', { name: navigationName });
      expect(within(nav).getByRole('link', { name: '今天' })).toHaveAttribute('href', '/today');
      expect(within(nav).getByRole('link', { name: '任务' })).toHaveAttribute('href', '/tasks');
      expect(within(nav).getByRole('link', { name: 'Agent' })).toHaveAttribute('href', '/agent');
    }
    expect(screen.getByRole('link', { name: 'EV Dashboard 今日首页' })).toHaveAttribute(
      'href',
      '/today',
    );
  });

  it('derives the active item from pathname after rerendered route history', () => {
    const view = renderShell();
    const primaryNavigation = screen.getByRole('navigation', { name: '主导航' });

    expect(within(primaryNavigation).getByRole('link', { name: '今天' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    navigation.pathname = '/tasks';
    view.rerender(
      <AppShell>
        <p>今天画布</p>
      </AppShell>,
    );

    expect(within(primaryNavigation).getByRole('link', { name: '任务' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(primaryNavigation).getByRole('link', { name: '今天' })).not.toHaveAttribute(
      'aria-current',
    );

    navigation.pathname = '/today';
    view.rerender(
      <AppShell>
        <p>今天画布</p>
      </AppShell>,
    );

    expect(within(primaryNavigation).getByRole('link', { name: '今天' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps stable accessible names when the 1024px layout hides visible text', () => {
    renderShell();

    for (const nav of [
      screen.getByRole('navigation', { name: '主导航' }),
      screen.getByRole('navigation', { name: '移动端主导航' }),
    ]) {
      expect(within(nav).getByRole('link', { name: '今天' })).toHaveAccessibleName('今天');
      expect(within(nav).getByRole('link', { name: '任务' })).toHaveAccessibleName('任务');
      expect(within(nav).getByRole('link', { name: 'Agent' })).toHaveAccessibleName('Agent');
    }
    expect(screen.getAllByRole('button', { name: '退出' })).toHaveLength(2);
  });

  it('owns successful logout and only navigates after validating the frozen response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { success: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderShell();
    await user.click(screen.getAllByRole('button', { name: '退出' })[0]!);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/core/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it.each([
    ['malformed', jsonResponse({ data: { success: false } }), '本地 Core 返回了无法识别的响应，请稍后重试'],
    [
      'error',
      jsonResponse({ error: { code: 'CORE_UNAVAILABLE', message: '退出请求失败' } }, 503),
      '退出请求失败',
    ],
  ])('keeps the dashboard visible when logout receives a %s response', async (_kind, response, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const user = userEvent.setup();

    renderShell();
    await user.click(screen.getAllByRole('button', { name: '退出' })[0]!);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByText('今天画布')).toBeInTheDocument();
  });

  it('renders exactly one primary nav, one mobile nav, and one desktop Agent rail', () => {
    renderShell();

    expect(screen.getAllByRole('navigation', { name: '主导航' })).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: '移动端主导航' })).toHaveLength(1);
    expect(screen.getAllByLabelText('Agent 状态')).toHaveLength(1);
    expect(screen.getByText('Agent API 未连接')).toBeInTheDocument();
  });
});

describe('dashboard authentication entry', () => {
  beforeEach(() => {
    navigation.replace.mockReset();
  });

  it.each([
    ['needs setup', [jsonResponse({ data: { needsSetup: true } })], '/setup'],
    [
      'canonical unauthenticated session',
      [
        jsonResponse({ data: { needsSetup: false } }),
        jsonResponse({ data: { authenticated: false } }),
      ],
      '/login',
    ],
  ])('redirects a dashboard entry when it %s', async (_state, responses, destination) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => responses.shift()));

    render(
      <AuthBootstrap entry="dashboard">
        <AppShell>
          <p>受保护的 Dashboard</p>
        </AppShell>
      </AuthBootstrap>,
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(destination));
    expect(screen.queryByText('受保护的 Dashboard')).not.toBeInTheDocument();
  });

  it('renders dashboard children only for a valid session', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
        .mockResolvedValueOnce(validSessionResponse()),
    );

    render(
      <AuthBootstrap entry="dashboard">
        <AppShell>
          <p>受保护的 Dashboard</p>
        </AppShell>
      </AuthBootstrap>,
    );

    expect(await screen.findByText('受保护的 Dashboard')).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('keeps the shell hidden behind retry UI for malformed dashboard auth responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { needsSetup: 'yes' } })));

    render(
      <AuthBootstrap entry="dashboard">
        <AppShell>
          <p>受保护的 Dashboard</p>
        </AppShell>
      </AuthBootstrap>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地 Core 返回了无法识别的响应，请稍后重试',
    );
    expect(screen.queryByText('受保护的 Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
  });
});

describe('TodayDashboard canvas', () => {
  it('does not mount a nested dashboard shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
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
        }),
      ),
    );

    render(<TodayDashboard initialDate="2026-08-07" />);

    await screen.findByText('今天还没有任务');
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Agent 状态')).not.toBeInTheDocument();
  });
});
