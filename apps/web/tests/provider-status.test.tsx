import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';

const navigation = vi.hoisted(() => ({ pathname: '/today', replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  });
}

function credentialResponse(
  state: 'CONFIGURED' | 'NOT_CONFIGURED',
  lastConnectionTest: { status: 'SUCCEEDED' } | null,
): Response {
  return jsonResponse({
    data: {
      providerKey: 'DEEPSEEK',
      state,
      updatedAt: state === 'CONFIGURED' ? '2026-09-16T01:00:00.000Z' : null,
      lastConnectionTest,
    },
  });
}

function renderStatusRail() {
  render(
    <AppShell>
      <p>今天画布</p>
    </AppShell>,
  );
  return screen.getByLabelText('Agent 状态');
}

describe('DeepSeek provider status rail', () => {
  beforeEach(() => {
    navigation.pathname = '/today';
    navigation.replace.mockReset();
  });

  it('shows a configured credential with a successful test as a non-realtime status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      credentialResponse('CONFIGURED', { status: 'SUCCEEDED' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rail = renderStatusRail();

    expect(await within(rail).findByRole('heading', { name: 'DeepSeek：最近测试成功（不代表实时可达）' })).toBeInTheDocument();
    expect(within(rail).getByText('DeepSeek 目前仅适用于每日计划与课程文本建议。')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/core/providers/deepseek/credential']);
  });

  it('refreshes the displayed status to not configured after the credential change event', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(credentialResponse('CONFIGURED', { status: 'SUCCEEDED' }))
      .mockResolvedValueOnce(credentialResponse('NOT_CONFIGURED', null));
    vi.stubGlobal('fetch', fetchMock);

    const rail = renderStatusRail();
    await within(rail).findByRole('heading', { name: 'DeepSeek：最近测试成功（不代表实时可达）' });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ev:provider-credential-status-changed'));
    });

    expect(await within(rail).findByRole('heading', { name: 'DeepSeek：未配置' })).toBeInTheDocument();
    expect(within(rail).queryByRole('heading', { name: 'DeepSeek：最近测试成功（不代表实时可达）' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/core/providers/deepseek/credential',
      '/api/core/providers/deepseek/credential',
    ]);
  });

  it('replaces a previous success with a read failure instead of retaining it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(credentialResponse('CONFIGURED', { status: 'SUCCEEDED' }))
      .mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const rail = renderStatusRail();
    await within(rail).findByRole('heading', { name: 'DeepSeek：最近测试成功（不代表实时可达）' });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ev:provider-credential-status-changed'));
    });

    expect(await within(rail).findByRole('heading', { name: 'DeepSeek 状态读取失败' })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(rail).queryByRole('heading', { name: 'DeepSeek：最近测试成功（不代表实时可达）' })).not.toBeInTheDocument();
    });
  });
});
