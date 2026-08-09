import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';

function renderShell() {
  render(
    <AppShell agent={<p>桌面 Agent</p>} isLoggingOut={false} onLogout={vi.fn()}>
      <header id="today-overview">今天概览</header>
      <section id="today-tasks">任务列表</section>
      <details id="agent-mobile">
        <summary>移动端 Agent</summary>
        Agent 内容
      </details>
    </AppShell>,
  );
}

describe('AppShell navigation', () => {
  it('shows which dashboard section was selected', async () => {
    renderShell();
    const user = userEvent.setup();
    const navigation = screen.getByRole('navigation', { name: '主导航' });
    const todayLink = within(navigation).getByRole('link', { name: '今天' });
    const taskLink = within(navigation).getByRole('link', { name: '任务' });

    expect(todayLink).toHaveAttribute('aria-current', 'location');

    await user.click(taskLink);

    expect(taskLink).toHaveAttribute('aria-current', 'location');
    expect(todayLink).not.toHaveAttribute('aria-current');
  });

  it('opens the mobile Agent panel when its navigation item is selected', async () => {
    renderShell();
    const user = userEvent.setup();
    const navigation = screen.getByRole('navigation', { name: '移动端主导航' });
    const agentLink = within(navigation).getByRole('link', { name: 'Agent' });
    const agentPanel = document.querySelector<HTMLDetailsElement>('#agent-mobile');

    expect(agentPanel?.open).toBe(false);

    await user.click(agentLink);

    expect(agentLink).toHaveAttribute('aria-current', 'location');
    expect(agentPanel?.open).toBe(true);
  });
});
