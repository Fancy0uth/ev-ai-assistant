import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';
import { AuthBootstrap } from '@/components/auth/auth-bootstrap';
import { AuthForm } from '@/components/auth/auth-form';
import { AuthShell } from '@/components/auth/auth-shell';

const { replace, redirect } = vi.hoisted(() => ({ replace: vi.fn(), redirect: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  redirect,
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
      owner: {
        id: '7e9c1f92-3647-40e9-9e42-054702dd1762',
        username: 'owner',
      },
    },
  });
}

describe('AuthBootstrap', () => {
  beforeEach(() => {
    replace.mockReset();
    redirect.mockReset();
  });

  it('sends an uninitialized root entry to setup without requesting a session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { needsSetup: true } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="root" />);

    expect(screen.getByText('正在确认本地 Owner 状态')).toBeInTheDocument();
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/setup'));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/core/auth/setup-status',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('checks the session after setup status before sending an initialized root entry to login', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' } },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="root" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/core/auth/setup-status',
      '/api/core/auth/session',
    ]);
  });

  it('sends an authenticated root entry to today after setup status and session resolve', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
      .mockResolvedValueOnce(validSessionResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="root" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/today'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renders the only Owner setup form when setup is required on the setup entry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { needsSetup: true } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="setup" />);

    expect(await screen.findByRole('button', { name: '创建本地账号' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends an uninitialized login entry to setup without rendering a login form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { needsSetup: true } })));

    render(<AuthBootstrap entry="login" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/setup'));
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
  });

  it('sends an initialized setup entry without a session to login', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' } },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="setup" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByRole('button', { name: '创建本地账号' })).not.toBeInTheDocument();
  });

  it('renders the login form after an initialized login entry receives a 401 session response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' } },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="login" />);

    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a malformed 401 session response on the current entry with retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: { owner: { username: 'owner' } } }, 401));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="login" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('请求未能完成，请稍后重试');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['setup', 'login'] as const)(
    'sends an authenticated %s entry to today',
    async (entry) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
        .mockResolvedValueOnce(validSessionResponse());
      vi.stubGlobal('fetch', fetchMock);

      render(<AuthBootstrap entry={entry} />);

      await waitFor(() => expect(replace).toHaveBeenCalledWith('/today'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('does not render an Owner form before setup status resolves', async () => {
    let resolveSetupStatus: (response: Response) => void;
    const setupStatus = new Promise<Response>((resolve) => {
      resolveSetupStatus = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(setupStatus));

    render(<AuthBootstrap entry="setup" />);

    expect(screen.getByText('正在确认本地 Owner 状态')).toBeInTheDocument();
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();

    resolveSetupStatus!(jsonResponse({ data: { needsSetup: true } }));

    expect(await screen.findByRole('button', { name: '创建本地账号' })).toBeInTheDocument();
  });

  it('keeps the current entry form hidden through a Core-unavailable retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AuthBootstrap entry="setup" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地 Core 暂时不可用，请确认服务已启动',
    );
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('button', { name: '创建本地账号' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not request a session or render a form after a malformed setup response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { needsSetup: 'yes' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="login" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地 Core 返回了无法识别的响应，请稍后重试',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the current entry unresolved when the session response is malformed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: { owner: { username: 'owner' } } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthBootstrap entry="login" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地 Core 返回了无法识别的响应，请稍后重试',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('retries a Core-unavailable session check without leaving the current entry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ data: { needsSetup: false } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录本地账号' } },
          401,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AuthBootstrap entry="login" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地 Core 暂时不可用，请确认服务已启动',
    );
    expect(replace).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(replace).not.toHaveBeenCalled();
  });

  it('uses the resolver at the root instead of issuing an unconditional redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { needsSetup: true } })));

    render(<HomePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/setup'));
    expect(redirect).not.toHaveBeenCalled();
  });

  it('runs the resolver before AuthShell can render an uninitialized login form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { needsSetup: true } })));

    render(<AuthShell mode="login" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/setup'));
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
  });

  it('keeps AuthShell context visible while state is resolving', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => undefined)));

    render(<AuthShell mode="setup" />);

    expect(screen.getByText('EV Dashboard')).toBeInTheDocument();
    expect(screen.getByText('正在确认本地 Owner 状态')).toBeInTheDocument();
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
  });

  it('does not advertise a second account or preview credentials on the login form', () => {
    render(<AuthForm mode="login" />);

    expect(screen.getByLabelText('用户名')).toHaveAttribute('placeholder', '输入本地用户名');
    expect(screen.queryByRole('link', { name: '创建本地账号' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('预览账号');
    expect(document.body).not.toHaveTextContent('预设密码');
  });

  it('shows the exact setup-race condition, removes the invalid form, and offers login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { code: 'SETUP_ALREADY_COMPLETED', message: '本地账号已经完成初始化' } },
          409,
        ),
      ),
    );
    const user = userEvent.setup();
    render(<AuthForm mode="setup" />);

    await user.type(screen.getByLabelText('用户名'), 'owner');
    await user.type(screen.getByLabelText('密码'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: '创建本地账号' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('本地账号已经完成初始化');
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建本地账号' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往登录' })).toHaveAttribute('href', '/login');
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ['INVALID_CREDENTIALS', 401, '用户名或密码错误'],
    ['RATE_LIMITED', 429, '请求过于频繁，请稍后重试'],
  ])('shows the exact %s server message without navigating', async (code, status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code, message } }, status)),
    );
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('用户名'), 'owner');
    await user.type(screen.getByLabelText('密码'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps Core-unavailable authentication retryable by resubmission', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(validSessionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('用户名'), 'owner');
    await user.type(screen.getByLabelText('密码'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地 Core 暂时不可用，请确认服务已启动',
    );

    await user.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/today'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the login form available when a successful response is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: { owner: { username: 'owner' } } })),
    );
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('用户名'), 'owner');
    await user.type(screen.getByLabelText('密码'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地 Core 返回了无法识别的响应，请稍后重试',
    );
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
