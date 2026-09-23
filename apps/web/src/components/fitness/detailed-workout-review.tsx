'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WorkoutPlanItemV2, WorkoutFeedbackInput } from '@ev/contracts';
import { WorkoutFeedbackForm } from './workout-review';
import type { DetailedWorkoutDetail, MemoryStatus } from './detailed-workout-workspace';

export function itemSeconds(item: WorkoutPlanItemV2): number {
  return item.rounds * (item.reps === null ? item.durationSeconds : item.reps * item.secondsPerRep) + (item.rounds - 1) * item.restSeconds + item.transitionSeconds;
}

export function DetailedWorkoutReview({ detail, busy, memoryStatus, safetyNotice, onRevise, onPropose, onDecide, onFeedback, onAgain }: {
  detail: DetailedWorkoutDetail; busy: boolean; memoryStatus: MemoryStatus | null; safetyNotice: string | null;
  onRevise: (input: { title: string; rationale: string }) => Promise<void>;
  onPropose: () => Promise<void>; onDecide: (decision: 'ACCEPT' | 'REJECT') => Promise<void>;
  onFeedback: (input: WorkoutFeedbackInput) => Promise<void>; onAgain: () => void;
}) {
  const { workout, revision, citations, proposal } = detail;
  const [title, setTitle] = useState(revision.title);
  const [rationale, setRationale] = useState(revision.rationale);
  const total = revision.items.reduce((sum, item) => sum + itemSeconds(item), 0);
  function itemView(item: WorkoutPlanItemV2) {
    const source = citations.find((entry) => entry.candidate.citationId === item.citationId);
    return <><strong>{source?.name ?? '缺少来源快照'}</strong><p>{item.rounds} 组 · {item.reps === null ? `${item.durationSeconds} 秒/组` : `${item.reps} 次/组 · 每次 ${item.secondsPerRep} 秒`} · 组间休息 {item.restSeconds} 秒 · 转换 {item.transitionSeconds} 秒 · 估计 {itemSeconds(item)} 秒 · {item.intensity}</p><p>{item.reason}</p></>;
  }
  return <section className="health-review" aria-label="详细训练草稿审阅">
    <h2>详细训练草稿审阅</h2><p>{workout.state} · 修订 v{revision.revisionNo} · 总时长 {total} 秒（{(total / 60).toFixed(1)} 分钟）</p>
    <form onSubmit={(e) => { e.preventDefault(); if (!busy) void onRevise({ title, rationale }); }}><fieldset disabled={busy || workout.state !== 'DRAFT'}>
      <label>详细训练标题<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>详细训练理由<textarea required maxLength={1000} value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>
      {workout.state === 'DRAFT' ? <button type="submit">保存详细计划修订</button> : null}
    </fieldset></form>
    {(['WARMUP', 'MAIN', 'COOLDOWN'] as const).map((phase) => <section key={phase}><h3>{{ WARMUP: '热身', MAIN: '主训练', COOLDOWN: '放松' }[phase]}</h3><ol>{revision.items.filter((item) => item.phase === phase).map((item) => <li key={item.citationId}>{itemView(item)}</li>)}</ol></section>)}
    <h3>替代动作</h3>{revision.alternatives.length ? revision.alternatives.map((alt) => <div key={alt.replacesItemIndex}><p>替代第 {alt.replacesItemIndex + 1} 项：{alt.reason}</p>{itemView(alt.item)}<p>替代后总时长 {total - itemSeconds(revision.items[alt.replacesItemIndex]!) + itemSeconds(alt.item)} 秒</p></div>) : <p>本草稿没有替代动作。</p>}
    <h3>动作来源与技术说明</h3><p>NOT_MEDICALLY_CERTIFIED · 技术政策和来源不代表医学认证。</p>
    {citations.filter(({ candidate }) => candidate.publicGuidance).map(({ candidate, name }) => <details key={`guidance-${candidate.citationId}`}><summary>{name} · 公开指导依据（非个人审核）</summary>{candidate.publicGuidance!.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.publisher} 原文</a> · 审核 {s.reviewedAt} · 核验 {s.accessedAt}<br />{s.summary}<br />摘要 hash {s.summaryHash}</p>)}<p>{candidate.publicGuidance!.engineeringEstimates}</p></details>)}
    {citations.map(({ candidate, name, instructions }) => <details key={candidate.citationId}><summary>{name} · {candidate.sourceKind} · 版本 {candidate.version}</summary><p>{candidate.technicalSummary}</p><ol>{instructions.map((step, i) => <li key={i}>{step}</li>)}</ol><p>来源 {candidate.source} · hash {candidate.hash} · itemHash {candidate.itemHash}</p><p>资格 {candidate.eligibility.status} · {candidate.eligibility.policyRef ?? candidate.eligibility.reviewRef}</p></details>)}
    <p>时间：{revision.scheduling.targetDate} · {revision.scheduling.earliestStartLocalTime}–{revision.scheduling.latestEndLocalTime} · 预算 {revision.scheduling.durationMinutes} 分钟</p>
    <p>政策 {revision.policyVersion} · 修订 hash {revision.contentHash}</p>
    {workout.state === 'DRAFT' ? <button disabled={busy} onClick={() => void onPropose()}>提交详细训练提案</button> : null}
    {workout.state === 'PROPOSAL_PENDING' && proposal?.status === 'PENDING' ? <div><p>接受训练仅创建 Action 和 TimeRequest；日程需要另行审核。</p><button disabled={busy} onClick={() => void onDecide('ACCEPT')}>接受详细训练提案</button><button disabled={busy} onClick={() => void onDecide('REJECT')}>拒绝详细训练提案</button></div> : null}
    {workout.actionId ? <p>Action {workout.actionId} · TimeRequest {workout.timeRequestId} · <Link href="/daily-plan">前往每日计划审核日程</Link></p> : null}
    {workout.state === 'ACCEPTED' ? <WorkoutFeedbackForm version={workout.version} busy={busy} onFeedback={onFeedback} /> : null}
    {workout.feedbackId ? <p role="status">训练反馈已保存：{workout.state}</p> : null}
    {memoryStatus ? <p role="status">记忆结果：{memoryStatus.state} · {{ RECORDED: '摘要已记录', SKIPPED_HUMAN_EDIT: '保留人工编辑，未覆盖', SKIPPED_DELETED: '尊重删除，未重建', REPLAYED: '已重放，未重复写入', DEGRADED: '反馈已保存，记忆摘要失败' }[memoryStatus.state]} {memoryStatus.sourceId}</p> : null}
    {safetyNotice ? <p role="alert">{safetyNotice}：已报告疼痛，请停止训练并寻求专业帮助。</p> : null}
    <button disabled={busy} onClick={onAgain}>再次规划训练</button>
  </section>;
}
