'use client';

import { workoutFeedbackSchema, type WorkoutFeedbackInput, type Proposal, type Workout, type WorkoutRevision } from '@ev/contracts';
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
  onFeedback: (input: WorkoutFeedbackInput) => Promise<void>;
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
          <Link href="/daily-plan"><ExternalLink aria-hidden="true" size={15} /> 前往每日计划审核日程</Link>
          <div className="health-review__actions" aria-label="训练完成反馈">
            <p>确认后才记录结果。</p>
            <WorkoutFeedbackForm version={workout.version} busy={busy} onFeedback={onFeedback} />
          </div>
        </div>
      ) : null}
      {workout.state === 'COMPLETED' || workout.state === 'SKIPPED' ? <p className="health-review__done" role="status">训练反馈已确认：{workout.state === 'COMPLETED' ? '已完成' : '已跳过'}。</p> : null}
    </section>
  );
}

export function WorkoutFeedbackForm({ version, busy, onFeedback }: { version: number; busy: boolean; onFeedback: (input: WorkoutFeedbackInput) => Promise<void> }) {
  const [outcome, setOutcome] = useState('COMPLETED');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [effort, setEffort] = useState('');
  const [pain, setPain] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (busy) return;
    try {
      if (!pain) throw new Error('请选择是否疼痛');
      const input = workoutFeedbackSchema.parse({ outcome, expectedVersion: version, hadPain: pain === 'YES', note: note.trim() || null, perceivedEffort: outcome === 'COMPLETED' && effort ? Number(effort) : null, startedAt: outcome === 'COMPLETED' ? new Date(start).toISOString() : null, endedAt: outcome === 'COMPLETED' ? new Date(end).toISOString() : null });
      setError(null); void onFeedback(input);
    } catch { setError('请明确填写疼痛情况；完成训练须填写有效起止时间（结束晚于开始且不超过24小时）及1–10用力程度。'); }
  }}>
    <fieldset disabled={busy}><legend>实际训练反馈</legend>
      <label>训练结果<select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="COMPLETED">已完成</option><option value="SKIPPED">已跳过</option></select></label>
      {outcome === 'COMPLETED' ? <><label>实际开始时间<input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></label><label>实际结束时间<input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></label><label>自述用力（1–10，可不填）<input type="number" min="1" max="10" value={effort} onChange={(e) => setEffort(e.target.value)} /></label></> : <p>跳过不记录训练时长或用力。</p>}
      <label>训练期间是否疼痛<select required value={pain} onChange={(e) => setPain(e.target.value)}><option value="">请选择</option><option value="NO">明确无疼痛</option><option value="YES">有疼痛</option></select></label>
      <label>反馈备注<textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button type="submit">提交实际反馈</button>
    </fieldset>{error ? <p role="alert">{error}</p> : null}
  </form>;
}
