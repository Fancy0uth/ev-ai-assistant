'use client';

import type { ProposalDecisionInput, TaskArea, TodaySnapshot } from '@ev/contracts';
import { CalendarClock, CheckCircle2, Clock3, HeartPulse, ListChecks } from 'lucide-react';
import Link from 'next/link';

type Snapshot = TodaySnapshot['data'];

const areaCopy: Record<TaskArea, string> = { WORK: '开发', STUDY: '学习', LIFE: '生活' };
function recoveryLabel(value: number): string {
  if (value <= 34) return '注意恢复';
  if (value <= 59) return '适度安排';
  return '恢复良好';
}

export function DayConsole({
  snapshot,
  decidingProposalId,
  onDecision,
}: {
  snapshot: Snapshot;
  decidingProposalId: string | null;
  onDecision: (proposalId: string, input: ProposalDecisionInput) => Promise<void>;
}) {
  const openTasks = snapshot.tasks.filter((task) => task.status !== 'DONE');
  const recoverySignal = snapshot.signals.filter((signal) => signal.kind === 'RECOVERY').slice(-1)[0];

  return (
    <section className="day-console" aria-labelledby="day-console-heading">
      <div className="task-list-card__header">
        <div>
          <p className="section-kicker">DAILY CONTROL CONSOLE</p>
          <h2 id="day-console-heading">日程与具体行动</h2>
        </div>
        <span>{snapshot.events.length} 个时间块 · {openTasks.length} 项行动</span>
      </div>
      <div className="day-console__grid">
        <div className="day-console__schedule">
          <h3>时间安排</h3>
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
                    <Link aria-label={`查看日程详情：${event.title}`} href={`/schedule/events/${event.id}`}>
                      <strong>{event.title}</strong>
                    </Link>
                    <small>
                      {event.endLocalTime} · {event.kind === 'COURSE' ? '课程' : event.kind === 'WORKOUT' ? '训练' : '安排'}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="day-console__actions">
          <h3><ListChecks aria-hidden="true" size={16} /> 具体行动</h3>
          {openTasks.length === 0 ? (
            <p className="day-console__actions-empty">今天还没有待处理事项。先添加一件真实要完成的事。</p>
          ) : (
            <ul>
              {openTasks.slice(0, 5).map((task) => (
                <li key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <small>{areaCopy[task.area]} · {task.priority} 优先级</small>
                  </div>
                  <Link aria-label={`在控制台查看任务详情：${task.title}`} href={`/tasks/${task.id}`}>
                    查看详情
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {recoverySignal ? (
            <p className="day-console__recovery">
              <HeartPulse aria-hidden="true" size={16} />
              {recoveryLabel(recoverySignal.value)}
              <span>来自本地恢复打卡</span>
            </p>
          ) : null}
        </div>
      </div>

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
