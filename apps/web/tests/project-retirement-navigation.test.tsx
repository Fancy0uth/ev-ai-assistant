import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModuleQuickLinks } from '@/components/today/module-quick-links';

describe('project-analysis retirement navigation', () => {
  it('omits the retired project module while retaining the ordinary domain links', () => {
    render(<ModuleQuickLinks />);

    expect(screen.getByRole('link', { name: '打开日程与课表模块' })).toHaveAttribute('href', '/schedule');
    expect(screen.getByRole('link', { name: '打开学习模块' })).toHaveAttribute('href', '/learning');
    expect(screen.getByRole('link', { name: '打开训练恢复模块' })).toHaveAttribute('href', '/fitness');
    expect(screen.getByRole('link', { name: '打开饮食模块' })).toHaveAttribute('href', '/nutrition');
    expect(screen.getByRole('link', { name: '打开记忆模块' })).toHaveAttribute('href', '/memory');
    expect(screen.queryByRole('link', { name: '打开项目模块' })).not.toBeInTheDocument();
    expect(screen.getByText('5 个模块')).toBeInTheDocument();
  });
});
