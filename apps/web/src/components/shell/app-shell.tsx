'use client';

import { Bot, CalendarDays, ListTodo, LogOut } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  agent: ReactNode;
  isLoggingOut: boolean;
  onLogout: () => void;
}

type DashboardSection = 'today' | 'tasks' | 'agent';

function navigationClass(baseClass: string, section: DashboardSection, active: DashboardSection) {
  return section === active ? `${baseClass} ${baseClass}--active` : baseClass;
}

export function AppShell({ children, agent, isLoggingOut, onLogout }: AppShellProps) {
  const [activeSection, setActiveSection] = useState<DashboardSection>('today');

  function selectSection(section: DashboardSection, targetId: string): void {
    setActiveSection(section);

    const target = document.getElementById(targetId);
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className="nav-rail">
        <a
          className="nav-brand"
          href="#today-overview"
          aria-label="EV Dashboard 今日首页"
          onClick={() => selectSection('today', 'today-overview')}
        >
          <span className="nav-brand__mark" aria-hidden="true">
            EV
          </span>
          <span className="nav-brand__text">
            <strong>Dashboard</strong>
            <small>Owner node</small>
          </span>
        </a>

        <nav className="primary-nav" aria-label="主导航">
          <a
            className={navigationClass('primary-nav__item', 'today', activeSection)}
            href="#today-overview"
            aria-current={activeSection === 'today' ? 'location' : undefined}
            onClick={() => selectSection('today', 'today-overview')}
          >
            <CalendarDays aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>今天</span>
          </a>
          <a
            className={navigationClass('primary-nav__item', 'tasks', activeSection)}
            href="#today-tasks"
            aria-current={activeSection === 'tasks' ? 'location' : undefined}
            onClick={() => selectSection('tasks', 'today-tasks')}
          >
            <ListTodo aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>任务</span>
          </a>
          <a
            className={navigationClass('primary-nav__item', 'agent', activeSection)}
            href="#agent-status"
            aria-current={activeSection === 'agent' ? 'location' : undefined}
            onClick={() => selectSection('agent', 'agent-status')}
          >
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
        <a
          className={navigationClass('mobile-nav__item', 'today', activeSection)}
          href="#today-overview"
          aria-current={activeSection === 'today' ? 'location' : undefined}
          onClick={() => selectSection('today', 'today-overview')}
        >
          <CalendarDays aria-hidden="true" size={19} />
          <span>今天</span>
        </a>
        <a
          className={navigationClass('mobile-nav__item', 'tasks', activeSection)}
          href="#today-tasks"
          aria-current={activeSection === 'tasks' ? 'location' : undefined}
          onClick={() => selectSection('tasks', 'today-tasks')}
        >
          <ListTodo aria-hidden="true" size={19} />
          <span>任务</span>
        </a>
        <a
          className={navigationClass('mobile-nav__item', 'agent', activeSection)}
          href="#agent-mobile"
          aria-current={activeSection === 'agent' ? 'location' : undefined}
          onClick={() => selectSection('agent', 'agent-mobile')}
        >
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
