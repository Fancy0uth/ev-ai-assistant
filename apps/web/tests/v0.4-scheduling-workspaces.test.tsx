import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DailyPlanWorkspace } from '@/components/daily-plan/daily-plan-workspace';
import { TaskDetailWorkspace, EventDetailWorkspace, ProjectDetailWorkspace } from '@/components/details/entity-detail-workspaces';
import { ManualEventProposalPanel } from '@/components/schedule/manual-event-proposal-panel';
import { TodayDashboard } from '@/components/today/today-dashboard';
import {
  useDailyPlanPreflight,
  type DailyPlanPreflightController,
} from '@/components/daily-plan/use-daily-plan-preflight';
import type { DailyPlanProposal } from '@ev/contracts';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const dateA = '2026-08-24';
const dateB = '2026-08-25';
const preflightId = '00000000-0000-4000-8000-000000000701';
const proposalId = '00000000-0000-4000-8000-000000000702';
const eventId = '00000000-0000-4000-8000-000000000703';
const taskIdA = '00000000-0000-4000-8000-000000000704';
const taskIdB = '00000000-0000-4000-8000-000000000705';
const projectIdA = '00000000-0000-4000-8000-000000000706';
const projectIdB = '00000000-0000-4000-8000-000000000707';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function preflightPayload(
  status: 'AWAITING_APPROVAL' | 'APPROVED',
  version: number,
  localDate = dateA,
) {
  return {
    data: {
      id: preflightId,
      runId: '00000000-0000-4000-8000-000000000708',
      contractVersion: 'DAILY_PLAN_PREFLIGHT_V1',
      localDate,
      status,
      baseScheduleVersion: 1,
      items: [
        {
          contextRef: 'TIME_REQUEST_1',
          safeTitle: 'Architecture review',
          domain: 'WORK',
          deadlineLocalDate: dateA,
          durationMinutes: 60,
          priority: 'HIGH',
          availability: { earliestStartLocalTime: '09:00', latestEndLocalTime: '17:00' },
          isFixed: false,
          included: true,
        },
        {
          contextRef: 'TIME_REQUEST_2',
          safeTitle: 'Write test evidence',
          domain: 'STUDY',
          deadlineLocalDate: null,
          durationMinutes: 45,
          priority: 'MEDIUM',
          availability: { earliestStartLocalTime: null, latestEndLocalTime: null },
          isFixed: true,
          included: true,
        },
      ],
      version,
      createdAt: '2026-08-24T01:00:00.000Z',
      updatedAt: '2026-08-24T01:00:00.000Z',
      approvedAt: status === 'APPROVED' ? '2026-08-24T01:01:00.000Z' : null,
      claimedAt: null,
      consumedAt: null,
    },
  };
}

function generatedProposalPayload() {
  return {
    data: {
      id: '00000000-0000-4000-8000-000000000709',
      contractVersion: 'DAILY_PLAN_V1',
      runId: '00000000-0000-4000-8000-000000000708',
      localDate: dateA,
      status: 'PENDING_REVIEW',
      baseScheduleVersion: 1,
      summary: '等待审核的每日计划。',
      items: [],
      version: 1,
      createdAt: '2026-08-24T01:02:00.000Z',
      updatedAt: '2026-08-24T01:02:00.000Z',
    },
  };
}

function emptyReviewList() {
  return { data: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } };
}

function taskPayload(id: string, title: string) {
  return {
    data: {
      id,
      title,
      area: 'WORK',
      priority: 'HIGH',
      status: 'OPEN',
      targetDate: dateA,
      completedAt: null,
      scheduling: null,
      version: 1,
      createdAt: '2026-08-24T01:00:00.000Z',
      updatedAt: '2026-08-24T01:00:00.000Z',
    },
  };
}

function eventPayload(id = eventId) {
  return {
    id,
    calendarRuleId: null,
    title: 'Team review',
    kind: 'MEETING',
    localDate: dateA,
    startLocalTime: '14:00',
    endLocalTime: '15:00',
    isHard: true,
    status: 'CONFIRMED',
    version: 1,
    createdAt: '2026-08-24T01:00:00.000Z',
    updatedAt: '2026-08-24T01:00:00.000Z',
  };
}

function scheduleProposal(
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED',
  version = 1,
  id = proposalId,
) {
  return {
    id,
    kind: 'SCHEDULE',
    status,
    source: 'DAILY_SCHEDULER',
    title: 'Team review proposal',
    changes: [{ operation: 'CREATE_EVENT', event: eventPayload() }],
    version,
    createdAt: '2026-08-24T01:00:00.000Z',
    expiresAt: null,
  };
}

function projectSnapshot(id: string, label: string) {
  return {
    data: {
      scope: {
        id,
        label,
        rootPath: `C:\\projects\\${label}`,
        createdAt: '2026-08-24T01:00:00.000Z',
        updatedAt: '2026-08-24T01:00:00.000Z',
      },
      files: [{ relativePath: 'PRD.md', content: `# ${label}` }],
    },
  };
}

function todaySnapshot() {
  return {
    data: {
      date: dateA,
      status: { score: 80, level: 'STEADY', source: 'RULES_V1', reasons: ['节奏稳定'], priorities: [] },
      tasks: [],
      events: [],
      signals: [],
      pendingProposals: [],
      yesterday: null,
      dailyPlan: { status: 'NOT_CONFIGURED', proposalId: null, pendingItemCount: 0 },
      agents: { deepSeek: 'NOT_CONFIGURED', codex: 'NOT_CONFIGURED' },
    },
  };
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, path: string): unknown {
  const call = fetchMock.mock.calls.find(([url]) => url === `/api/core/${path}`);
  return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
}

function PreflightHookHarness({
  localDate,
  onGenerated = vi.fn(),
  controllerRef,
}: {
  localDate: string;
  onGenerated?: (proposal: DailyPlanProposal) => void;
  controllerRef?: { current: DailyPlanPreflightController | null };
}) {
  const controller = useDailyPlanPreflight({ localDate, onGenerated });
  useEffect(() => {
    if (controllerRef) controllerRef.current = controller;
  }, [controller, controllerRef]);
  const preflight = 'preflight' in controller.state ? controller.state.preflight : null;
  const drafts = 'draftItems' in controller.state ? controller.state.draftItems : null;
  return (
    <>
      <p data-testid="phase">{controller.state.phase}</p>
      <p data-testid="preflight-id">{preflight?.id ?? 'none'}</p>
      <p data-testid="draft-count">{drafts?.length ?? 'none'}</p>
      <button type="button" onClick={() => void controller.prepare()}>prepare</button>
      <button type="button" onClick={() => void controller.approve()}>approve</button>
      <button type="button" onClick={() => void controller.generate()}>generate</button>
    </>
  );
}

describe('V4-06 scheduling workspaces', () => {
  it('requires a separate approved preflight before generate and sends only reviewed mutable fields', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('daily-plans/proposals')) return Promise.resolve(jsonResponse(emptyReviewList()));
      if (url === '/api/core/daily-plans/preflights') return Promise.resolve(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201));
      if (url === `/api/core/daily-plans/preflights/${preflightId}/approve`) return Promise.resolve(jsonResponse(preflightPayload('APPROVED', 2)));
      if (url === '/api/core/daily-plans/generate') return Promise.resolve(jsonResponse(generatedProposalPayload(), 201));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace initialDate={dateA} />);

    await screen.findByText('还没有该日期的每日计划');
    expect(screen.queryByRole('button', { name: '调用 Provider 生成草案' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '准备外发内容' }));
    expect(await screen.findAllByText('时长')).toHaveLength(2);
    expect(screen.getAllByText('优先级')).toHaveLength(2);
    expect(screen.getAllByText('可用时段')).toHaveLength(2);
    expect(screen.getAllByText('固定安排')).toHaveLength(2);

    await user.clear(screen.getByLabelText('安全标题：Architecture review'));
    await user.type(screen.getByLabelText('安全标题：Architecture review'), 'Reviewed architecture');
    await user.selectOptions(screen.getByLabelText('领域：Architecture review'), 'STUDY');
    await user.clear(screen.getByLabelText('截止日期：Architecture review'));
    await user.type(screen.getByLabelText('截止日期：Architecture review'), '2026-08-25');
    await user.click(screen.getByLabelText('包含/排除：Write test evidence'));
    await user.click(screen.getByRole('button', { name: '批准外发内容' }));

    expect(await screen.findByRole('button', { name: '调用 Provider 生成草案' })).toBeInTheDocument();
    expect(requestBody(fetchMock, `daily-plans/preflights/${preflightId}/approve`)).toEqual({
      expectedPreflightVersion: 1,
      items: [
        { contextRef: 'TIME_REQUEST_1', safeTitle: 'Reviewed architecture', domain: 'STUDY', deadlineLocalDate: dateB, included: true },
        { contextRef: 'TIME_REQUEST_2', safeTitle: 'Write test evidence', domain: 'STUDY', deadlineLocalDate: null, included: false },
      ],
    });
    expect(JSON.stringify(requestBody(fetchMock, `daily-plans/preflights/${preflightId}/approve`))).not.toContain('durationMinutes');
    expect(JSON.stringify(requestBody(fetchMock, `daily-plans/preflights/${preflightId}/approve`))).not.toContain('availability');

    await user.click(screen.getByRole('button', { name: '调用 Provider 生成草案' }));
    expect(requestBody(fetchMock, 'daily-plans/generate')).toEqual({ preflightId, expectedPreflightVersion: 2 });
  });

  it('sends exactly one generate request for synchronous double generate after approval', async () => {
    const pendingGenerate = deferred<Response>();
    const onGenerated = vi.fn();
    const controllerRef: { current: DailyPlanPreflightController | null } = { current: null };
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/daily-plans/preflights') return Promise.resolve(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201));
      if (url === `/api/core/daily-plans/preflights/${preflightId}/approve`) return Promise.resolve(jsonResponse(preflightPayload('APPROVED', 2)));
      if (url === '/api/core/daily-plans/generate') return pendingGenerate.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PreflightHookHarness localDate={dateA} onGenerated={onGenerated} controllerRef={controllerRef} />);

    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('reviewing'));
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('approved'));
    act(() => {
      void controllerRef.current?.generate();
      void controllerRef.current?.generate();
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/daily-plans/generate')).toHaveLength(1);
    await act(async () => {
      pendingGenerate.resolve(jsonResponse(generatedProposalPayload(), 201));
      await pendingGenerate.promise;
    });
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
  });

  it('keeps the prepare action disabled and announced while a local preflight is pending', async () => {
    const pendingPrepare = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('daily-plans/proposals')) return Promise.resolve(jsonResponse(emptyReviewList()));
      if (url === '/api/core/daily-plans/preflights') return pendingPrepare.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace initialDate={dateA} />);
    await screen.findByText('还没有该日期的每日计划');
    await user.click(screen.getByRole('button', { name: '准备外发内容' }));

    expect(screen.getByRole('button', { name: '正在准备外发内容…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在准备外发内容…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByText(/不会调用 Provider/)).not.toHaveLength(0);
  });

  it('keeps the explicit generate action disabled while the Provider request is pending', async () => {
    const pendingGenerate = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('daily-plans/proposals')) return Promise.resolve(jsonResponse(emptyReviewList()));
      if (url === '/api/core/daily-plans/preflights') return Promise.resolve(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201));
      if (url === `/api/core/daily-plans/preflights/${preflightId}/approve`) return Promise.resolve(jsonResponse(preflightPayload('APPROVED', 2)));
      if (url === '/api/core/daily-plans/generate') return pendingGenerate.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace initialDate={dateA} />);
    await screen.findByText('还没有该日期的每日计划');
    await user.click(screen.getByRole('button', { name: '准备外发内容' }));
    await user.click(await screen.findByRole('button', { name: '批准外发内容' }));
    await user.click(await screen.findByRole('button', { name: '调用 Provider 生成草案' }));

    expect(screen.getByRole('button', { name: '正在生成草案…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在生成草案…' })).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps a date-B prepare busy when a stale date-A approve finally settles', async () => {
    const lateApprove = deferred<Response>();
    const latePrepareB = deferred<Response>();
    let prepareCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/daily-plans/preflights') {
        prepareCount += 1;
        return prepareCount === 1
          ? Promise.resolve(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201))
          : latePrepareB.promise;
      }
      if (url === `/api/core/daily-plans/preflights/${preflightId}/approve`) return lateApprove.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const rendered = render(<PreflightHookHarness localDate={dateA} />);
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('reviewing'));
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('approving'));
    rendered.rerender(<PreflightHookHarness localDate={dateB} />);
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('preparing'));

    await act(async () => {
      lateApprove.resolve(jsonResponse(preflightPayload('APPROVED', 2, dateA)));
      await lateApprove.promise;
    });

    expect(screen.getByTestId('phase')).toHaveTextContent('preparing');
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    expect(prepareCount).toBe(2);
    await act(async () => {
      latePrepareB.resolve(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1, dateB), 201));
      await latePrepareB.promise;
    });
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('reviewing'));
  });

  it('does not call the external generated callback when a date-A generate becomes stale', async () => {
    const lateGenerate = deferred<Response>();
    const latePrepareB = deferred<Response>();
    const onGenerated = vi.fn();
    let prepareCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/daily-plans/preflights') {
        prepareCount += 1;
        return prepareCount === 1
          ? Promise.resolve(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201))
          : latePrepareB.promise;
      }
      if (url === `/api/core/daily-plans/preflights/${preflightId}/approve`) return Promise.resolve(jsonResponse(preflightPayload('APPROVED', 2)));
      if (url === '/api/core/daily-plans/generate') return lateGenerate.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const rendered = render(<PreflightHookHarness localDate={dateA} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('reviewing'));
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('approved'));
    fireEvent.click(screen.getByRole('button', { name: 'generate' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('generating'));
    rendered.rerender(<PreflightHookHarness localDate={dateB} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('preparing'));

    await act(async () => {
      lateGenerate.resolve(jsonResponse(generatedProposalPayload(), 201));
      await lateGenerate.promise;
    });

    expect(onGenerated).not.toHaveBeenCalled();
    expect(screen.getByTestId('phase')).toHaveTextContent('preparing');
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    expect(prepareCount).toBe(2);
  });

  it('does not call the external generated callback after the hook unmounts', async () => {
    const lateGenerate = deferred<Response>();
    const onGenerated = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/daily-plans/preflights') return Promise.resolve(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201));
      if (url === `/api/core/daily-plans/preflights/${preflightId}/approve`) return Promise.resolve(jsonResponse(preflightPayload('APPROVED', 2)));
      if (url === '/api/core/daily-plans/generate') return lateGenerate.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const rendered = render(<PreflightHookHarness localDate={dateA} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('reviewing'));
    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('approved'));
    fireEvent.click(screen.getByRole('button', { name: 'generate' }));
    rendered.unmount();

    await act(async () => {
      lateGenerate.resolve(jsonResponse(generatedProposalPayload(), 201));
      await lateGenerate.promise;
    });

    expect(onGenerated).not.toHaveBeenCalled();
  });

  it.each([
    ['401', jsonResponse({ error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录' } }, 401)],
    ['404', jsonResponse({ error: { code: 'PREFLIGHT_NOT_FOUND', message: '已失效' } }, 404)],
    ['409', jsonResponse({ error: { code: 'VERSION_CONFLICT', message: '已变化' } }, 409)],
    ['503', jsonResponse({ error: { code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE', message: 'Provider 暂不可用' } }, 503)],
    ['422', jsonResponse({ error: { code: 'VALIDATION_FAILED', message: '输入无效' } }, 422)],
    ['malformed response', jsonResponse({ data: {} }, 201)],
  ])('blocks %s prepare responses without retaining sensitive preflight data', async (_case, response) => {
    const onGenerated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    render(<PreflightHookHarness localDate={dateA} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByRole('button', { name: 'prepare' }));

    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('blocked'));
    expect(screen.getByTestId('preflight-id')).toHaveTextContent('none');
    expect(screen.getByTestId('draft-count')).toHaveTextContent('none');
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('sends the optional Task scheduling body exactly and keeps the selected date top-level', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(todaySnapshot()))
      .mockResolvedValueOnce(jsonResponse(taskPayload(taskIdA, '完成 V4-06'), 201))
      .mockResolvedValueOnce(jsonResponse(todaySnapshot()));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate={dateA} />);
    await screen.findByText('今天还没有任务');
    expect(screen.getByText(`计划日期：${dateA}`)).toBeInTheDocument();
    await user.type(screen.getByLabelText('新任务'), '完成 V4-06');
    await user.selectOptions(screen.getByLabelText('优先级'), 'HIGH');
    await user.click(screen.getByLabelText('加入每日计划'));
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    expect(requestBody(fetchMock, 'tasks')).toEqual({
      title: '完成 V4-06',
      area: 'WORK',
      priority: 'HIGH',
      targetDate: dateA,
      scheduling: {
        durationMinutes: 60,
        earliestStartLocalTime: null,
        latestEndLocalTime: null,
        isFixed: false,
      },
    });
  });

  it('keeps invalid task scheduling drafts local and associates the validation error with the field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(todaySnapshot()));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TodayDashboard initialDate={dateA} />);
    await screen.findByText('今天还没有任务');
    await user.type(screen.getByLabelText('新任务'), '完成 V4-06');
    await user.click(screen.getByLabelText('加入每日计划'));
    await user.clear(screen.getByLabelText('预计时长（分钟）'));
    await user.type(screen.getByLabelText('预计时长（分钟）'), '4');
    await user.click(screen.getByRole('button', { name: '添加到今天' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('预计时长');
    expect(screen.getByLabelText('新任务')).toHaveValue('完成 V4-06');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a nested confirmed Event as pending until the outer Proposal is accepted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [scheduleProposal('PENDING')] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ManualEventProposalPanel initialDate={dateA} />);

    expect(await screen.findByText('待确认 · 尚未写入日程')).toBeInTheDocument();
    expect(screen.queryByText('已确认 · 已写入日程')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看日程详情：Team review' })).not.toBeInTheDocument();
  });

  it('creates a pending Event Proposal with six fields and exposes an Event link only after accepted decision', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: scheduleProposal('PENDING') }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: scheduleProposal('ACCEPTED', 2) }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await screen.findByText('还没有待确认的手工日程。');
    await user.type(screen.getByLabelText('日程标题'), 'Team review');
    await user.selectOptions(screen.getByLabelText('日程类型'), 'MEETING');
    await user.clear(screen.getByLabelText('开始时间'));
    await user.type(screen.getByLabelText('开始时间'), '14:00');
    await user.clear(screen.getByLabelText('结束时间'));
    await user.type(screen.getByLabelText('结束时间'), '15:00');
    await user.click(screen.getByLabelText('固定安排'));
    await user.click(screen.getByRole('button', { name: '创建待确认日程' }));

    expect(requestBody(fetchMock, 'event-proposals')).toEqual({
      title: 'Team review', kind: 'MEETING', localDate: dateA, startLocalTime: '14:00', endLocalTime: '15:00', isHard: true,
    });
    expect(await screen.findByText('待确认 · 尚未写入日程')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看日程详情：Team review' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认写入日程' }));

    expect(requestBody(fetchMock, `proposals/${proposalId}/decision`)).toEqual({ version: 1, decision: 'ACCEPT' });
    expect(await screen.findByText('已确认 · 已写入日程')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看日程详情：Team review' })).toHaveAttribute('href', `/schedule/events/${eventId}`);
  });

  it('settles a deferred list loading state after a manual Event create succeeds', async () => {
    const lateList = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/proposals?status=PENDING') return lateList.promise;
      if (url === '/api/core/event-proposals') return Promise.resolve(jsonResponse({ data: scheduleProposal('PENDING') }, 201));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/core/proposals?status=PENDING', expect.anything()));
    await user.type(screen.getByLabelText('日程标题'), 'Team review');
    await user.click(screen.getByRole('button', { name: '创建待确认日程' }));

    expect(await screen.findByText('待确认 · 尚未写入日程')).toBeInTheDocument();
    expect(screen.queryByText('正在读取待确认手工日程…')).not.toBeInTheDocument();
  });

  it('settles a deferred list loading state after a manual Event create fails', async () => {
    const lateList = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/proposals?status=PENDING') return lateList.promise;
      if (url === '/api/core/event-proposals') {
        return Promise.resolve(jsonResponse({ error: { code: 'EVENT_PROPOSAL_FAILED', message: '创建失败' } }, 500));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/core/proposals?status=PENDING', expect.anything()));
    await user.type(screen.getByLabelText('日程标题'), 'Team review');
    await user.click(screen.getByRole('button', { name: '创建待确认日程' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('创建失败');
    expect(screen.queryByText('正在读取待确认手工日程…')).not.toBeInTheDocument();
  });

  it('admits only outer pending manual Event proposals from the pending list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [scheduleProposal('ACCEPTED')] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ManualEventProposalPanel initialDate={dateA} />);

    expect(await screen.findByText('还没有待确认的手工日程。')).toBeInTheDocument();
    expect(screen.queryByText('已确认 · 已写入日程')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看日程详情：Team review' })).not.toBeInTheDocument();
  });

  it('rejects an accepted response to manual Event creation before it can expose an Event link', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/proposals?status=PENDING') return Promise.resolve(jsonResponse({ data: [] }));
      if (url === '/api/core/event-proposals') return Promise.resolve(jsonResponse({ data: scheduleProposal('ACCEPTED') }, 201));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await screen.findByText('还没有待确认的手工日程。');
    await user.type(screen.getByLabelText('日程标题'), 'Team review');
    await user.click(screen.getByRole('button', { name: '创建待确认日程' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('已确认 · 已写入日程')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看日程详情：Team review' })).not.toBeInTheDocument();
  });

  it.each([
    ['ACCEPT', 'PENDING same id', scheduleProposal('PENDING', 2)],
    ['ACCEPT', 'ACCEPTED wrong id', scheduleProposal('ACCEPTED', 2, taskIdA)],
    ['REJECT', 'ACCEPTED same id', scheduleProposal('ACCEPTED', 2)],
  ] as const)('keeps manual Event decisions safe for a schema-valid %s response: %s', async (decision, _responseLabel, response) => {
    let listCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/proposals?status=PENDING') {
        listCalls += 1;
        return Promise.resolve(jsonResponse({ data: listCalls === 1 ? [scheduleProposal('PENDING')] : [] }));
      }
      if (url === `/api/core/proposals/${proposalId}/decision`) return Promise.resolve(jsonResponse({ data: response }));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await screen.findByText('待确认 · 尚未写入日程');
    await user.click(screen.getByRole('button', { name: decision === 'ACCEPT' ? '确认写入日程' : '拒绝写入日程' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('已确认 · 已写入日程')).not.toBeInTheDocument();
    expect(screen.queryByText('已拒绝 · 未写入日程')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看日程详情：Team review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认写入日程' })).not.toBeInTheDocument();
  });

  it('replaces a Manual Event card from a version conflict instead of guessing confirmation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [scheduleProposal('PENDING')] }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'VERSION_CONFLICT', message: '已更新', details: { currentProposal: scheduleProposal('REJECTED', 2) } } }, 409));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await screen.findByText('待确认 · 尚未写入日程');
    await user.click(screen.getByRole('button', { name: '拒绝写入日程' }));

    expect(await screen.findByText('已拒绝 · 未写入日程')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '查看日程详情：Team review' })).not.toBeInTheDocument();
  });

  it('removes a stale card before a malformed conflict reload settles and never re-posts its version', async () => {
    const lateReload = deferred<Response>();
    let listCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/proposals?status=PENDING') {
        listCalls += 1;
        return listCalls === 1
          ? Promise.resolve(jsonResponse({ data: [scheduleProposal('PENDING')] }))
          : lateReload.promise;
      }
      if (url === `/api/core/proposals/${proposalId}/decision`) {
        return Promise.resolve(jsonResponse({ error: { code: 'VERSION_CONFLICT', message: '已更新', details: {} } }, 409));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await screen.findByText('待确认 · 尚未写入日程');
    const staleAccept = screen.getByRole('button', { name: '确认写入日程' });
    await user.click(staleAccept);
    await waitFor(() => expect(listCalls).toBe(2));

    expect(screen.queryByRole('button', { name: '确认写入日程' })).not.toBeInTheDocument();
    fireEvent.click(staleAccept);
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/core/proposals/${proposalId}/decision`)).toHaveLength(1);
    await act(async () => {
      lateReload.resolve(jsonResponse({ error: { code: 'PROPOSAL_LIST_UNAVAILABLE', message: '重新读取失败' } }, 500));
      await lateReload.promise;
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('重新读取失败');
    expect(screen.getByRole('button', { name: '重新读取待确认手工日程' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '确认写入日程' })).not.toBeInTheDocument();
  });

  it('rejects a parseable conflict replacement for another Proposal id', async () => {
    let listCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/proposals?status=PENDING') {
        listCalls += 1;
        return Promise.resolve(jsonResponse({ data: listCalls === 1 ? [scheduleProposal('PENDING')] : [] }));
      }
      if (url === `/api/core/proposals/${proposalId}/decision`) {
        return Promise.resolve(jsonResponse({
          error: {
            code: 'VERSION_CONFLICT',
            message: '已更新',
            details: { currentProposal: scheduleProposal('REJECTED', 2, taskIdA) },
          },
        }, 409));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await screen.findByText('待确认 · 尚未写入日程');
    await user.click(screen.getByRole('button', { name: '拒绝写入日程' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('已拒绝 · 未写入日程')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认写入日程' })).not.toBeInTheDocument();
  });

  it('rejects a parseable conflict replacement that is not a manual Event proposal', async () => {
    let listCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/proposals?status=PENDING') {
        listCalls += 1;
        return Promise.resolve(jsonResponse({ data: listCalls === 1 ? [scheduleProposal('PENDING')] : [] }));
      }
      if (url === `/api/core/proposals/${proposalId}/decision`) {
        return Promise.resolve(jsonResponse({
          error: {
            code: 'VERSION_CONFLICT',
            message: '已更新',
            details: { currentProposal: { ...scheduleProposal('REJECTED', 2), kind: 'WORKOUT' } },
          },
        }, 409));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<ManualEventProposalPanel initialDate={dateA} />);
    await screen.findByText('待确认 · 尚未写入日程');
    await user.click(screen.getByRole('button', { name: '拒绝写入日程' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('已拒绝 · 未写入日程')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认写入日程' })).not.toBeInTheDocument();
  });

  it('clears a ready Task immediately when the path id changes', async () => {
    const lateTaskB = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(taskPayload(taskIdA, 'Task A')))
      .mockImplementationOnce(() => lateTaskB.promise);
    vi.stubGlobal('fetch', fetchMock);

    const rendered = render(<TaskDetailWorkspace id={taskIdA} />);
    expect(await screen.findByRole('heading', { name: 'Task A' })).toBeInTheDocument();
    rendered.rerender(<TaskDetailWorkspace id={taskIdB} />);
    expect(screen.queryByRole('heading', { name: 'Task A' })).not.toBeInTheDocument();

    await act(async () => {
      lateTaskB.resolve(jsonResponse(taskPayload(taskIdB, 'Task B')));
      await lateTaskB.promise;
    });

    expect(screen.queryByRole('heading', { name: 'Task A' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Task B' })).toBeInTheDocument();
  });

  it('ignores a late old detail response after a new path has completed', async () => {
    const lateTaskA = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => lateTaskA.promise)
      .mockResolvedValueOnce(jsonResponse(taskPayload(taskIdB, 'Task B')));
    vi.stubGlobal('fetch', fetchMock);

    const rendered = render(<TaskDetailWorkspace id={taskIdA} />);
    rendered.rerender(<TaskDetailWorkspace id={taskIdB} />);
    expect(await screen.findByRole('heading', { name: 'Task B' })).toBeInTheDocument();

    await act(async () => {
      lateTaskA.resolve(jsonResponse(taskPayload(taskIdA, 'Task A')));
      await lateTaskA.promise;
    });

    expect(screen.queryByRole('heading', { name: 'Task A' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Task B' })).toBeInTheDocument();
  });

  it('uses strict Task, Event, and Project snapshot reads and exposes resource-specific failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(taskPayload(taskIdA, 'Task A')))
      .mockResolvedValueOnce(jsonResponse({ data: eventPayload() }))
      .mockResolvedValueOnce(jsonResponse(projectSnapshot(projectIdA, 'Project A')))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'PROJECT_ROOT_UNAVAILABLE', message: '项目根不可读' } }, 422));
    vi.stubGlobal('fetch', fetchMock);

    const task = render(<TaskDetailWorkspace id={taskIdA} />);
    expect(await screen.findByRole('heading', { name: 'Task A' })).toBeInTheDocument();
    task.unmount();
    const event = render(<EventDetailWorkspace id={eventId} />);
    expect(await screen.findByRole('heading', { name: 'Team review' })).toBeInTheDocument();
    event.unmount();
    const project = render(<ProjectDetailWorkspace id={projectIdA} />);
    expect(await screen.findByRole('heading', { name: 'Project A' })).toBeInTheDocument();
    project.rerender(<ProjectDetailWorkspace id={projectIdB} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('项目根当前不可读');
    expect(fetchMock).toHaveBeenCalledWith(`/api/core/tasks/${taskIdA}`, expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/core/events/${eventId}`, expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/core/projects/${projectIdA}/snapshot`, expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/core/projects/${projectIdB}/snapshot`, expect.objectContaining({ method: 'GET', cache: 'no-store' }));
  });

  it('redirects a 401 detail response to login without showing the previous entity', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(taskPayload(taskIdA, 'Task A')))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'AUTHENTICATION_REQUIRED', message: '请先登录' } }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const rendered = render(<TaskDetailWorkspace id={taskIdA} />);
    expect(await screen.findByRole('heading', { name: 'Task A' })).toBeInTheDocument();
    rendered.rerender(<TaskDetailWorkspace id={taskIdB} />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByRole('heading', { name: 'Task A' })).not.toBeInTheDocument();
  });

  it('keeps the source boundaries and thin routes free of legacy generation and fake-detail consumers', () => {
    const sourceRoot = resolve(process.cwd(), 'src');
    const read = (path: string) => readFileSync(resolve(sourceRoot, path), 'utf8');
    const dailyWorkspace = read('components/daily-plan/daily-plan-workspace.tsx');
    const preflightPanel = read('components/daily-plan/preflight-review-panel.tsx');
    const preflightHook = read('components/daily-plan/use-daily-plan-preflight.ts');
    const details = read('components/details/entity-detail-workspaces.tsx');
    const routes = [
      read('app/(dashboard)/tasks/[id]/page.tsx'),
      read('app/(dashboard)/schedule/events/[id]/page.tsx'),
      read('app/(dashboard)/projects/[id]/page.tsx'),
    ];

    expect(dailyWorkspace).not.toContain('dailyPlanGenerationInputSchema');
    expect(dailyWorkspace).not.toMatch(/daily-plans\/(?:preflights|generate)/);
    expect(dailyWorkspace).not.toMatch(/useState\([^\n]*(?:preflight|draft|isPreparing|isApproving|isGenerating)/i);
    expect(dailyWorkspace.split('\n').length).toBeLessThan(516);
    expect(preflightPanel).not.toContain('requestCore');
    expect(preflightHook).not.toMatch(/<(?:section|form|button|input)\b/);
    expect(details).toContain('projects/${id}/snapshot');
    expect(details).not.toMatch(/projects\/\$\{id\}(?!\/snapshot)/);
    for (const route of routes) {
      expect(route).not.toMatch(/'use client'|useState|useEffect|requestCore|useSearchParams/);
    }
    expect(routes[0]).toContain('taskPathParamsSchema');
    expect(routes[1]).toContain('eventPathParamsSchema');
    expect(routes[2]).toContain('projectScopePathSchema');
    const concreteSources = [
      read('components/today/task-list.tsx'),
      read('components/today/day-console.tsx'),
      read('components/today/status-overview.tsx'),
      read('components/projects/project-workspace.tsx'),
    ].join('\n');
    expect(concreteSources).not.toMatch(/\?(?:taskId|eventId|projectId|detail)=/);
    expect(read('components/schedule/manual-event-proposal-panel.tsx')).not.toMatch(/change\.event\.status/);
  });

  it('keeps review, manual Event, and detail controls keyboard-visible and stacked below 42rem', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/dashboard.css'), 'utf8');
    const mobileCss = css.slice(css.lastIndexOf('@media (max-width: 42rem) {'));

    expect(css).toContain('.preflight-review-item__fields');
    expect(css).toContain('.manual-event-proposal-form');
    expect(css).toContain('.entity-detail__facts');
    expect(css).toContain('min-height: 2.75rem;');
    expect(css).toContain('outline: 0.1875rem solid var(--cyan-600);');
    expect(css).toContain('.preflight-review-panel button[aria-busy="true"]');
    expect(css).toContain('cursor: wait;');
    expect(mobileCss).toContain('.preflight-review-item__fields');
    expect(mobileCss).toContain('.manual-event-proposal-form');
    expect(mobileCss).toContain('.entity-detail__facts');
    expect(mobileCss).toContain('grid-template-columns: 1fr;');
    expect(mobileCss).toContain('font-size: 1rem;');
  });
});
