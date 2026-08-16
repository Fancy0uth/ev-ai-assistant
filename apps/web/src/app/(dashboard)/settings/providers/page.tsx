'use client';

import { providerListResponseSchema, type ProviderProfile } from '@ev/contracts';
import { useEffect, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

function message(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '暂时无法读取本地 Provider 状态';
}

export default function ProviderSettingsPage() {
  const [providers, setProviders] = useState<ProviderProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void requestCore('providers', { method: 'GET' })
      .then((payload) => providerListResponseSchema.parse(payload).data)
      .then((items) => {
        if (active) setProviders(items);
      })
      .catch((failure: unknown) => {
        if (active) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="settings-workspace" aria-labelledby="provider-settings-heading">
      <p className="section-kicker">LOCAL PROVIDER CONTROL</p>
      <h1 id="provider-settings-heading">Provider 状态</h1>
      <p>真实密钥不会写入浏览器、普通日志或仓库。当前版本仅展示本地运行时连接状态。</p>
      {error ? <p className="dashboard-alert" role="alert">{error}</p> : null}
      {!providers ? <p className="compact-empty">正在读取本地 Provider 状态…</p> : null}
      <ul className="provider-list">
        {providers?.map((provider) => (
          <li key={provider.key}>
            <div>
              <strong>{provider.label}</strong>
              <small>{provider.key}</small>
            </div>
            <span className={`provider-status provider-status--${provider.availability.toLowerCase()}`}>
              {provider.availability === 'READY' ? '已连接' : '未配置'}
            </span>
          </li>
        ))}
      </ul>
      <p className="settings-workspace__note">
        接入真实 API 的安全凭据适配器仍未启用；在它完成前，未配置 Provider 会明确返回不可用，不会伪造 Agent 回复。
      </p>
    </section>
  );
}
