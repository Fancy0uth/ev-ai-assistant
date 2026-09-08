'use client';

import { Bot, CalendarCheck, CalendarDays, ListTodo, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logoutResponseSchema } from '@ev/contracts';
import { useState, type ReactNode } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

interface AppShellProps {
  children: ReactNode;
}

const navigationItems = [
  { href: '/today', label: '今天', icon: CalendarDays },
  { href: '/daily-plan', label: '每日计划', icon: CalendarCheck },
  { href: '/tasks', label: '任务', icon: ListTodo },
  { href: '/agent', label: 'Agent', icon: Bot },
] as const;

function navigationClass(baseClass: string, href: string, pathname: string) {
  return href === pathname ? `${baseClass} ${baseClass}--active` : baseClass;
}

function logoutErrorMessage(error: unknown): string {
  if (error instanceof CoreClientError) return error.message;
  return '本地 Core 暂时不可用，请确认服务已启动';
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function logout(): Promise<void> {
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await requestCore('auth/logout', { method: 'POST' });
      if (!logoutResponseSchema.safeParse(response).success) {
        setLogoutError('本地 Core 返回了无法识别的响应，请稍后重试');
        return;
      }
      router.replace('/login');
    } catch (error) {
      setLogoutError(logoutErrorMessage(error));
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className="nav-rail">
        <Link
          className="nav-brand"
          href="/today"
          aria-label="EV Dashboard 今日首页"
        >
          <span className="nav-brand__mark" aria-hidden="true">
            EV
          </span>
          <span className="nav-brand__text">
            <strong>Dashboard</strong>
            <small>Owner node</small>
          </span>
        </Link>

        <nav className="primary-nav" aria-label="主导航">
          {navigationItems.map(({ href, icon: Icon, label }) => (
            <Link
              aria-current={pathname === href ? 'page' : undefined}
              aria-label={label}
              className={navigationClass('primary-nav__item', href, pathname)}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="nav-rail__footer">
          <div className="owner-chip" aria-label="当前账号：本地 Owner">
            <span aria-hidden="true">O</span>
            <div>
              <strong>本地 Owner</strong>
              <small>设备内会话</small>
            </div>
          </div>
          <button
            aria-label="退出"
            className="logout-button"
            disabled={isLoggingOut}
            type="button"
            onClick={() => void logout()}
          >
            <LogOut aria-hidden="true" size={16} />
            <span>{isLoggingOut ? '正在退出…' : '退出'}</span>
          </button>
        </div>
      </aside>

      <main className="today-canvas">
        {logoutError ? (
          <div className="dashboard-alert" role="alert">
            <p>{logoutError}</p>
          </div>
        ) : null}
        {children}
      </main>
      <aside className="dashboard-agent" aria-label="Agent 状态">
        <div className="agent-rail">
          <div className="agent-rail__identity">
            <span className="agent-rail__icon" aria-hidden="true">
              <Bot size={18} />
            </span>
            <div>
              <p>LOCAL FRAMEWORK</p>
              <h2>Agent API 未连接</h2>
            </div>
          </div>
          <p className="agent-rail__copy">框架已就绪；连接本地 API 后可在 Agent 页面开始会话。</p>
          <dl className="agent-rail__status">
            <div>
              <dt>框架</dt>
              <dd>本地</dd>
            </div>
            <div>
              <dt>API</dt>
              <dd>未连接</dd>
            </div>
          </dl>
        </div>
      </aside>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {navigationItems.map(({ href, icon: Icon, label }) => (
          <Link
            aria-current={pathname === href ? 'page' : undefined}
            aria-label={label}
            className={navigationClass('mobile-nav__item', href, pathname)}
            href={href}
            key={href}
          >
            <Icon aria-hidden="true" size={19} />
            <span>{label}</span>
          </Link>
        ))}
        <button
          aria-label="退出"
          className="mobile-nav__item"
          type="button"
          disabled={isLoggingOut}
          onClick={() => void logout()}
        >
          <LogOut aria-hidden="true" size={19} />
          <span>退出</span>
        </button>
      </nav>
    </div>
  );
}
