import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DailyPlanWorkspace } from '@/components/daily-plan/daily-plan-workspace';
import { AppShell } from '@/components/shell/app-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/daily-plan',
  useRouter: () => ({ replace: vi.fn() }),
}));

const proposalId = '00000000-0000-4000-8000-000000000601';
const runId = '00000000-0000-4000-8000-000000000602';
const itemId = '00000000-0000-4000-8000-000000000603';
const timeRequestId = '00000000-0000-4000-8000-000000000604';
const preflightId = '00000000-0000-4000-8000-000000000605';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function reviewPayload(
  state: 'PENDING_REVIEW' | 'APPLIED' | 'REJECTED' = 'PENDING_REVIEW',
  version = 1,
  times: { start: string; end: string } = { start: '09:00', end: '10:00' },
) {
  const isPending = state === 'PENDING_REVIEW';
  const decision =
    state === 'APPLIED'
      ? [{ itemId, decision: 'APPLY', startLocalTime: times.start, endLocalTime: times.end }]
      : state === 'REJECTED'
        ? [{ itemId, decision: 'REJECT' }]
        : [];

  return {
    proposal: {
      id: proposalId,
      contractVersion: 'DAILY_PLAN_V1',
      runId,
      localDate: '2026-08-18',
      status: state,
      baseScheduleVersion: 1,
      summary: '优先处理唯一待安排的时间请求。',
      items: [
        {
          id: itemId,
          ordinal: 1,
          status: isPending ? 'PENDING_REVIEW' : state,
          operation: 'SCHEDULE_TIME_REQUEST',
          timeRequestId,
          timeRequestVersion: 1,
          startLocalTime: times.start,
          endLocalTime: times.end,
          reasonCode: null,
          rationale: '这个时间段与已有日程不冲突。',
        },
      ],
      version,
      createdAt: '2026-08-18T01:00:00.000Z',
      updatedAt: '2026-08-18T01:00:00.000Z',
    },
    decisions: decision,
  };
}

function reviewList(items: ReturnType<typeof reviewPayload>[]) {
  return {
    data: {
      items,
      pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length > 0 ? 1 : 0 },
    },
  };
}

function preflightPayload(status: 'AWAITING_APPROVAL' | 'APPROVED', version: number) {
  return {
    data: {
      id: preflightId,
      runId,
      contractVersion: 'DAILY_PLAN_PREFLIGHT_V1',
      localDate: '2026-08-18',
      status,
      baseScheduleVersion: 1,
      items: [{
        contextRef: 'TIME_REQUEST_1',
        safeTitle: '完成本地验证',
        domain: 'WORK',
        deadlineLocalDate: '2026-08-18',
        durationMinutes: 60,
        priority: 'HIGH',
        availability: { earliestStartLocalTime: '10:00', latestEndLocalTime: '17:00' },
        isFixed: false,
        included: true,
      }],
      version,
      createdAt: '2026-08-18T01:00:00.000Z',
      updatedAt: '2026-08-18T01:00:00.000Z',
      approvedAt: status === 'APPROVED' ? '2026-08-18T01:01:00.000Z' : null,
      claimedAt: null,
      consumedAt: null,
    },
  };
}

function explanationPayload() {
  return {
    data: {
      proposalId,
      localDate: '2026-08-18',
      baseScheduleVersion: 1,
      currentScheduleVersion: 2,
      contextManifest: {
        contractVersion: 'DAILY_PLAN_V1',
        purpose: 'DAILY_PLAN_GENERATION',
        localDate: '2026-08-18',
        createdAt: '2026-08-18T01:00:00.000Z',
        sentAt: '2026-08-18T01:00:01.000Z',
        entries: [
          {
            category: 'OPEN_TIME_REQUESTS',
            fieldCategories: ['TIME_RANGE', 'DURATION_MINUTES', 'PRIORITY', 'AVAILABILITY_WINDOW'],
            entityCount: 1,
          },
        ],
      },
      items: [
        {
          itemId,
          ordinal: 1,
          timeRequest: {
            id: timeRequestId,
            title: '完成本地验证',
            source: 'PROJECT_AGENT',
            durationMinutes: 60,
            priority: 'HIGH',
            earliestStartLocalTime: '10:00',
            latestEndLocalTime: '17:00',
            isFixed: false,
            version: 1,
          },
          verification: { status: 'SCHEDULE_VERSION_CHANGED', conflicts: [] },
        },
      ],
    },
  };
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call: number): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

describe('DailyPlanWorkspace', () => {
  it('loads the selected ISO date and only generates a plan after prepare and approval', async () => {
    const generatedProposal = reviewPayload().proposal;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([])))
      .mockResolvedValueOnce(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201))
      .mockResolvedValueOnce(jsonResponse(preflightPayload('APPROVED', 2)))
      .mockResolvedValueOnce(jsonResponse({ data: generatedProposal }, 201))
      .mockResolvedValueOnce(jsonResponse(reviewList([reviewPayload()])));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<DailyPlanWorkspace initialDate="2026-08-18" />);

    expect(await screen.findByText('还没有该日期的每日计划')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '准备外发内容' }));
    await user.click(await screen.findByRole('button', { name: '批准外发内容' }));
    await user.click(await screen.findByRole('button', { name: '调用 Provider 生成草案' }));

    expect(await screen.findByText('优先处理唯一待安排的时间请求。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/core/daily-plans/proposals?localDate=2026-08-18&page=1&pageSize=20',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/core/daily-plans/preflights',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ localDate: '2026-08-18' }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/core/daily-plans/preflights/${preflightId}/approve`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          expectedPreflightVersion: 1,
          items: [{
            contextRef: 'TIME_REQUEST_1',
            safeTitle: '完成本地验证',
            domain: 'WORK',
            deadlineLocalDate: '2026-08-18',
            included: true,
          }],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/core/daily-plans/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ preflightId, expectedPreflightVersion: 2 }),
      }),
    );
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get('idempotency-key')).toMatch(/^web-/);
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/core/daily-plans/proposals?localDate=2026-08-18&page=1&pageSize=20',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fails closed when a schema-valid generation response is not correlated to the approved preflight', async () => {
    const mismatchedProposal = {
      ...reviewPayload().proposal,
      runId: '00000000-0000-4000-8000-000000000699',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([])))
      .mockResolvedValueOnce(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201))
      .mockResolvedValueOnce(jsonResponse(preflightPayload('APPROVED', 2)))
      .mockResolvedValueOnce(jsonResponse({ data: mismatchedProposal }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<DailyPlanWorkspace initialDate="2026-08-18" />);

    await screen.findByText('还没有该日期的每日计划');
    await user.click(screen.getByRole('button', { name: '准备外发内容' }));
    await user.click(await screen.findByRole('button', { name: '批准外发内容' }));
    await user.click(await screen.findByRole('button', { name: '调用 Provider 生成草案' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Core 返回了无法安全继续的响应');
    expect(screen.queryByText(mismatchedProposal.summary)).not.toBeInTheDocument();
  });

  it('reuses the same generate key only for an uncertain transport retry', async () => {
    const generatedProposal = reviewPayload().proposal;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([])))
      .mockResolvedValueOnce(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201))
      .mockResolvedValueOnce(jsonResponse(preflightPayload('APPROVED', 2)))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(jsonResponse({ data: generatedProposal }, 201))
      .mockResolvedValueOnce(jsonResponse(reviewList([reviewPayload()])));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<DailyPlanWorkspace initialDate="2026-08-18" />);

    await screen.findByText('还没有该日期的每日计划');
    await user.click(screen.getByRole('button', { name: '准备外发内容' }));
    await user.click(await screen.findByRole('button', { name: '批准外发内容' }));
    await user.click(await screen.findByRole('button', { name: '调用 Provider 生成草案' }));
    expect(await screen.findByRole('button', { name: '重试生成' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '重试生成' }));

    await screen.findByText(generatedProposal.summary);
    const firstGenerateHeaders = new Headers(fetchMock.mock.calls[3]?.[1]?.headers);
    const retriedGenerateHeaders = new Headers(fetchMock.mock.calls[4]?.[1]?.headers);
    expect(firstGenerateHeaders.get('idempotency-key')).toMatch(/^web-/);
    expect(retriedGenerateHeaders.get('idempotency-key')).toBe(firstGenerateHeaders.get('idempotency-key'));
  });

  it('links a provider configuration failure to the provider settings page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([])))
      .mockResolvedValueOnce(jsonResponse(preflightPayload('AWAITING_APPROVAL', 1), 201))
      .mockResolvedValueOnce(jsonResponse(preflightPayload('APPROVED', 2)))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED',
              message: '尚未配置每日计划 Provider 凭据',
            },
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<DailyPlanWorkspace initialDate="2026-08-18" />);
    await screen.findByText('还没有该日期的每日计划');
    await user.click(screen.getByRole('button', { name: '准备外发内容' }));
    await user.click(await screen.findByRole('button', { name: '批准外发内容' }));
    await user.click(await screen.findByRole('button', { name: '调用 Provider 生成草案' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('尚未配置每日计划 Provider 凭据');
    expect(screen.getByRole('link', { name: '前往 Provider 设置' })).toHaveAttribute(
      'href',
      '/settings/providers',
    );

    const dashboardCss = readFileSync(resolve(process.cwd(), 'src/app/dashboard.css'), 'utf8');
    const mobileCss = dashboardCss.slice(dashboardCss.lastIndexOf('@media (max-width: 42rem) {'));
    const mobileControlRule = mobileCss.match(
      /\.daily-plan-workspace__date-control input,[\s\S]*?\.daily-plan-workspace__failure a\s*\{[\s\S]*?\n\}/,
    )?.[0];
    const providerLinkRule = dashboardCss.match(
      /\.daily-plan-workspace__failure a\s*\{[\s\S]*?\n\}/,
    )?.[0];

    expect(mobileControlRule).toBeDefined();
    expect(providerLinkRule).toContain('display: inline-flex;');
    expect(mobileControlRule).toContain('.daily-plan-workspace__date-control input');
    expect(mobileControlRule).toContain('.daily-plan-item-card__actions button');
    expect(mobileControlRule).toContain('.daily-plan-workspace__failure a');
    expect(mobileControlRule).toContain('min-height: 2.75rem;');
  });

  it('loads local context and current schedule validation only when a review explanation is expanded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([reviewPayload()])))
      .mockResolvedValueOnce(jsonResponse(explanationPayload()));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace initialDate="2026-08-18" />);
    await screen.findByText('优先处理唯一待安排的时间请求。');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText('查看本次上下文与校验'));

    expect(await screen.findByText('草案基于日程版本 v1；当前为 v2。')).toBeInTheDocument();
    expect(screen.getByText('待安排请求：1 条（时间范围、时长、优先级、可用时间）')).toBeInTheDocument();
    expect(screen.getByText('完成本地验证')).toBeInTheDocument();
    expect(screen.getByText('日程版本已变化，请在采用前重新核对。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/core/daily-plans/proposals/${proposalId}/explanation`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps date B visible after a delayed date A review list resolves', async () => {
    const dateAReview = reviewPayload();
    const dateBReview = {
      ...reviewPayload(),
      proposal: {
        ...reviewPayload().proposal,
        localDate: '2026-08-19',
        summary: '日期 B 的每日计划必须保留。',
      },
    };
    const delayedDateAList = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => delayedDateAList.promise)
      .mockResolvedValueOnce(jsonResponse(reviewList([dateBReview])));
    vi.stubGlobal('fetch', fetchMock);

    render(<DailyPlanWorkspace initialDate="2026-08-18" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('计划日期'), { target: { value: '2026-08-19' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('日期 B 的每日计划必须保留。')).toBeInTheDocument();

    await act(async () => {
      delayedDateAList.resolve(jsonResponse(reviewList([dateAReview])));
      await delayedDateAList.promise;
    });

    await waitFor(() => {
      expect(screen.getByText('日期 B 的每日计划必须保留。')).toBeInTheDocument();
      expect(screen.queryByText(dateAReview.proposal.summary)).not.toBeInTheDocument();
    });
  });

  it('does not surface a date A review error after the user switches to date B', async () => {
    const dateBReview = {
      ...reviewPayload(),
      proposal: {
        ...reviewPayload().proposal,
        localDate: '2026-08-19',
        summary: '日期 B 的审核状态不应被旧错误覆盖。',
      },
    };
    const delayedGeneration = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => delayedGeneration.promise)
      .mockResolvedValueOnce(jsonResponse(reviewList([dateBReview])));
    vi.stubGlobal('fetch', fetchMock);

    render(<DailyPlanWorkspace initialDate="2026-08-18" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('计划日期'), { target: { value: '2026-08-19' } });
    expect(await screen.findByText('日期 B 的审核状态不应被旧错误覆盖。')).toBeInTheDocument();

    await act(async () => {
      delayedGeneration.resolve(
        jsonResponse(
          { error: { code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE', message: '每日计划 Provider 暂不可用' } },
          503,
        ),
      );
      await delayedGeneration.promise;
    });

    await waitFor(() => {
      expect(screen.getByText('日期 B 的审核状态不应被旧错误覆盖。')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('posts an edited APPLY decision with both times and focuses the updated review state', async () => {
    const appliedReview = reviewPayload('APPLIED', 2, { start: '10:30', end: '11:30' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([reviewPayload()])))
      .mockResolvedValueOnce(jsonResponse({ data: appliedReview }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace initialDate="2026-08-18" />);

    await screen.findByText('这个时间段与已有日程不冲突。');
    await user.clear(screen.getByLabelText('开始时间（请求 1）'));
    await user.type(screen.getByLabelText('开始时间（请求 1）'), '10:30');
    await user.clear(screen.getByLabelText('结束时间（请求 1）'));
    await user.type(screen.getByLabelText('结束时间（请求 1）'), '11:30');
    await user.click(screen.getByRole('button', { name: '采用安排' }));

    expect(await screen.findByText('已采用')).toBeInTheDocument();
    expect(requestBody(fetchMock, 1)).toEqual({
      expectedProposalVersion: 1,
      decisions: [{ itemId, decision: 'APPLY', startLocalTime: '10:30', endLocalTime: '11:30' }],
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('idempotency-key')).toMatch(/^web-/);
    expect(screen.getByRole('status', { name: '草案更新状态' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: '采用安排' })).not.toBeInTheDocument();
  });

  it('posts a rejection without times and renders terminal controls', async () => {
    const rejectedReview = reviewPayload('REJECTED', 2);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([reviewPayload()])))
      .mockResolvedValueOnce(jsonResponse({ data: rejectedReview }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace initialDate="2026-08-18" />);

    await screen.findByText('这个时间段与已有日程不冲突。');
    expect(screen.getByLabelText('拒绝原因（请求 1）')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '拒绝安排' }));

    expect(await screen.findByText('已拒绝')).toBeInTheDocument();
    expect(requestBody(fetchMock, 1)).toEqual({
      expectedProposalVersion: 1,
      decisions: [{ itemId, decision: 'REJECT' }],
    });
    expect(screen.queryByLabelText('开始时间（请求 1）')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('拒绝原因（请求 1）')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝安排' })).not.toBeInTheDocument();
  });

  it('replaces local review state with the Core response after a version conflict', async () => {
    const currentReview = reviewPayload('APPLIED', 2, { start: '12:00', end: '13:00' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([reviewPayload()])))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'DAILY_PLAN_PROPOSAL_VERSION_CONFLICT',
              message: '每日计划草案已更新，请刷新后重试',
              details: { currentReview },
            },
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace initialDate="2026-08-18" />);

    await screen.findByText('这个时间段与已有日程不冲突。');
    await user.click(screen.getByRole('button', { name: '采用安排' }));

    expect(await screen.findByText('12:00–13:00')).toBeInTheDocument();
    expect(screen.getByText('已采用')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('每日计划草案已更新，请刷新后重试');
    expect(screen.getByRole('status', { name: '草案更新状态' })).toHaveFocus();
  });

  it('keeps the daily-plan route in both desktop and mobile dashboard navigation', () => {
    render(
      <AppShell>
        <p>每日计划画布</p>
      </AppShell>,
    );

    for (const navigationName of ['主导航', '移动端主导航']) {
      const navigation = screen.getByRole('navigation', { name: navigationName });
      expect(within(navigation).getByRole('link', { name: '每日计划' })).toHaveAttribute('href', '/daily-plan');
    }
  });
});
