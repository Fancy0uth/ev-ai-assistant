import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectWorkspace } from '@/components/projects/project-workspace';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const scope = {
  id: '00000000-0000-4000-8000-000000000611', label: '本地助手', rootPath: 'C:\\work\\assistant',
  createdAt: '2026-08-17T03:00:00.000Z', updatedAt: '2026-08-17T03:00:00.000Z',
};

describe('ProjectWorkspace', () => {
  it('registers an explicit project root and reads only its planning snapshot', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/core/projects' && init?.method === 'GET') return Promise.resolve(jsonResponse({ data: [] }));
      if (url === '/api/core/projects' && init?.method === 'POST') return Promise.resolve(jsonResponse({ data: scope }, 201));
      if (url === `/api/core/projects/${scope.id}/snapshot`) {
        return Promise.resolve(jsonResponse({ data: { scope, files: [{ relativePath: 'PRD.md', content: '# 本地助手\n\n先完成技术设计。' }, { relativePath: 'TASKS.md', content: '- [ ] 实现只读分析' }] } }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ProjectWorkspace />);

    await user.type(await screen.findByLabelText('项目名称'), '本地助手');
    await user.type(screen.getByLabelText('本机项目目录'), 'C:\\work\\assistant');
    await user.click(screen.getByRole('button', { name: '登记只读项目范围' }));
    expect(await screen.findByRole('button', { name: '选择项目：本地助手' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '读取只读规划快照' }));

    expect(await screen.findByText('PRD.md')).toBeInTheDocument();
    expect(screen.getByText(/先完成技术设计。/, { selector: 'pre' })).toBeInTheDocument();
    expect(screen.getByText('本页不会执行命令、修改文件、提交 Git 或读取 .env。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/core/projects', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ label: '本地助手', rootPath: 'C:\\work\\assistant' }),
    }));
  });
});
