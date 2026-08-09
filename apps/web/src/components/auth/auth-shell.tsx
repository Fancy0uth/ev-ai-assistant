import type { ReactNode } from 'react';
import { AuthBootstrap, type AuthEntry } from './auth-bootstrap';

interface AuthShellProps {
  mode?: 'setup' | 'login';
  entry?: AuthEntry;
}

function workspaceLabel(entry: AuthEntry): string {
  if (entry === 'setup') return '创建账号';
  if (entry === 'login') return '登录';
  return '认证启动状态';
}

function AuthPageFrame({ entry, children }: { entry: AuthEntry; children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-context" aria-labelledby="product-name">
        <div>
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              EV
            </span>
            <div>
              <p className="brand-label">Local intelligence</p>
              <p className="brand-name" id="product-name">
                EV Dashboard
              </p>
            </div>
          </div>

          <p className="context-index">SYS / OWNER NODE</p>
          <p className="context-title">你的日程与 Agent，首先属于你自己。</p>
          <p className="context-copy">
            Core 仅监听本机，SQLite 保存任务与长期状态。模型只是可替换的能力接口，不是数据所有者。
          </p>
        </div>

        <dl className="system-status" aria-label="当前系统边界">
          <div>
            <dt>DATA</dt>
            <dd>
              <span className="status-dot" aria-hidden="true" /> 本地 SQLite
            </dd>
          </div>
          <div>
            <dt>CORE</dt>
            <dd>
              <span className="status-dot" aria-hidden="true" /> 127.0.0.1
            </dd>
          </div>
          <div>
            <dt>AI</dt>
            <dd>
              <span className="status-dot status-dot--idle" aria-hidden="true" /> 等待配置
            </dd>
          </div>
        </dl>
      </section>

      <section className="auth-workspace" aria-label={workspaceLabel(entry)}>
        {children}
        <p className="local-note">LOCAL-FIRST · SINGLE OWNER · NO CLOUD SYNC</p>
      </section>
    </main>
  );
}

export function AuthShell({ mode, entry }: AuthShellProps) {
  const authEntry = entry ?? mode;
  if (!authEntry) {
    throw new Error('AuthShell requires an auth entry');
  }

  return (
    <AuthBootstrap
      entry={authEntry}
      render={(content) => <AuthPageFrame entry={authEntry}>{content}</AuthPageFrame>}
    />
  );
}
