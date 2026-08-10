'use client';

import { sessionResponseSchema, setupStatusResponseSchema } from '@ev/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { AuthForm } from './auth-form';

export type AuthEntry = 'root' | 'setup' | 'login';

interface AuthBootstrapProps {
  entry: AuthEntry;
  render?: (content: ReactNode) => ReactNode;
}

export function AuthBootstrap({ entry, render }: AuthBootstrapProps) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'setup' | 'login' | null>(null);
  const startedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (startedAttempt.current === attempt) return;
    startedAttempt.current = attempt;

    async function resolve(): Promise<void> {
      let response: unknown;
      try {
        response = await requestCore('auth/setup-status', { method: 'GET' });
      } catch (requestError) {
        setError(
          requestError instanceof CoreClientError
            ? requestError.message
            : '本地 Core 暂时不可用，请确认服务已启动',
        );
        return;
      }
      const parsed = setupStatusResponseSchema.safeParse(response);
      if (!parsed.success) {
        setError('本地 Core 返回了无法识别的响应，请稍后重试');
        return;
      }
      if (parsed.data.data.needsSetup) {
        if (entry === 'setup') {
          setFormMode('setup');
        } else {
          router.replace('/setup');
        }
        return;
      }

      try {
        const session = await requestCore('auth/session', { method: 'GET' });
        if (sessionResponseSchema.safeParse(session).success) {
          router.replace('/today');
        } else {
          setError('本地 Core 返回了无法识别的响应，请稍后重试');
        }
      } catch (error) {
        if (
          error instanceof CoreClientError &&
          error.status === 401 &&
          error.code === 'AUTHENTICATION_REQUIRED'
        ) {
          if (entry === 'login') {
            setFormMode('login');
          } else {
            router.replace('/login');
          }
        } else {
          setError(
            error instanceof CoreClientError
              ? error.message
              : '本地 Core 暂时不可用，请确认服务已启动',
          );
        }
      }
    }

    void resolve();
  }, [attempt, entry, router]);

  function retry(): void {
    setError(null);
    setAttempt((current) => current + 1);
  }

  if (error) {
    const content = (
      <section className="auth-panel" aria-live="polite">
        <h1>无法确认本地 Owner 状态</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={retry}>
          重试
        </button>
      </section>
    );
    return <>{render ? render(content) : content}</>;
  }

  const content = formMode ? (
    <AuthForm mode={formMode} />
  ) : (
    <section className="auth-panel" aria-live="polite">
      <h1>正在确认本地 Owner 状态</h1>
      <p>正在检查本地账号初始化和当前登录状态。</p>
    </section>
  );
  return <>{render ? render(content) : content}</>;
}
