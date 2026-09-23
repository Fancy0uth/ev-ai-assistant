import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MemoryWorkspace } from '@/components/memory/memory-workspace';

const timestamp = '2026-09-09T00:00:00.000Z';
const documentFor = (scopeId: string, content = scopeId) => ({ scopeType: 'DOMAIN', scopeId, content, version: 1, createdAt: timestamp, updatedAt: timestamp });
const response = (data: unknown) => new Response(JSON.stringify({ data }));

it('ignores a delayed memory write across A → B → A and submits only the current editor identity', async () => {
  let finish!: (value: Response) => void;
  let delayed = true;
  const writes: Array<{ url: string; body: { content: string } }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/courses')) return response([]);
    if (url.endsWith('/auth/session')) return response({ authenticated: true, owner: { id: '00000000-0000-4000-8000-000000000001', username: 'synthetic' } });
    if (url.includes('/compactions/')) return response({ items: [] });
    if (url.endsWith('/revisions')) return response([]);
    const scope = url.split('/').at(-1)!;
    if (init.method === 'PUT') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      if (delayed) { delayed = false; return new Promise<Response>((resolve) => { finish = resolve; }); }
    }
    return response(documentFor(scope));
  }));
  const user = userEvent.setup();
  render(<MemoryWorkspace />);
  const editor = screen.getByRole('textbox');
  await waitFor(() => expect(editor).toBeEnabled());
  await user.clear(editor);
  await user.type(editor, 'old A write');
  await user.click(screen.getByRole('button', { name: '追加记忆版本' }));
  await user.click(screen.getByRole('button', { name: /切换记忆范围：FITNESS/ }));
  await waitFor(() => expect(editor).toHaveValue('FITNESS'));
  await user.click(screen.getByRole('button', { name: /切换记忆范围：GENERAL/ }));
  await waitFor(() => expect(editor).toHaveValue('GENERAL'));
  await act(async () => finish(response(documentFor('GENERAL', 'old A write'))));
  expect(editor).toHaveValue('GENERAL');
  expect(screen.queryByText('已追加一个可审计的记忆版本。')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /切换记忆范围：FITNESS/ }));
  await waitFor(() => expect(editor).toHaveValue('FITNESS'));
  await user.click(screen.getByRole('button', { name: '追加记忆版本' }));
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual({ url: '/api/core/memory/entities/DOMAIN/FITNESS', body: { content: 'FITNESS', expectedVersion: 1 } });
});
