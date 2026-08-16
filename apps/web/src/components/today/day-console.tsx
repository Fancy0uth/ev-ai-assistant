'use client';

import type { ProposalDecisionInput, TodaySnapshot } from '@ev/contracts';
import { CalendarClock, CheckCircle2, Clock3 } from 'lucide-react';

type Snapshot = TodaySnapshot['data'];

export function DayConsole({
  snapshot,
  decidingProposalId,
  onDecision,
}: {
  snapshot: Snapshot;
  decidingProposalId: string | null;
  onDecision: (proposalId: string, input: ProposalDecisionInput) => Promise<void>;
}) {
  return (
    <section className="day-console" aria-labelledby="day-console-heading">
      <div className="task-list-card__header">
        <div>
          <p className="section-kicker">TODAY SCHEDULE</p>
          <h2 id="day-console-heading">今天的时间安排</h2>
        </div>
        <span>{snapshot.events.length} 个时间块</span>
      </div>
      {snapshot.events.length === 0 ? (
        <div className="day-console__empty">
          <CalendarClock aria-hidden="true" size={20} />
          <p>还没有已确认日程。导入课表或确认 Agent 的排程提案后，它们会显示在这里。</p>
        </div>
      ) : (
        <ol className="day-timeline">
          {snapshot.events.map((event) => (
            <li key={event.id}>
              <time>{event.startLocalTime}</time>
              <span className={event.isHard ? 'day-timeline__line day-timeline__line--hard' : 'day-timeline__line'} />
              <div>
                <strong>{event.title}</strong>
                <small>
                  {event.endLocalTime} · {event.kind === 'COURSE' ? '课程' : event.kind === 'WORKOUT' ? '训练' : '安排'}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}

      {snapshot.pendingProposals.length > 0 ? (
        <div className="day-proposals" aria-label="待确认排程建议">
          <div className="day-proposal-summary" role="status">
            <Clock3 aria-hidden="true" size={17} />
            <p>有 {snapshot.pendingProposals.length} 项 Agent 排程建议待你确认；它们尚未写入日程。</p>
          </div>
          <ul>
            {snapshot.pendingProposals.map((proposal) => {
              const isPending = decidingProposalId === proposal.id;
              return (
                <li key={proposal.id}>
                  <div>
                    <strong>{proposal.title}</strong>
                    <small>{proposal.changes.length} 项变更 · {proposal.source}</small>
                  </div>
                  <div className="day-proposals__actions">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => void onDecision(proposal.id, { version: proposal.version, decision: 'REJECT' })}
                    >
                      忽略
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => void onDecision(proposal.id, { version: proposal.version, decision: 'ACCEPT' })}
                    >
                      {isPending ? '处理中…' : '确认安排'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="day-proposal-summary day-proposal-summary--clear" role="status">
          <CheckCircle2 aria-hidden="true" size={17} />
          <p>没有待确认的日程变更。</p>
        </div>
      )}
    </section>
  );
}
