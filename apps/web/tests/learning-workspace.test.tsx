import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LearningWorkspace } from '@/components/learning/learning-workspace';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const term = {
  id: '00000000-0000-4000-8000-000000000511', title: '2026 秋季', timezone: 'Asia/Shanghai',
  weekOneMonday: '2026-08-31', version: 1, createdAt: '2026-08-17T03:00:00.000Z', updatedAt: '2026-08-17T03:00:00.000Z',
};
const course = {
  id: '00000000-0000-4000-8000-000000000512', termId: term.id, title: '机器学习导论', courseCode: null,
  officialUrl: 'https://example.edu/ml', version: 1, createdAt: '2026-08-17T03:01:00.000Z', updatedAt: '2026-08-17T03:01:00.000Z',
};

describe('LearningWorkspace', () => {
  it('builds a course-specific profile and attributes a user-provided resource to it', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/core/terms') return Promise.resolve(jsonResponse({ data: [term] }));
      if (url === '/api/core/courses' && init?.method === 'GET') return Promise.resolve(jsonResponse({ data: [] }));
      if (url === '/api/core/courses' && init?.method === 'POST') return Promise.resolve(jsonResponse({ data: course }, 201));
      if (url === `/api/core/courses/${course.id}/resources` && init?.method === 'GET') return Promise.resolve(jsonResponse({ data: [] }));
      if (url === `/api/core/courses/${course.id}/resources` && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: '00000000-0000-4000-8000-000000000513', courseId: course.id, title: '课程周纲', url: 'https://example.edu/ml/week-1', source: 'USER_PROVIDED', createdAt: '2026-08-17T03:02:00.000Z' } }, 201));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<LearningWorkspace />);

    await user.type(await screen.findByLabelText('课程名称'), '机器学习导论');
    await user.type(screen.getByLabelText('课程官网或课程平台链接'), 'https://example.edu/ml');
    await user.click(screen.getByRole('button', { name: '建立课程档案' }));

    expect(await screen.findByRole('button', { name: '选择课程：机器学习导论' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('课程资料标题'), '课程周纲');
    await user.type(screen.getByLabelText('课程资料链接'), 'https://example.edu/ml/week-1');
    await user.click(screen.getByRole('button', { name: '添加到本课程' }));

    expect(await screen.findByText('课程周纲')).toBeInTheDocument();
    expect(screen.getByText('资料来自你提供的链接；后续公开搜索结果会单独标注来源。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/core/courses', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ termId: term.id, title: '机器学习导论', officialUrl: 'https://example.edu/ml' }),
    }));
  });
});
