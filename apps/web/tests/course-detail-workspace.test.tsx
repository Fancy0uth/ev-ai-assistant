import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CourseDetailWorkspace } from '@/components/learning/course-detail-workspace';

const courseId = '00000000-0000-4000-8000-000000000701';
const detail = {
  data: {
    course: { id: courseId, termId: '00000000-0000-4000-8000-000000000702', title: '机器学习导论', courseCode: null, officialUrl: 'https://official.example/ml', version: 1, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
    rules: [],
    sources: { official: [{ title: '课程官网', url: 'https://official.example/ml' }], user: [{ id: '00000000-0000-4000-8000-000000000703', courseId, title: '你提供的周纲', url: 'https://user.example/week-1', source: 'USER_PROVIDED', createdAt: '2026-08-31T00:00:00.000Z' }], public: [] },
    learningContext: { courseId, stage: 'NOT_STARTED', progressNote: '', version: 1, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
    actionCounts: { open: 0, completed: 0 },
  },
};

function response(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }); }

describe('CourseDetailWorkspace', () => {
  it('renders source provenance, saves versioned progress, and executes only after disclosure', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === `/api/core/courses/${courseId}`) return Promise.resolve(response(detail));
      if (url === `/api/core/courses/${courseId}/learning-context`) return Promise.resolve(response({ data: { ...detail.data.learningContext, stage: 'IN_PROGRESS', progressNote: '第一章已复习', version: 2 } }));
      if (url === `/api/core/courses/${courseId}/resource-searches`) return Promise.resolve(response({ data: { run: { id: '00000000-0000-4000-8000-000000000704', courseId, capabilityRunId: '00000000-0000-4000-8000-000000000705', query: '矩阵分解', status: 'AWAITING_DISCLOSURE', citationCount: 0, rejectedCount: 0, failureCode: null, version: 1, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' }, disclosure: { capability: 'PUBLIC_LEARNING_SEARCH', providerId: 'test-search', providerLabel: '自动测试 Fake Search', adapterKind: 'TEST_FAKE', evidenceKind: 'AUTOMATED_FAKE', availability: 'READY' } } }, 201));
      if (url === '/api/core/resource-searches/00000000-0000-4000-8000-000000000704/execute') return Promise.resolve(response({ data: { run: { id: '00000000-0000-4000-8000-000000000704', courseId, capabilityRunId: '00000000-0000-4000-8000-000000000705', query: '矩阵分解', status: 'SUCCEEDED', citationCount: 1, rejectedCount: 0, failureCode: null, version: 3, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:01.000Z' }, citations: [{ id: '00000000-0000-4000-8000-000000000706', courseId, courseResourceId: '00000000-0000-4000-8000-000000000707', searchRunId: '00000000-0000-4000-8000-000000000704', title: '公开矩阵教程', url: 'https://public.example/matrix', publisher: 'public.example', retrievedAt: '2026-08-31T00:00:01.000Z', contentHash: 'a'.repeat(64), mediaType: 'text/html', createdAt: '2026-08-31T00:00:01.000Z' }] } }, 202));
      return Promise.reject(new Error(`unexpected ${url} ${init?.method}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CourseDetailWorkspace courseId={courseId} />);

    expect(await screen.findByRole('heading', { name: '机器学习导论' })).toBeInTheDocument();
    expect(screen.getByText('课程官方')).toBeInTheDocument();
    expect(screen.getByText('你提供')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('学习阶段'), 'IN_PROGRESS');
    await user.type(screen.getByLabelText('进度记录'), '第一章已复习');
    await user.click(screen.getByRole('button', { name: '保存学习进度' }));
    await user.type(screen.getByLabelText('匿名公开检索关键词'), '矩阵分解');
    await user.click(screen.getByRole('button', { name: '准备匿名公开检索' }));
    expect(await screen.findByText(/DISCLOSURE_READY/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认披露并开始检索' }));
    expect(await screen.findAllByText(/public\.example/)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(`/api/core/courses/${courseId}/learning-context`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ expectedVersion: 1, stage: 'IN_PROGRESS', progressNote: '第一章已复习' }) }));
    const executeCall = fetchMock.mock.calls.find(([url]) => url === '/api/core/resource-searches/00000000-0000-4000-8000-000000000704/execute');
    expect(executeCall?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' }) });
    expect(new Headers((executeCall?.[1] as RequestInit).headers).get('idempotency-key')).toMatch(/\S/);
  });

  it('shows BLOCKED_PROVIDER without attempting a search request', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === `/api/core/courses/${courseId}`) return Promise.resolve(response(detail));
      if (url === `/api/core/courses/${courseId}/resource-searches`) return Promise.resolve(response({ data: { run: { id: '00000000-0000-4000-8000-000000000708', courseId, capabilityRunId: '00000000-0000-4000-8000-000000000709', query: '矩阵分解', status: 'BLOCKED_PROVIDER', citationCount: 0, rejectedCount: 0, failureCode: null, version: 1, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' }, disclosure: { capability: 'PUBLIC_LEARNING_SEARCH', providerId: null, providerLabel: '未配置', adapterKind: 'NONE', evidenceKind: 'NONE', availability: 'BLOCKED_PROVIDER' } } }, 201));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CourseDetailWorkspace courseId={courseId} />);
    await user.type(await screen.findByLabelText('匿名公开检索关键词'), '矩阵分解');
    await user.click(screen.getByRole('button', { name: '准备匿名公开检索' }));
    expect(await screen.findByText(/BLOCKED_PROVIDER/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认披露并开始检索' })).not.toBeInTheDocument();
  });

  it('renders Core terminal failure details instead of leaving a search in SEARCHING', async () => {
    const failedRun = { id: '00000000-0000-4000-8000-000000000710', courseId, capabilityRunId: '00000000-0000-4000-8000-000000000711', query: '不安全资料', status: 'FAILED', citationCount: 0, rejectedCount: 1, failureCode: 'NO_SAFE_PUBLIC_RESULTS', version: 3, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:01.000Z' };
    const fetchMock = vi.fn((url: string) => {
      if (url === `/api/core/courses/${courseId}`) return Promise.resolve(response(detail));
      if (url === `/api/core/courses/${courseId}/resource-searches`) return Promise.resolve(response({ data: { run: { ...failedRun, status: 'AWAITING_DISCLOSURE', failureCode: null, version: 1 }, disclosure: { capability: 'PUBLIC_LEARNING_SEARCH', providerId: 'test-search', providerLabel: '自动测试 Fake Search', adapterKind: 'TEST_FAKE', evidenceKind: 'AUTOMATED_FAKE', availability: 'READY' } } }, 201));
      if (url === '/api/core/resource-searches/00000000-0000-4000-8000-000000000710/execute') return Promise.resolve(response({ error: { code: 'NO_SAFE_PUBLIC_RESULTS', message: '没有可安全保存的公开资料', details: { currentRun: failedRun } } }, 422));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CourseDetailWorkspace courseId={courseId} />);
    await user.type(await screen.findByLabelText('匿名公开检索关键词'), '不安全资料');
    await user.click(screen.getByRole('button', { name: '准备匿名公开检索' }));
    await user.click(await screen.findByRole('button', { name: '确认披露并开始检索' }));
    expect(await screen.findByText(/FAILED：NO_SAFE_PUBLIC_RESULTS/)).toBeInTheDocument();
    expect(screen.queryByText(/SEARCHING：/)).not.toBeInTheDocument();
  });

  it('selects immutable citations and sends the saved course objective only after a LearningAdvice disclosure', async () => {
    const citation = {
      id: '00000000-0000-4000-8000-000000000706', courseId, courseResourceId: '00000000-0000-4000-8000-000000000707', searchRunId: '00000000-0000-4000-8000-000000000704',
      title: '公开矩阵教程', url: 'https://public.example/matrix', publisher: 'public.example', retrievedAt: '2026-08-31T00:00:01.000Z', contentHash: 'a'.repeat(64), mediaType: 'text/html', createdAt: '2026-08-31T00:00:01.000Z',
    };
    const learningRun = {
      id: '00000000-0000-4000-8000-000000000712', courseId, searchRunId: citation.searchRunId, capabilityRunId: '00000000-0000-4000-8000-000000000713', citationIds: [citation.id],
      status: 'AWAITING_DISCLOSURE', proposalId: null, failureCode: null, version: 1, createdAt: '2026-08-31T00:00:02.000Z', updatedAt: '2026-08-31T00:00:02.000Z',
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === `/api/core/courses/${courseId}`) return Promise.resolve(response({ data: { ...detail.data, sources: { ...detail.data.sources, public: [citation] } } }));
      if (url === `/api/core/courses/${courseId}/learning-runs`) return Promise.resolve(response({ data: { run: learningRun, disclosure: { capability: 'LEARNING_TEXT_ANALYSIS', providerId: 'test-learning', providerLabel: '自动测试 Fake Learning', adapterKind: 'TEST_FAKE', evidenceKind: 'AUTOMATED_FAKE', availability: 'READY' } } }, 201));
      if (url === `/api/core/learning-runs/${learningRun.id}/generate`) return Promise.resolve(response({
        data: { run: { ...learningRun, status: 'PROPOSAL_PENDING', proposalId: '00000000-0000-4000-8000-000000000714', version: 3 }, proposal: { id: '00000000-0000-4000-8000-000000000714', kind: 'LEARNING', status: 'PENDING', source: 'LEARNING_AGENT', title: '复习矩阵分解', changes: [{ operation: 'CREATE_LEARNING_ACTION', action: { id: '00000000-0000-4000-8000-000000000715', courseId, title: '复习矩阵分解', targetDate: '2026-09-09', status: 'OPEN', kind: 'STUDY', version: 1, createdAt: '2026-08-31T00:00:03.000Z', updatedAt: '2026-08-31T00:00:03.000Z' }, scheduling: { timeRequestId: '00000000-0000-4000-8000-000000000716', durationMinutes: 45, priority: 'MEDIUM', earliestStartLocalTime: '19:00', latestEndLocalTime: '21:00', isFixed: false }, citationIds: [citation.id] }], version: 1, createdAt: '2026-08-31T00:00:03.000Z', expiresAt: null } },
      }, 202));
      return Promise.reject(new Error(`unexpected ${url} ${init?.method}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CourseDetailWorkspace courseId={courseId} />);
    await screen.findByRole('heading', { name: '机器学习导论' });
    await user.click(screen.getByLabelText('选择公开矩阵教程'));
    await user.type(screen.getByLabelText('学习目标'), '完成矩阵分解复习');
    await user.clear(screen.getByLabelText('目标日期'));
    await user.type(screen.getByLabelText('目标日期'), '2026-09-09');
    await user.click(screen.getByRole('button', { name: '准备引用学习建议' }));
    expect(await screen.findByText(/DISCLOSURE_READY/)).toBeInTheDocument();
    expect(screen.getByText('自动测试 Fake 证据，不代表真实 Provider')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认披露并生成学习建议' }));
    expect(await screen.findByText(/PROPOSAL_PENDING/)).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([url]) => url === `/api/core/courses/${courseId}/learning-runs`);
    expect(createCall?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ searchRunId: citation.searchRunId, citationIds: [citation.id], objective: '完成矩阵分解复习', targetDate: '2026-09-09', earliestStartLocalTime: '19:00', latestEndLocalTime: '21:00' }),
    });
    const generateCall = fetchMock.mock.calls.find(([url]) => url === `/api/core/learning-runs/${learningRun.id}/generate`);
    expect(new Headers((generateCall?.[1] as RequestInit).headers).get('idempotency-key')).toMatch(/\S/);
  });
});
