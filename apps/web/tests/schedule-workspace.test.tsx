import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { courseImportResponseSchema } from '@ev/contracts';
import { ScheduleWorkspace } from '@/components/schedule/schedule-workspace';
import { CourseImportReview } from '@/components/schedule/course-import-review';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function importFlowFixtures() {
  const disclosure = {
    version: 'CAPABILITY_DISCLOSURE_V1' as const, purpose: '提取课表候选', selectedData: ['课表图片'],
    providerId: 'test-vision', providerLabel: '自动测试 Fake Vision', adapterKind: 'TEST_FAKE' as const,
    evidenceKind: 'AUTOMATED_FAKE' as const,
  };
  const baseImport = {
    id: '00000000-0000-4000-8000-000000000451', termId: '00000000-0000-4000-8000-000000000452',
    artifactId: '00000000-0000-4000-8000-000000000453', capabilityRunId: '00000000-0000-4000-8000-000000000454',
    currentRevisionId: null, scheduleProposalId: null, failureCode: null,
    createdAt: '2026-08-31T03:00:00.000Z', updatedAt: '2026-08-31T03:00:00.000Z',
  };
  const candidate = {
    candidateId: '00000000-0000-4000-8000-000000000456', included: true, title: '编译原理', location: 'A202',
    weekday: 3 as const, startLocalTime: '10:00', endLocalTime: '11:40', weekStart: 1, weekEnd: 16,
    weekPattern: 'EVERY_WEEK' as const,
    confidence: { overall: 1, fields: { title: 1, location: 1, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } },
    provenance: [{
      kind: 'VISION_OUTPUT' as const, providerId: 'test-vision', capabilityRunId: baseImport.capabilityRunId,
      editedFields: [], capturedAt: '2026-08-31T03:01:00.000Z',
    }],
  };
  const extractedRevision = {
    id: '00000000-0000-4000-8000-000000000455', importId: baseImport.id, parentRevisionId: null,
    revisionNo: 1, candidates: [candidate], contentHash: 'b'.repeat(64), createdBy: 'VISION' as const,
    createdAt: '2026-08-31T03:01:00.000Z',
  };
  const savedRevision = {
    ...extractedRevision, id: '00000000-0000-4000-8000-000000000457', parentRevisionId: extractedRevision.id,
    revisionNo: 2, contentHash: 'c'.repeat(64), createdBy: 'OWNER' as const, createdAt: '2026-08-31T03:02:00.000Z',
  };
  const initial = courseImportResponseSchema.parse({ data: {
    import: { ...baseImport, status: 'AWAITING_DISCLOSURE', version: 1 }, disclosure, revision: null,
  } }).data;
  const extracted = courseImportResponseSchema.parse({ data: {
    import: { ...baseImport, status: 'REVIEW_REQUIRED', currentRevisionId: extractedRevision.id, version: 3 },
    disclosure, revision: extractedRevision,
  } }).data;
  const saved = courseImportResponseSchema.parse({ data: {
    import: { ...baseImport, status: 'REVIEW_REQUIRED', currentRevisionId: savedRevision.id, version: 4 },
    disclosure, revision: savedRevision,
  } }).data;
  const confirmed = courseImportResponseSchema.parse({ data: {
    import: {
      ...baseImport, status: 'SCHEDULE_PROPOSAL_PENDING', currentRevisionId: savedRevision.id,
      scheduleProposalId: '00000000-0000-4000-8000-000000000458', version: 5,
    },
    disclosure, revision: savedRevision,
  } }).data;
  return { initial, extracted, saved, confirmed };
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

  it('reuses separate extract and confirm keys with identical bodies across uncertain committed writes', async () => {
    const fixtures = importFlowFixtures();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('transport response lost'))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'CORE_UPSTREAM_UNAVAILABLE', message: 'BFF 未读取到 Core 响应' } }, 502))
      .mockResolvedValueOnce(jsonResponse({ data: { unreadable: true } }, 202))
      .mockResolvedValueOnce(jsonResponse({ data: fixtures.extracted }, 202))
      .mockResolvedValueOnce(jsonResponse({ data: fixtures.saved }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'CORE_UPSTREAM_UNAVAILABLE', message: 'BFF 未读取到确认响应' } }, 502))
      .mockResolvedValueOnce(jsonResponse({ data: fixtures.confirmed }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CourseImportReview initial={fixtures.initial} onUpdated={vi.fn()} />);

    const extractButton = screen.getByRole('button', { name: '确认披露并提取候选' });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await user.click(extractButton);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(attempt));
      if (attempt < 4) await screen.findByRole('alert');
    }
    expect(await screen.findByRole('heading', { name: '审阅课表候选' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存审阅版本' }));
    expect(await screen.findByRole('button', { name: '确认导入课程' })).toBeEnabled();
    const confirmButton = screen.getByRole('button', { name: '确认导入课程' });
    await user.click(confirmButton);
    await screen.findByRole('alert');
    await user.click(confirmButton);
    expect(await screen.findByRole('heading', { name: '课程排程待确认' })).toBeInTheDocument();

    const extractCalls = fetchMock.mock.calls.slice(0, 4).map((call) => call[1] as RequestInit);
    const confirmCalls = fetchMock.mock.calls.slice(5, 7).map((call) => call[1] as RequestInit);
    expect(extractCalls.map((init) => new Headers(init.headers).get('idempotency-key')))
      .toEqual(Array(4).fill(new Headers(extractCalls[0]!.headers).get('idempotency-key')));
    expect(extractCalls.map((init) => init.body)).toEqual(Array(4).fill(extractCalls[0]!.body));
    expect(confirmCalls.map((init) => new Headers(init.headers).get('idempotency-key')))
      .toEqual(Array(2).fill(new Headers(confirmCalls[0]!.headers).get('idempotency-key')));
    expect(confirmCalls.map((init) => init.body)).toEqual(Array(2).fill(confirmCalls[0]!.body));
    expect(new Headers(extractCalls[0]!.headers).get('idempotency-key'))
      .not.toBe(new Headers(confirmCalls[0]!.headers).get('idempotency-key'));
  });

  it('starts a new extract key after a definite Core error', async () => {
    const fixtures = importFlowFixtures();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'VERSION_CONFLICT', message: '课表导入状态已变化' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ data: fixtures.extracted }, 202));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CourseImportReview initial={fixtures.initial} onUpdated={vi.fn()} />);
    const button = screen.getByRole('button', { name: '确认披露并提取候选' });

    await user.click(button);
    await screen.findByRole('alert');
    await user.click(button);
    expect(await screen.findByRole('heading', { name: '审阅课表候选' })).toBeInTheDocument();

    const calls = fetchMock.mock.calls.map((call) => call[1] as RequestInit);
    expect(new Headers(calls[0]!.headers).get('idempotency-key'))
      .not.toBe(new Headers(calls[1]!.headers).get('idempotency-key'));
    expect(calls[1]!.body).toBe(calls[0]!.body);
  });

  it('starts a new confirm key after a definite Core error', async () => {
    const fixtures = importFlowFixtures();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: fixtures.saved }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'VERSION_CONFLICT', message: '课表确认状态已变化' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ data: fixtures.confirmed }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CourseImportReview initial={fixtures.extracted} onUpdated={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '保存审阅版本' }));
    const button = await screen.findByRole('button', { name: '确认导入课程' });

    await user.click(button);
    await screen.findByRole('alert');
    await user.click(button);
    expect(await screen.findByRole('heading', { name: '课程排程待确认' })).toBeInTheDocument();

    const calls = fetchMock.mock.calls.slice(1).map((call) => call[1] as RequestInit);
    expect(new Headers(calls[0]!.headers).get('idempotency-key'))
      .not.toBe(new Headers(calls[1]!.headers).get('idempotency-key'));
    expect(calls[1]!.body).toBe(calls[0]!.body);
  });
});
