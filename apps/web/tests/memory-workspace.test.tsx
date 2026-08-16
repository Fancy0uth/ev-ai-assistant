import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryWorkspace } from '@/components/memory/memory-workspace';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const initialDocument = {
  scope: 'FITNESS', content: '训练偏好为晚间。', version: 2,
  createdAt: '2026-08-17T01:00:00.000Z', updatedAt: '2026-08-17T02:00:00.000Z',
};

describe('MemoryWorkspace', () => {
  it('lets the owner inspect and version an editable local memory projection', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/core/memory') return Promise.resolve(jsonResponse({ data: [initialDocument] }));
      if (url === '/api/core/memory/FITNESS' && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ data: { ...initialDocument, content: '训练偏好为晚间，避免膝盖不适。', version: 3, updatedAt: '2026-08-17T03:00:00.000Z' } }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<MemoryWorkspace />);

    expect(await screen.findByText('FITNESS · v2')).toBeInTheDocument();
    const editor = screen.getByLabelText('FITNESS 记忆内容');
    expect(editor).toHaveValue('训练偏好为晚间。');
    await user.clear(editor);
    await user.type(editor, '训练偏好为晚间，避免膝盖不适。');
    await user.click(screen.getByRole('button', { name: '保存新版本' }));

    expect(await screen.findByText('FITNESS · v3')).toBeInTheDocument();
    expect(screen.getByText('SQLite 保存版本事实；MEMORY.md 是本地可读投影。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/core/memory/FITNESS', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ content: '训练偏好为晚间，避免膝盖不适。', expectedVersion: 2 }),
    }));
  });
});
