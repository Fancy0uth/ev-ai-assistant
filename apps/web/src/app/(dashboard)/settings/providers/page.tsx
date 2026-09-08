'use client';

import {
  deepSeekCredentialStatusResponseSchema,
  type DeepSeekConnectionFailureCode,
  type DeepSeekCredentialMetadata,
} from '@ev/contracts';
import { useEffect, useRef, useState } from 'react';
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
  const mountedRef = useRef(false);
  const inFlightControllersRef = useRef(new Set<AbortController>());
  const apiKeyRef = useRef('');
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);
  const restoreDeleteFocusRef = useRef(false);

  function createRequestController(): AbortController {
    const controller = new AbortController();
    inFlightControllersRef.current.add(controller);
    return controller;
  }

  function releaseRequestController(controller: AbortController): void {
    inFlightControllersRef.current.delete(controller);
  }

  useEffect(() => {
    mountedRef.current = true;
    const controllers = inFlightControllersRef.current;
    const controller = createRequestController();
    void requestCore('providers/deepseek/credential', { method: 'GET', signal: controller.signal })
      .then((payload) => deepSeekCredentialStatusResponseSchema.parse(payload).data)
      .then((loaded) => {
        if (mountedRef.current) setMetadata(loaded);
      })
      .catch((failure: unknown) => {
        if (mountedRef.current && !controller.signal.aborted) setError(failureMessage(failure));
      })
      .finally(() => {
        releaseRequestController(controller);
        if (mountedRef.current) setIsLoading(false);
      });

    return () => {
      mountedRef.current = false;
      apiKeyRef.current = '';
      for (const inFlightController of controllers) {
        inFlightController.abort();
      }
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    if (confirmDelete) {
      confirmDeleteRef.current?.focus();
    } else if (restoreDeleteFocusRef.current) {
      deleteTriggerRef.current?.focus();
      restoreDeleteFocusRef.current = false;
    }
  }, [confirmDelete]);

  async function saveCredential(): Promise<void> {
    let value = apiKeyRef.current;
    if (!value.trim() || isSaving) {
      value = '';
      return;
    }

    let body = JSON.stringify({ apiKey: value });
    value = '';
    apiKeyRef.current = '';
    setApiKey('');

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    const controller = createRequestController();
    try {
      const payload = await requestCore('providers/deepseek/credential', {
        method: 'PUT',
        body,
        signal: controller.signal,
      });
      if (!mountedRef.current) return;
      setMetadata(deepSeekCredentialStatusResponseSchema.parse(payload).data);
      setConfirmDelete(false);
      setSuccess('密钥已保存。请按需手动测试连接。');
    } catch (failure: unknown) {
      if (mountedRef.current && !controller.signal.aborted) setError(failureMessage(failure));
    } finally {
      body = '';
      releaseRequestController(controller);
      if (mountedRef.current) setIsSaving(false);
    }
  }

  async function testConnection(): Promise<void> {
    if (metadata?.state !== 'CONFIGURED' || isTesting) return;

    setError(null);
    setSuccess(null);
    setIsTesting(true);
    const controller = createRequestController();
    try {
      const payload = await requestCore('providers/deepseek/connection-test', { method: 'POST', signal: controller.signal });
      if (!mountedRef.current) return;
      setMetadata(deepSeekCredentialStatusResponseSchema.parse(payload).data);
      setSuccess('连接测试已完成。');
    } catch (failure: unknown) {
      if (mountedRef.current && !controller.signal.aborted) setError(failureMessage(failure));
    } finally {
      releaseRequestController(controller);
      if (mountedRef.current) setIsTesting(false);
    }
  }

  async function deleteCredential(): Promise<void> {
    if (isDeleting) return;

    setError(null);
    setSuccess(null);
    setIsDeleting(true);
    const controller = createRequestController();
    try {
      const payload = await requestCore('providers/deepseek/credential', {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: 'DELETE' }),
        signal: controller.signal,
      });
      if (!mountedRef.current) return;
      setMetadata(deepSeekCredentialStatusResponseSchema.parse(payload).data);
      apiKeyRef.current = '';
      setApiKey('');
      setConfirmDelete(false);
      setSuccess('密钥已删除。');
    } catch (failure: unknown) {
      if (mountedRef.current && !controller.signal.aborted) setError(failureMessage(failure));
    } finally {
      releaseRequestController(controller);
      if (mountedRef.current) setIsDeleting(false);
    }
  }

  function cancelDelete(): void {
    restoreDeleteFocusRef.current = true;
    setConfirmDelete(false);
  }

  const isBusy = isSaving || isTesting || isDeleting;
  const isConfigured = metadata?.state === 'CONFIGURED';

  return (
    <section className="settings-workspace" aria-labelledby="provider-settings-heading">
      <p className="section-kicker">LOCAL PROVIDER CONTROL</p>
      <h1 id="provider-settings-heading">DeepSeek 设置</h1>
      <p>密钥只保留在这台设备上。保存后浏览器不会显示或保留该密钥。</p>
      <p>每日计划模型：deepseek-v4-flash（仅允许 deepseek-v4-flash / deepseek-v4-pro）</p>
      <p>真实连接测试只会在你主动点击后发送最小请求；本页面不会自动调用 Provider。</p>
      <section className="provider-credential-card" aria-label="学习能力状态">
        <h2>课程学习能力</h2>
        <p>课表视觉识别、匿名公开检索和文本学习建议未配置时均显示 BLOCKED_PROVIDER；系统不会上传图片、抓取网页或伪造结果。</p>
        <p>保存 DeepSeek 凭据后，课程详情仍会先要求确认文本学习建议的外发披露；视觉识别和匿名公开检索不会使用 DeepSeek。</p>
        <p>自动测试 Fake 证据，不代表真实 Provider（仅在受控自动测试运行中出现）。</p>
      </section>

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
                onChange={(event) => {
                  apiKeyRef.current = event.target.value;
                  setApiKey(event.target.value);
                }}
                disabled={isBusy}
              />
            </label>
            <p className="provider-credential-form__hint">保存不会自动发起连接测试；未配置、配额耗尽或返回不完整时，每日计划会安全停止而不会生成伪造草案。</p>
            <div className="provider-credential-actions">
              <button type="submit" disabled={isBusy || !apiKey.trim()}>
                {isSaving ? '正在保存…' : isConfigured ? '替换密钥' : '保存密钥'}
              </button>
              <button type="button" disabled={isBusy || !isConfigured} onClick={() => void testConnection()}>
                {isTesting ? '正在测试…' : '测试连接'}
              </button>
              {isConfigured && !confirmDelete ? (
                <button
                  ref={deleteTriggerRef}
                  type="button"
                  className="provider-credential-actions__delete"
                  disabled={isBusy}
                  onClick={() => setConfirmDelete(true)}
                >
                  删除密钥
                </button>
              ) : null}
            </div>
          </form>

          {confirmDelete ? (
            <div
              className="provider-delete-confirmation"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="provider-delete-confirmation-title"
              aria-describedby="provider-delete-confirmation-description"
            >
              <h3 id="provider-delete-confirmation-title">确认删除密钥</h3>
              <p id="provider-delete-confirmation-description">删除后无法恢复，确定继续吗？</p>
              <div className="provider-credential-actions">
                <button ref={confirmDeleteRef} type="button" className="provider-credential-actions__delete" disabled={isBusy} onClick={() => void deleteCredential()}>
                  {isDeleting ? '正在删除…' : '确认删除'}
                </button>
                <button type="button" disabled={isBusy} onClick={cancelDelete}>
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
