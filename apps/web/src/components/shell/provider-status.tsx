'use client';

import { deepSeekCredentialStatusResponseSchema, type DeepSeekCredentialMetadata } from '@ev/contracts';
import { Bot } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { requestCore } from '@/lib/core-client';

export const PROVIDER_CREDENTIAL_STATUS_CHANGED_EVENT = 'ev:provider-credential-status-changed';

type CredentialReadStatus =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; metadata: DeepSeekCredentialMetadata };

const failureMessages = {
  AUTHENTICATION_FAILED: '认证失败',
  RATE_LIMITED: '请求过于频繁',
  NETWORK_ERROR: '网络连接失败',
  INVALID_RESPONSE: '服务返回了无法识别的响应',
  PROVIDER_UNAVAILABLE: '服务暂时不可用',
} as const;

function statusHeading(status: CredentialReadStatus): string {
  if (status.kind === 'loading') return '正在读取 DeepSeek 状态…';
  if (status.kind === 'failed') return 'DeepSeek 状态读取失败';

  const { metadata } = status;
  if (metadata.state === 'NOT_CONFIGURED') return 'DeepSeek：未配置';
  if (metadata.lastConnectionTest === null) return 'DeepSeek：已配置，尚未测试';
  if (metadata.lastConnectionTest.status === 'SUCCEEDED') return 'DeepSeek：最近测试成功（不代表实时可达）';
  return 'DeepSeek：最近测试失败';
}

function credentialState(status: CredentialReadStatus): string {
  if (status.kind !== 'ready') return '未知';
  return status.metadata.state === 'CONFIGURED' ? '已配置' : '未配置';
}

function connectionTestState(status: CredentialReadStatus): string {
  if (status.kind !== 'ready') return '未知';
  const { lastConnectionTest } = status.metadata;
  if (lastConnectionTest === null) return '尚未测试';
  if (lastConnectionTest.status === 'SUCCEEDED') return '最近测试成功；不代表实时可达';
  return `最近测试失败：${failureMessages[lastConnectionTest.failureCode]}`;
}

export function ProviderStatus() {
  const pathname = usePathname();
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<CredentialReadStatus>({ kind: 'loading' });

  useEffect(() => {
    let active = true;

    function refresh(): void {
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;
      const sequence = ++requestSequence.current;
      setStatus({ kind: 'loading' });

      void requestCore('providers/deepseek/credential', { method: 'GET', signal: controller.signal })
        .then((payload) => deepSeekCredentialStatusResponseSchema.parse(payload).data)
        .then((metadata) => {
          if (!active || controller.signal.aborted || sequence !== requestSequence.current) return;
          setStatus({ kind: 'ready', metadata });
        })
        .catch(() => {
          if (!active || controller.signal.aborted || sequence !== requestSequence.current) return;
          setStatus({ kind: 'failed' });
        })
        .finally(() => {
          if (activeController.current === controller) activeController.current = null;
        });
    }

    window.addEventListener(PROVIDER_CREDENTIAL_STATUS_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    refresh();

    return () => {
      active = false;
      window.removeEventListener(PROVIDER_CREDENTIAL_STATUS_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      activeController.current?.abort();
      activeController.current = null;
      requestSequence.current += 1;
    };
  }, [pathname]);

  return (
    <div className="agent-rail">
      <div className="agent-rail__identity">
        <span className="agent-rail__icon" aria-hidden="true">
          <Bot size={18} />
        </span>
        <div>
          <p>DEEPSEEK STATUS</p>
          <h2>{statusHeading(status)}</h2>
        </div>
      </div>
      <p className="agent-rail__copy">
        DeepSeek 目前仅适用于每日计划与课程文本建议。
      </p>
      <dl className="agent-rail__status">
        <div>
          <dt>凭据</dt>
          <dd>{credentialState(status)}</dd>
        </div>
        <div>
          <dt>连接测试</dt>
          <dd>{connectionTestState(status)}</dd>
        </div>
      </dl>
      <p className="agent-rail__copy">
        <Link href="/settings/providers">打开 DeepSeek 设置</Link>
        {' · '}
        <Link href="/daily-plan">打开每日计划</Link>
      </p>
    </div>
  );
}
