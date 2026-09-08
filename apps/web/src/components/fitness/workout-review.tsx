'use client';

import type { Proposal, Workout, WorkoutRevision } from '@ev/contracts';
import { Check, ClipboardCheck, ExternalLink, Pencil, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

type Lineage = { id?: string } | null;

export function WorkoutReview({
  workout,
  revision,
  proposal,
  action,
  timeRequest,
  busy,
  failure,
  onSaveRevision,
  onSubmitProposal,
  onDecideProposal,
  onFeedback,
}: {
  workout: Workout;
  revision: WorkoutRevision;
  proposal: Proposal | null;
  action: Lineage;
  timeRequest: Lineage;
  busy: boolean;
  failure: string | null;
  onSaveRevision: (input: { title: string; rationale: string }) => Promise<void>;
  onSubmitProposal: () => Promise<void>;
  onDecideProposal: (decision: 'ACCEPT' | 'REJECT') => Promise<void>;
  onFeedback: (outcome: 'COMPLETED' | 'SKIPPED') => Promise<void>;
}) {
  const [title, setTitle] = useState(revision.title);
  const [rationale, setRationale] = useState(revision.rationale);

  const canEdit = workout.state === 'DRAFT';
  const isPending = workout.state === 'PROPOSAL_PENDING' && proposal?.status === 'PENDING';
  const isAccepted = workout.state === 'ACCEPTED';

  return (
    <section className="health-review" aria-labelledby="workout-review-heading">
      <header className="health-review__header">
        <div>
          <p className="section-kicker">WORKOUT / OWNER REVIEW</p>
          <h2 id="workout-review-heading">训练草稿审阅</h2>
          <p>修订 v{revision.revisionNo} 是不可变记录；提交提案不会直接接受或写入日程。</p>
        </div>
        <span className="health-review__state">{workout.state}</span>
      </header>

      <form className="health-review__form" onSubmit={(event) => { event.preventDefault(); void onSaveRevision({ title, rationale }); }}>
        <label>
          训练标题
          <input disabled={!canEdit || busy} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          训练理由
          <textarea disabled={!canEdit || busy} maxLength={1000} value={rationale} onChange={(event) => setRationale(event.target.value)} />
        </label>
        {canEdit ? <button disabled={busy} type="submit"><Pencil aria-hidden="true" size={16} /> 保存所有者修订</button> : null}
      </form>

      <ol className="health-review__items" aria-label="训练动作与引用">
        {revision.items.map((item) => (
          <li key={item.citation.citationId}>
            <strong>{item.citation.exerciseId}</strong>
            <span>引用 {item.citation.citationId.slice(0, 12)}…</span>
            <span>{item.rounds} 轮 · {item.reps === null ? `${item.durationSeconds} 秒` : `${item.reps} 次`} · 休息 {item.restSeconds} 秒</span>
          </li>
        ))}
      </ol>

      <dl className="health-review__facts">
        <div><dt>目标日期</dt><dd>{revision.scheduling.targetDate}</dd></div>
        <div><dt>时长</dt><dd>{revision.scheduling.durationMinutes} 分钟</dd></div>
        <div><dt>时间窗口</dt><dd>{revision.scheduling.earliestStartLocalTime ?? '未指定'} – {revision.scheduling.latestEndLocalTime ?? '未指定'}</dd></div>
      </dl>

      {failure ? <p className="health-review__failure" role="alert">{failure}</p> : null}

      {canEdit ? <button disabled={busy} onClick={() => void onSubmitProposal()} type="button"><Send aria-hidden="true" size={16} /> 提交提案</button> : null}
      {isPending ? (
        <div className="health-review__actions" aria-label="训练提案决定">
          <p>提案仍待你明确决定；此处不会自动接受。</p>
          <button disabled={busy} onClick={() => void onDecideProposal('ACCEPT')} type="button"><Check aria-hidden="true" size={16} /> 接受训练提案</button>
          <button disabled={busy} onClick={() => void onDecideProposal('REJECT')} type="button">拒绝训练提案</button>
        </div>
      ) : null}
      {isAccepted ? (
        <div className="health-review__lineage">
          <p><ClipboardCheck aria-hidden="true" size={16} /> 已创建 Action {action?.id ?? workout.actionId} 与 TimeRequest {timeRequest?.id ?? workout.timeRequestId}。</p>
          <Link href="/"><ExternalLink aria-hidden="true" size={15} /> 前往 Today 查看 FITNESS 日程</Link>
          <div className="health-review__actions" aria-label="训练完成反馈">
            <p>确认后才记录结果。</p>
            <button disabled={busy} onClick={() => void onFeedback('COMPLETED')} type="button">确认已完成</button>
            <button disabled={busy} onClick={() => void onFeedback('SKIPPED')} type="button">确认跳过</button>
          </div>
        </div>
      ) : null}
      {workout.state === 'COMPLETED' || workout.state === 'SKIPPED' ? <p className="health-review__done" role="status">训练反馈已确认：{workout.state === 'COMPLETED' ? '已完成' : '已跳过'}。</p> : null}
    </section>
  );
}
