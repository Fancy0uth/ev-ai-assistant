import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleWorkspace } from '@/components/schedule/schedule-workspace';
import { CourseImportReview } from '@/components/schedule/course-import-review';

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

  it('shows a review gate after disclosure instead of confirming a high-confidence screenshot automatically', async () => {
    const term = { id: '00000000-0000-4000-8000-000000000421', title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-08-31', version: 1, createdAt: '2026-08-17T03:00:00.000Z', updatedAt: '2026-08-17T03:00:00.000Z' };
    const artifact = { id: '00000000-0000-4000-8000-000000000422', kind: 'COURSE_SCHEDULE_IMAGE', mediaType: 'image/png', byteSize: 3, width: 1, height: 1, pixelCount: 1, sha256: 'a'.repeat(64), state: 'ACTIVE', version: 1, createdAt: '2026-08-17T03:00:00.000Z', deleteRequestedAt: null, deletedAt: null };
    const imported = { id: '00000000-0000-4000-8000-000000000423', termId: term.id, artifactId: artifact.id, capabilityRunId: '00000000-0000-4000-8000-000000000424', status: 'AWAITING_DISCLOSURE', currentRevisionId: null, scheduleProposalId: null, failureCode: null, version: 1, createdAt: '2026-08-17T03:00:00.000Z', updatedAt: '2026-08-17T03:00:00.000Z' };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/core/terms' && init?.method === 'GET') return Promise.resolve(jsonResponse({ data: [term] }));
      if (url === '/api/core/proposals?status=PENDING' && init?.method === 'GET') return Promise.resolve(jsonResponse({ data: [] }));
      if (url === '/api/core/course-artifacts' && init?.method === 'POST') return Promise.resolve(jsonResponse({ data: { artifact, deduplicated: false } }, 201));
      if (url === '/api/core/course-imports' && init?.method === 'POST') return Promise.resolve(jsonResponse({ data: { import: imported, disclosure: { version: 'CAPABILITY_DISCLOSURE_V1', purpose: '提取课表候选', selectedData: ['课表图片'], providerId: 'test-vision', providerLabel: '自动测试 Fake Vision', adapterKind: 'TEST_FAKE', evidenceKind: 'AUTOMATED_FAKE' } } }, 201));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ScheduleWorkspace />);
    const file = new File(['png'], 'schedule.png', { type: 'image/png' });
    fireEvent.change(await screen.findByLabelText('课表截图'), { target: { files: [file] } });
    await user.click(screen.getByRole('button', { name: '保存并查看外发披露' }));

    expect(await screen.findByRole('button', { name: '确认披露并提取候选' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '确认导入课程' })).not.toBeInTheDocument();
  });

  it('lets the Owner edit or exclude a candidate while keeping confidence and provenance visible', async () => {
    const initial = { import: { id: '00000000-0000-4000-8000-000000000431', termId: '00000000-0000-4000-8000-000000000432', artifactId: '00000000-0000-4000-8000-000000000433', capabilityRunId: '00000000-0000-4000-8000-000000000434', status: 'REVIEW_REQUIRED' as const, currentRevisionId: '00000000-0000-4000-8000-000000000435', scheduleProposalId: null, failureCode: null, version: 3, createdAt: '2026-08-17T03:00:00.000Z', updatedAt: '2026-08-17T03:00:00.000Z' }, disclosure: { version: 'CAPABILITY_DISCLOSURE_V1' as const, purpose: '提取课表候选', selectedData: ['课表图片'], providerId: 'test-vision', providerLabel: '自动测试 Fake Vision', adapterKind: 'TEST_FAKE' as const, evidenceKind: 'AUTOMATED_FAKE' as const }, revision: { id: '00000000-0000-4000-8000-000000000435', importId: '00000000-0000-4000-8000-000000000431', parentRevisionId: null, revisionNo: 1, contentHash: 'a'.repeat(64), createdBy: 'VISION' as const, createdAt: '2026-08-17T03:00:00.000Z', candidates: [{ candidateId: '00000000-0000-4000-8000-000000000436', included: true, title: '数据库系统', location: 'A101', weekday: 1, startLocalTime: '08:00', endLocalTime: '09:40', weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK' as const, confidence: { overall: 1, fields: { title: 1, location: .8, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } }, provenance: [{ kind: 'VISION_OUTPUT' as const, providerId: 'test-vision', capabilityRunId: '00000000-0000-4000-8000-000000000434', editedFields: [], capturedAt: '2026-08-17T03:00:00.000Z' }] }] } };
    const saved = { ...initial, import: { ...initial.import, version: 4, currentRevisionId: '00000000-0000-4000-8000-000000000437' }, revision: { ...initial.revision, id: '00000000-0000-4000-8000-000000000437', parentRevisionId: initial.revision.id, revisionNo: 2 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: saved }, 201)); vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup(); render(<CourseImportReview initial={initial} onUpdated={vi.fn()} />);
    expect(screen.getByLabelText('包含课程：数据库系统')).toBeChecked();
    expect(screen.getByLabelText('课程标题：数据库系统')).toHaveValue('数据库系统');
    expect(screen.getByText(/字段置信度/)).toBeInTheDocument();
    expect(screen.getByText(/VISION_OUTPUT/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认导入课程' })).not.toBeInTheDocument();
    const titleInput = screen.getByLabelText('课程标题：数据库系统');
    await user.click(screen.getByLabelText('包含课程：数据库系统')); await user.clear(titleInput); await user.type(titleInput, '数据库导论'); await user.click(screen.getByRole('button', { name: '保存审阅版本' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认导入课程' })).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith('/api/core/course-imports/00000000-0000-4000-8000-000000000431/revisions', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"included":false') }));
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toContain('数据库导论');
  });
});
