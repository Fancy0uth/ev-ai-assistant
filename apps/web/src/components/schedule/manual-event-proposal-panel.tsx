'use client';

import {
  createEventProposalInputSchema,
  proposalDecisionSchema,
  proposalListResponseSchema,
  proposalResponseSchema,
  proposalVersionConflictDetailsSchema,
  type EventKind,
  type Proposal,
} from '@ev/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

interface ManualEventProposalPanelProps {
  initialDate: string;
}

const eventKinds: Array<[EventKind, string]> = [
  ['MEETING', '会议'],
  ['PERSONAL', '个人事务'],
  ['WORK_BLOCK', '工作时段'],
  ['WORKOUT', '训练'],
  ['STUDY', '学习'],
  ['COURSE', '课程'],
];

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '手工日程提案暂时未完成，请稍后重试。';
}

function isManualEventProposal(proposal: Proposal): boolean {
  return proposal.kind === 'SCHEDULE' && proposal.changes.some((change) => change.operation === 'CREATE_EVENT');
}

function acceptedEvent(proposal: Proposal) {
  if (proposal.status !== 'ACCEPTED') return null;
  const change = proposal.changes.find((entry) => entry.operation === 'CREATE_EVENT');
  return change?.event ?? null;
}

function statusCopy(status: Proposal['status']): string {
  switch (status) {
    case 'PENDING':
      return '待确认 · 尚未写入日程';
    case 'ACCEPTED':
      return '已确认 · 已写入日程';
    case 'REJECTED':
      return '已拒绝 · 未写入日程';
    case 'EXPIRED':
      return '已过期 · 未写入日程';
  }
}

function conflictProposal(error: unknown): Proposal | null {
  if (!(error instanceof CoreClientError) || error.status !== 409) return null;
  const parsed = proposalVersionConflictDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.currentProposal : null;
}

export function ManualEventProposalPanel({ initialDate }: ManualEventProposalPanelProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<EventKind>('MEETING');
  const [localDate, setLocalDate] = useState(initialDate);
  const [startLocalTime, setStartLocalTime] = useState('09:00');
  const [endLocalTime, setEndLocalTime] = useState('10:00');
  const [isHard, setIsHard] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [decidingProposalId, setDecidingProposalId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const createInFlightRef = useRef(false);
  const decisionInFlightRef = useRef<string | null>(null);
  const listRequestIdRef = useRef(0);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    void requestCore('proposals?status=PENDING', {
        method: 'GET',
        signal: controller.signal,
      })
      .then((payload) => {
        if (controller.signal.aborted || listRequestIdRef.current !== requestId) return;
        setProposals(proposalListResponseSchema.parse(payload).data.filter(isManualEventProposal));
        setFailure(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || listRequestIdRef.current !== requestId) return;
        setFailure(failureMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted && listRequestIdRef.current === requestId) setIsLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    if (statusMessage) statusRef.current?.focus();
  }, [statusMessage]);

  function replaceProposal(next: Proposal): void {
    listRequestIdRef.current += 1;
    setProposals((current) => {
      const existingIndex = current.findIndex((proposal) => proposal.id === next.id);
      if (existingIndex === -1) return [next, ...current];
      return current.map((proposal) => (proposal.id === next.id ? next : proposal));
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (createInFlightRef.current) return;
    const parsed = createEventProposalInputSchema.safeParse({ title, kind, localDate, startLocalTime, endLocalTime, isHard });
    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? '请检查手工日程输入。');
      return;
    }
    createInFlightRef.current = true;
    setIsCreating(true);
    listRequestIdRef.current += 1;
    setFailure(null);
    setStatusMessage(null);
    try {
      const payload = await requestCore('event-proposals', { method: 'POST', body: JSON.stringify(parsed.data) });
      const proposal = proposalResponseSchema.parse(payload).data;
      if (!isManualEventProposal(proposal)) throw new Error('Core 返回了不属于手工 Event 的提案。');
      replaceProposal(proposal);
      setTitle('');
      setStatusMessage('手工日程已创建为待确认提案，尚未写入日程。');
    } catch (error: unknown) {
      setFailure(failureMessage(error));
    } finally {
      createInFlightRef.current = false;
      setIsCreating(false);
    }
  }

  async function decide(proposal: Proposal, decision: 'ACCEPT' | 'REJECT'): Promise<void> {
    if (decisionInFlightRef.current !== null) return;
    decisionInFlightRef.current = proposal.id;
    listRequestIdRef.current += 1;
    setDecidingProposalId(proposal.id);
    setFailure(null);
    setStatusMessage(null);
    try {
      const input = proposalDecisionSchema.parse({ version: proposal.version, decision });
      const payload = await requestCore(`proposals/${proposal.id}/decision`, { method: 'POST', body: JSON.stringify(input) });
      const next = proposalResponseSchema.parse(payload).data;
      replaceProposal(next);
      setStatusMessage(next.status === 'ACCEPTED' ? '日程提案已确认并写入日程。' : '日程提案已拒绝，未写入日程。');
    } catch (error: unknown) {
      const current = conflictProposal(error);
      if (current) {
        replaceProposal(current);
        setStatusMessage('提案已由 Core 的最新版本替换。');
      } else if (error instanceof CoreClientError && error.status === 409) {
        setFailure('日程提案发生冲突，正在重新读取待确认提案。');
        setIsLoading(true);
        setReloadKey((value) => value + 1);
      } else {
        setFailure(failureMessage(error));
      }
    } finally {
      if (decisionInFlightRef.current === proposal.id) decisionInFlightRef.current = null;
      setDecidingProposalId(null);
    }
  }

  return (
    <section className="manual-event-proposal-panel" aria-labelledby="manual-event-heading">
      <header className="manual-event-proposal-panel__header">
        <div>
          <p className="section-kicker">MANUAL EVENT / REVIEW GATE</p>
          <h2 id="manual-event-heading">添加待确认日程</h2>
          <p>提交后只会创建待确认 Proposal；只有确认后才写入日程。</p>
        </div>
      </header>

      <form className="manual-event-proposal-form" onSubmit={(event) => void submit(event)} noValidate>
        <label>日程标题<input maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>日程类型<select value={kind} onChange={(event) => setKind(event.target.value as EventKind)}>{eventKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>日程日期<input type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} /></label>
        <label>开始时间<input type="time" value={startLocalTime} onChange={(event) => setStartLocalTime(event.target.value)} /></label>
        <label>结束时间<input type="time" value={endLocalTime} onChange={(event) => setEndLocalTime(event.target.value)} /></label>
        <label className="manual-event-proposal-form__hard"><input checked={isHard} type="checkbox" onChange={(event) => setIsHard(event.target.checked)} /> 固定安排</label>
        <button disabled={isCreating} aria-busy={isCreating || undefined} type="submit">创建待确认日程</button>
      </form>

      {failure ? <p className="manual-event-proposal-panel__failure" role="alert">{failure}</p> : null}
      {statusMessage ? <p className="manual-event-proposal-panel__status" ref={statusRef} role="status" tabIndex={-1}>{statusMessage}</p> : null}
      {isLoading ? <p role="status" aria-live="polite">正在读取待确认手工日程…</p> : null}
      {!isLoading && proposals.length === 0 ? <p className="manual-event-proposal-panel__empty" role="status">还没有待确认的手工日程。</p> : null}
      <ul className="manual-event-proposal-list">
        {proposals.map((proposal) => {
          const event = acceptedEvent(proposal);
          const isDeciding = decidingProposalId === proposal.id;
          return (
            <li key={`${proposal.id}:${proposal.version}`}>
              <article className={`manual-event-proposal-card manual-event-proposal-card--${proposal.status.toLowerCase()}`}>
                <div>
                  <h3>{proposal.title}</h3>
                  <p role="status">{statusCopy(proposal.status)}</p>
                </div>
                {proposal.status === 'PENDING' ? (
                  <div className="manual-event-proposal-card__actions">
                    <button disabled={isDeciding} aria-busy={isDeciding || undefined} type="button" onClick={() => void decide(proposal, 'REJECT')}>拒绝写入日程</button>
                    <button disabled={isDeciding} aria-busy={isDeciding || undefined} type="button" onClick={() => void decide(proposal, 'ACCEPT')}>{isDeciding ? '正在处理…' : '确认写入日程'}</button>
                  </div>
                ) : null}
                {event ? <Link aria-label={`查看日程详情：${event.title}`} href={`/schedule/events/${event.id}`}>查看日程详情</Link> : null}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
