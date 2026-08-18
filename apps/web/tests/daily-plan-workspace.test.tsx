import { render, screen, within } from '@testing-library/react';
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

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call: number): unknown {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

describe('DailyPlanWorkspace', () => {
  it('loads the selected ISO date and only generates a plan after explicit confirmation', async () => {
    const generatedProposal = reviewPayload().proposal;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([])))
      .mockResolvedValueOnce(jsonResponse({ data: generatedProposal }, 201))
      .mockResolvedValueOnce(jsonResponse(reviewList([reviewPayload()])));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanWorkspace initialDate="2026-08-18" />);

    expect(await screen.findByText('还没有该日期的每日计划')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '生成每日计划' }));

    expect(await screen.findByText('优先处理唯一待安排的时间请求。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/core/daily-plans/proposals?localDate=2026-08-18&page=1&pageSize=20',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/core/daily-plans/generate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ localDate: '2026-08-18' }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/core/daily-plans/proposals?localDate=2026-08-18&page=1&pageSize=20',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('links a provider configuration failure to the provider settings page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(reviewList([])))
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
    await user.click(screen.getByRole('button', { name: '生成每日计划' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('尚未配置每日计划 Provider 凭据');
    expect(screen.getByRole('link', { name: '前往 Provider 设置' })).toHaveAttribute(
      'href',
      '/settings/providers',
    );
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
