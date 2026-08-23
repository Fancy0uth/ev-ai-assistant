import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleWorkspace } from '@/components/schedule/schedule-workspace';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('ScheduleWorkspace', () => {
  it('creates the local term needed before a course screenshot can be reviewed', async () => {
    const term = {
      id: '00000000-0000-4000-8000-000000000411', title: '2026 秋季学期', timezone: 'Asia/Shanghai',
      weekOneMonday: '2026-08-31', version: 1, createdAt: '2026-08-17T03:00:00.000Z', updatedAt: '2026-08-17T03:00:00.000Z',
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/core/terms' && init?.method === 'GET') return Promise.resolve(jsonResponse({ data: [] }));
      if (url === '/api/core/proposals?status=PENDING' && init?.method === 'GET') return Promise.resolve(jsonResponse({ data: [] }));
      if (url === '/api/core/terms' && init?.method === 'POST') return Promise.resolve(jsonResponse({ data: term }, 201));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ScheduleWorkspace />);

    expect(await screen.findByText('还没有学期')).toBeInTheDocument();
    await user.type(screen.getByLabelText('学期名称'), '2026 秋季学期');
    await user.clear(screen.getByLabelText('第一教学周的周一'));
    await user.type(screen.getByLabelText('第一教学周的周一'), '2026-08-31');
    await user.click(screen.getByRole('button', { name: '建立本地学期' }));

    expect(await screen.findAllByText('2026 秋季学期')).toHaveLength(2);
    expect(screen.getByText('先建立学期后，才能把截图交给识别流程。')).toBeInTheDocument();
    expect(screen.getByLabelText('课表截图')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/core/terms',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-08-31' }),
      }),
    );
  });
});
