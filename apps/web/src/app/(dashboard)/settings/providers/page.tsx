'use client';

import {
  deepSeekCredentialStatusResponseSchema,
  type DeepSeekConnectionFailureCode,
  type DeepSeekCredentialMetadata,
} from '@ev/contracts';
import { useEffect, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

const failureMessages: Record<DeepSeekConnectionFailureCode, string> = {
  AUTHENTICATION_FAILED: '认证失败，请检查密钥。',
  RATE_LIMITED: '请求过于频繁，请稍后再试。',
  NETWORK_ERROR: '网络连接失败。',
  INVALID_RESPONSE: '服务返回了无法识别的响应。',
  PROVIDER_UNAVAILABLE: '服务暂时不可用。',
};

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '本地 Provider 操作暂时未完成，请稍后重试。';
}

function connectionTestMessage(metadata: DeepSeekCredentialMetadata): string {
  if (metadata.lastConnectionTest === null) return '最近连接测试：尚未测试';
  if (metadata.lastConnectionTest.status === 'SUCCEEDED') return '最近连接测试：成功';
  return `最近连接测试：${failureMessages[metadata.lastConnectionTest.failureCode]}`;
}

function configurationMessage(metadata: DeepSeekCredentialMetadata): string {
  return metadata.state === 'CONFIGURED' ? '已配置' : '未配置';
}

export default function ProviderSettingsPage() {
  const [metadata, setMetadata] = useState<DeepSeekCredentialMetadata | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void requestCore('providers/deepseek/credential', { method: 'GET' })
      .then((payload) => deepSeekCredentialStatusResponseSchema.parse(payload).data)
      .then((loaded) => {
        if (active) setMetadata(loaded);
      })
      .catch((failure: unknown) => {
        if (active) setError(failureMessage(failure));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      setApiKey('');
    };
  }, []);

  async function saveCredential(): Promise<void> {
    const value = apiKey;
    if (!value.trim() || isSaving) return;

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const payload = await requestCore('providers/deepseek/credential', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: value }),
      });
      setMetadata(deepSeekCredentialStatusResponseSchema.parse(payload).data);
      setApiKey('');
      setConfirmDelete(false);
      setSuccess('密钥已保存。请按需手动测试连接。');
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setIsSaving(false);
    }
  }

  async function testConnection(): Promise<void> {
    if (metadata?.state !== 'CONFIGURED' || isTesting) return;

    setError(null);
    setSuccess(null);
    setIsTesting(true);
    try {
      const payload = await requestCore('providers/deepseek/connection-test', { method: 'POST' });
      setMetadata(deepSeekCredentialStatusResponseSchema.parse(payload).data);
      setSuccess('连接测试已完成。');
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setIsTesting(false);
    }
  }

  async function deleteCredential(): Promise<void> {
    if (isDeleting) return;

    setError(null);
    setSuccess(null);
    setIsDeleting(true);
    try {
      const payload = await requestCore('providers/deepseek/credential', {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      setMetadata(deepSeekCredentialStatusResponseSchema.parse(payload).data);
      setApiKey('');
      setConfirmDelete(false);
      setSuccess('密钥已删除。');
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setIsDeleting(false);
    }
  }

  const isBusy = isSaving || isTesting || isDeleting;
  const isConfigured = metadata?.state === 'CONFIGURED';

  return (
    <section className="settings-workspace" aria-labelledby="provider-settings-heading">
      <p className="section-kicker">LOCAL PROVIDER CONTROL</p>
      <h1 id="provider-settings-heading">DeepSeek 设置</h1>
      <p>密钥只保留在这台设备上。保存后浏览器不会显示或保留该密钥。</p>

      {error ? <p className="dashboard-alert" role="alert">{error}</p> : null}
      <p className="provider-credential-live" aria-live="polite" aria-busy={isLoading}>
        {isLoading ? '正在读取本地凭据状态…' : success}
      </p>

      {metadata ? (
        <article className="provider-credential-card" aria-labelledby="deepseek-credential-heading">
          <header className="provider-credential-card__header">
            <div>
              <h2 id="deepseek-credential-heading">DeepSeek API</h2>
              <p>仅显示非敏感的本地配置状态。</p>
            </div>
            <span className={`provider-status provider-status--${metadata.state.toLowerCase()}`}>
              {configurationMessage(metadata)}
            </span>
          </header>

          <dl className="provider-credential-details">
            <div>
              <dt>连接状态</dt>
              <dd>{connectionTestMessage(metadata)}</dd>
            </div>
            {metadata.updatedAt ? (
              <div>
                <dt>最后保存</dt>
                <dd>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(metadata.updatedAt))}</dd>
              </div>
            ) : null}
          </dl>

          <form
            className="provider-credential-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveCredential();
            }}
          >
            <label htmlFor="deepseek-api-key">
              DeepSeek API Key
              <input
                id="deepseek-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={isBusy}
              />
            </label>
            <p className="provider-credential-form__hint">保存不会自动发起连接测试。</p>
            <div className="provider-credential-actions">
              <button type="submit" disabled={isBusy || !apiKey.trim()}>
                {isSaving ? '正在保存…' : isConfigured ? '替换密钥' : '保存密钥'}
              </button>
              <button type="button" disabled={isBusy || !isConfigured} onClick={() => void testConnection()}>
                {isTesting ? '正在测试…' : '测试连接'}
              </button>
              {isConfigured && !confirmDelete ? (
                <button type="button" className="provider-credential-actions__delete" disabled={isBusy} onClick={() => setConfirmDelete(true)}>
                  删除密钥
                </button>
              ) : null}
            </div>
          </form>

          {confirmDelete ? (
            <div className="provider-delete-confirmation">
              <p>删除后无法恢复，确定继续吗？</p>
              <div className="provider-credential-actions">
                <button type="button" className="provider-credential-actions__delete" disabled={isBusy} onClick={() => void deleteCredential()}>
                  {isDeleting ? '正在删除…' : '确认删除'}
                </button>
                <button type="button" disabled={isBusy} onClick={() => setConfirmDelete(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
