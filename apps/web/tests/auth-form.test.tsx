import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from '@/components/auth/auth-form';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

describe('AuthForm', () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it('shows the server error and never reports false success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('用户名'), 'codex');
    await user.type(screen.getByLabelText('密码'), 'wrong password');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码错误');
    expect(replace).not.toHaveBeenCalled();
  });

  it('blocks invalid credentials before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AuthForm mode="setup" />);

    await user.type(screen.getByLabelText('用户名'), 'ab');
    await user.type(screen.getByLabelText('密码'), 'short');
    await user.click(screen.getByRole('button', { name: '创建本地账号' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('用户名至少 3 个字符');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains how to recover when the local Core is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('用户名'), 'codex');
    await user.type(screen.getByLabelText('密码'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '本地 Core 暂时不可用，请确认服务已启动',
    );
  });
});
