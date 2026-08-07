'use client';

import { Bot, CalendarDays, ListTodo, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  agent: ReactNode;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function AppShell({ children, agent, isLoggingOut, onLogout }: AppShellProps) {
  return (
    <div className="dashboard-shell">
      <aside className="nav-rail">
        <a className="nav-brand" href="#today-overview" aria-label="EV Dashboard 今日首页">
          <span className="nav-brand__mark" aria-hidden="true">
            EV
          </span>
          <span className="nav-brand__text">
            <strong>Dashboard</strong>
            <small>Owner node</small>
          </span>
        </a>

        <nav className="primary-nav" aria-label="主导航">
          <a className="primary-nav__item primary-nav__item--active" href="#today-overview">
            <CalendarDays aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>今天</span>
          </a>
          <a className="primary-nav__item" href="#today-tasks">
            <ListTodo aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>任务</span>
          </a>
          <a className="primary-nav__item" href="#agent-status">
            <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>Agent</span>
          </a>
        </nav>

        <div className="nav-rail__footer">
          <div className="owner-chip" aria-label="当前账号：本地 Owner">
            <span aria-hidden="true">O</span>
            <div>
              <strong>本地 Owner</strong>
              <small>设备内会话</small>
            </div>
          </div>
          <button className="logout-button" type="button" onClick={onLogout} disabled={isLoggingOut}>
            <LogOut aria-hidden="true" size={16} />
            <span>{isLoggingOut ? '正在退出…' : '退出'}</span>
          </button>
        </div>
      </aside>

      <main className="today-canvas">{children}</main>
      <aside className="dashboard-agent" id="agent-status" aria-label="Agent 状态">
        {agent}
      </aside>

      <nav className="mobile-nav" aria-label="移动端主导航">
        <a className="mobile-nav__item mobile-nav__item--active" href="#today-overview">
          <CalendarDays aria-hidden="true" size={19} />
          <span>今天</span>
        </a>
        <a className="mobile-nav__item" href="#today-tasks">
          <ListTodo aria-hidden="true" size={19} />
          <span>任务</span>
        </a>
        <a className="mobile-nav__item" href="#agent-mobile">
          <Bot aria-hidden="true" size={19} />
          <span>Agent</span>
        </a>
        <button
          className="mobile-nav__item"
          type="button"
          onClick={onLogout}
          disabled={isLoggingOut}
        >
          <LogOut aria-hidden="true" size={19} />
          <span>退出</span>
        </button>
      </nav>
    </div>
  );
}
