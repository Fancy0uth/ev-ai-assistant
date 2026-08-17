import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderSettingsPage from '@/app/(dashboard)/settings/providers/page';
import { CoreClientError, requestCore } from '@/lib/core-client';

vi.mock('@/lib/core-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core-client')>();
  return { ...actual, requestCore: vi.fn() };
});

const requestCoreMock = vi.mocked(requestCore);
const fakeKey = 'sk-test-key-must-never-render';
const opaqueToken = 'opaque-secret-store-token';

function credentialResponse(
  state: 'CONFIGURED' | 'NOT_CONFIGURED' = 'NOT_CONFIGURED',
  lastConnectionTest: { status: 'SUCCEEDED' } | { status: 'FAILED'; failureCode: FailureCode } | null = null,
) {
  return {
    data: {
      providerKey: 'DEEPSEEK' as const,
      state,
      updatedAt: state === 'CONFIGURED' ? '2026-08-17T01:00:00.000Z' : null,
      lastConnectionTest,
    },
  };
}

type FailureCode =
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_UNAVAILABLE';

function requestBody(call: number): unknown {
  const init = requestCoreMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body));
}

function createDeferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve: resolve! };
}

describe('ProviderSettingsPage', () => {
  beforeEach(() => {
    requestCoreMock.mockReset();
  });

  it('loads non-sensitive credential metadata and exposes a labelled password input', async () => {
    requestCoreMock.mockResolvedValue(credentialResponse());

    render(<ProviderSettingsPage />);

    expect(await screen.findByText('未配置')).toBeInTheDocument();
    expect(screen.getByText(/密钥只保留在这台设备上。/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
    expect(screen.getByLabelText('DeepSeek API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('DeepSeek API Key')).toHaveAttribute('autocomplete', 'off');
    expect(requestCoreMock).toHaveBeenCalledWith(
      'providers/deepseek/credential',
      expect.objectContaining({ method: 'GET', signal: expect.anything() }),
    );
  });

  it('saves only the typed key, clears the field, and never renders sensitive values', async () => {
    requestCoreMock
      .mockResolvedValueOnce(credentialResponse())
      .mockResolvedValueOnce(credentialResponse('CONFIGURED'));
    const user = userEvent.setup();

    render(<ProviderSettingsPage />);
    const input = await screen.findByLabelText('DeepSeek API Key');
    await user.type(input, fakeKey);
    await user.click(screen.getByRole('button', { name: '保存密钥' }));

    await waitFor(() => expect(screen.getByText('已配置')).toBeInTheDocument());
    expect(requestCoreMock).toHaveBeenNthCalledWith(
      2,
      'providers/deepseek/credential',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(requestBody(1)).toEqual({ apiKey: fakeKey });
    expect(requestCoreMock).toHaveBeenCalledTimes(2);
    expect(requestCoreMock.mock.calls.map(([path]) => path)).toEqual([
      'providers/deepseek/credential',
      'providers/deepseek/credential',
    ]);
    expect(requestCoreMock.mock.calls.some(([path]) => path === 'providers/deepseek/connection-test')).toBe(false);
    expect(input).toHaveValue('');
    expect(screen.queryByText(fakeKey)).not.toBeInTheDocument();
    expect(screen.queryByText(opaqueToken)).not.toBeInTheDocument();
  });

  it('aborts an in-flight save on unmount without later UI updates or exposing the typed key', async () => {
    const save = createDeferred<unknown>();
    let saveSignal: AbortSignal | undefined;
    requestCoreMock
      .mockResolvedValueOnce(credentialResponse())
      .mockImplementationOnce(async (_path, init) => {
        saveSignal = init.signal ?? undefined;
        return save.promise;
      });
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const { container, unmount } = render(<ProviderSettingsPage />);
      const input = await screen.findByLabelText('DeepSeek API Key');
      await user.type(input, fakeKey);
      await user.click(screen.getByRole('button', { name: '保存密钥' }));

      expect(input).toHaveValue('');
      expect(container).not.toHaveTextContent(fakeKey);
      expect(requestCoreMock.mock.calls.map(([path]) => path)).toEqual([
        'providers/deepseek/credential',
        'providers/deepseek/credential',
      ]);
      expect(saveSignal).toBeDefined();

      unmount();
      expect(saveSignal?.aborted).toBe(true);

      await act(async () => {
        save.resolve(credentialResponse('CONFIGURED'));
        await save.promise;
      });

      expect(container).not.toHaveTextContent(fakeKey);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('runs a manual connection test and renders its succeeded category', async () => {
    requestCoreMock
      .mockResolvedValueOnce(credentialResponse('CONFIGURED'))
      .mockResolvedValueOnce(credentialResponse('CONFIGURED', { status: 'SUCCEEDED' }));
    const user = userEvent.setup();

    render(<ProviderSettingsPage />);
    await screen.findByText('已配置');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(await screen.findByText('最近连接测试：成功')).toBeInTheDocument();
    expect(requestCoreMock).toHaveBeenNthCalledWith(
      2,
      'providers/deepseek/connection-test',
      expect.objectContaining({ method: 'POST', signal: expect.anything() }),
    );
  });

  it.each<[FailureCode, string]>([
    ['AUTHENTICATION_FAILED', '最近连接测试：认证失败，请检查密钥。'],
    ['RATE_LIMITED', '最近连接测试：请求过于频繁，请稍后再试。'],
    ['NETWORK_ERROR', '最近连接测试：网络连接失败。'],
    ['INVALID_RESPONSE', '最近连接测试：服务返回了无法识别的响应。'],
    ['PROVIDER_UNAVAILABLE', '最近连接测试：服务暂时不可用。'],
  ])('renders the %s manual-test failure category', async (failureCode, expected) => {
    requestCoreMock
      .mockResolvedValueOnce(credentialResponse('CONFIGURED'))
      .mockResolvedValueOnce(credentialResponse('CONFIGURED', { status: 'FAILED', failureCode }));
    const user = userEvent.setup();

    render(<ProviderSettingsPage />);
    await screen.findByText('已配置');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('requires an inline second delete confirmation before sending the exact body', async () => {
    requestCoreMock
      .mockResolvedValueOnce(credentialResponse('CONFIGURED'))
      .mockResolvedValueOnce(credentialResponse());
    const user = userEvent.setup();

    render(<ProviderSettingsPage />);
    await screen.findByText('已配置');
    await user.click(screen.getByRole('button', { name: '删除密钥' }));

    expect(screen.getByText('删除后无法恢复，确定继续吗？')).toBeInTheDocument();
    expect(requestCoreMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(screen.getByText('未配置')).toBeInTheDocument());
    expect(requestCoreMock).toHaveBeenNthCalledWith(
      2,
      'providers/deepseek/credential',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(requestBody(1)).toEqual({ confirmation: 'DELETE' });
  });

  it('focuses the labelled delete confirmation for keyboard users and restores focus on cancel', async () => {
    requestCoreMock.mockResolvedValue(credentialResponse('CONFIGURED'));
    const user = userEvent.setup();

    render(<ProviderSettingsPage />);
    const deleteTrigger = await screen.findByRole('button', { name: '删除密钥' });
    deleteTrigger.focus();
    await user.keyboard('{Enter}');

    const confirmation = await screen.findByRole('alertdialog', { name: '确认删除密钥' });
    const confirmButton = screen.getByRole('button', { name: '确认删除' });
    expect(confirmation).toHaveAccessibleDescription('删除后无法恢复，确定继续吗？');
    await waitFor(() => expect(confirmButton).toHaveFocus());

    await user.tab();
    const cancelButton = screen.getByRole('button', { name: '取消' });
    expect(cancelButton).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '删除密钥' })).toHaveFocus());
    expect(requestCoreMock).toHaveBeenCalledTimes(1);
  });

  it('renders Core failures in an alert region', async () => {
    requestCoreMock.mockRejectedValue(
      new CoreClientError(503, 'SECRET_STORE_UNAVAILABLE', '本地凭据存储暂时不可用'),
    );

    render(<ProviderSettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('本地凭据存储暂时不可用');
  });
});
