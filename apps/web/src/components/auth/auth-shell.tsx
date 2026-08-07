import { AuthForm } from './auth-form';

interface AuthShellProps {
  mode: 'setup' | 'login';
}

export function AuthShell({ mode }: AuthShellProps) {
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

      <section className="auth-workspace" aria-label={mode === 'setup' ? '创建账号' : '登录'}>
        <AuthForm mode={mode} />
        <p className="local-note">LOCAL-FIRST · SINGLE OWNER · NO CLOUD SYNC</p>
      </section>
    </main>
  );
}
