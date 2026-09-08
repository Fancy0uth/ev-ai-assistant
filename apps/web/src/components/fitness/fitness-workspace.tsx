'use client';

import {
  exerciseListResponseSchema,
  fitnessCheckInResponseSchema,
  healthCapabilitiesResponseSchema,
  proposalResponseSchema,
  workoutCreateResponseSchema,
  workoutDetailResponseSchema,
  workoutFeedbackResponseSchema,
  workoutProposalResponseSchema,
  workoutRevisionResponseSchema,
  workoutListResponseSchema,
  type FitnessCheckIn,
  type Proposal,
  type Workout,
  type WorkoutRevision,
} from '@ev/contracts';
import { Activity, AlertTriangle, Save } from 'lucide-react';
import { useState } from 'react';
import { WorkoutReview } from '@/components/fitness/workout-review';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { createIdempotencyKey } from '@/lib/idempotency-key';

type FitnessStage = 'CHECK_IN' | 'SAFETY_BLOCKED' | 'CATALOG_REVIEW' | 'WORKOUT_DRAFT' | 'PROPOSAL_PENDING' | 'ACTION_SCHEDULE_REQUESTED' | 'FEEDBACK' | 'DONE' | 'FAILED';
type WorkoutDetail = { workout: Workout; revision: WorkoutRevision; proposal: Proposal | null; action: { id?: string } | null; timeRequest: { id?: string } | null };
type ExerciseCatalogSearchItem = ReturnType<typeof exerciseListResponseSchema.parse>['data']['items'][number];

function failureMessage(error: unknown): string {
  if (!(error instanceof CoreClientError)) return '本地训练流程暂时不可用，请稍后重试。';
  if (error.status === 404 || error.status === 409) return '记录已变化或不存在，请刷新后重新审阅。';
  if (error.status === 422) return '当前输入不符合安全或版本要求；未创建训练。';
  if (error.status === 429) return '今日操作次数已达上限，请稍后重试。';
  if (error.status === 503) return 'Provider 尚未配置或尚待审批；可以继续使用项目内部目录手动选择。';
  return error.message;
}

function idempotentInit(): { headers: HeadersInit } {
  return { headers: { 'Idempotency-Key': createIdempotencyKey() } };
}

export function FitnessWorkspace({ initialDate }: { initialDate: string }) {
  const [localDate, setLocalDate] = useState(initialDate);
  const [sleepMinutes, setSleepMinutes] = useState('420');
  const [energyLevel, setEnergyLevel] = useState('3');
  const [discomfortLevel, setDiscomfortLevel] = useState('0');
  const [hasPain, setHasPain] = useState(false);
  const [acuteRisk, setAcuteRisk] = useState(false);
  const [goal, setGoal] = useState<'MOBILITY' | 'STRENGTH' | 'ENDURANCE' | 'RECOVERY'>('RECOVERY');
  const [earliestStartLocalTime, setEarliestStartLocalTime] = useState('10:00');
  const [latestEndLocalTime, setLatestEndLocalTime] = useState('11:00');
  const [stage, setStage] = useState<FitnessStage>('CHECK_IN');
  const [checkIn, setCheckIn] = useState<FitnessCheckIn | null>(null);
  const [catalog, setCatalog] = useState<{ manifest: { catalogVersion: string; contentSha256: string }; items: ExerciseCatalogSearchItem[] } | null>(null);
  const [selectedCitationIds, setSelectedCitationIds] = useState<string[]>([]);
  const [workoutDetail, setWorkoutDetail] = useState<WorkoutDetail | null>(null);
  const [savedWorkouts, setSavedWorkouts] = useState<Workout[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [textProviderReady, setTextProviderReady] = useState(false);

  async function loadCatalog(nextCheckIn: FitnessCheckIn): Promise<void> {
    const query = new URLSearchParams({ checkInId: nextCheckIn.id, goal, page: '1', pageSize: '5' });
    const [capabilityResult, catalogPayload] = await Promise.all([
      requestCore('health-capabilities', { method: 'GET' }),
      requestCore(`fitness/exercises?${query.toString()}`, { method: 'GET' }),
    ]);
    const capabilities = healthCapabilitiesResponseSchema.parse(capabilityResult).data;
    const exercises = exerciseListResponseSchema.parse(catalogPayload).data;
    setTextProviderReady(capabilities[0].availability === 'READY');
    setCatalog({ manifest: exercises.manifest, items: exercises.items });
    setSelectedCitationIds(exercises.items.map((item) => item.citation.citationId));
  }

  async function submitCheckIn(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore('fitness/check-ins', {
        method: 'POST', ...idempotentInit(),
        body: JSON.stringify({ localDate, sleepMinutes: Number(sleepMinutes), energyLevel: Number(energyLevel), discomfortLevel: Number(discomfortLevel), hasPain, acuteRisk }),
      });
      const nextCheckIn = fitnessCheckInResponseSchema.parse(payload).data.checkIn;
      setCheckIn(nextCheckIn);
      if (nextCheckIn.safety.eligibility === 'BLOCKED') {
        setStage('SAFETY_BLOCKED');
        return;
      }
      await loadCatalog(nextCheckIn);
      setStage('CATALOG_REVIEW');
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  function toggleCitation(citationId: string): void {
    setSelectedCitationIds((current) => current.includes(citationId) ? current.filter((value) => value !== citationId) : [...current, citationId]);
  }

  async function createWorkout(mode: 'MANUAL' | 'ASSISTED'): Promise<void> {
    if (!checkIn || (mode === 'MANUAL' && selectedCitationIds.length === 0)) return;
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore('fitness/workouts', {
        method: 'POST', ...idempotentInit(),
        body: JSON.stringify(mode === 'MANUAL'
          ? { mode, checkInId: checkIn.id, expectedCheckInVersion: 1, goal, availableEquipment: [], citationIds: selectedCitationIds, scheduling: { targetDate: localDate, durationMinutes: checkIn.safety.maxDurationMinutes, priority: 'MEDIUM', earliestStartLocalTime, latestEndLocalTime } }
          : { mode, checkInId: checkIn.id, expectedCheckInVersion: 1, goal, availableEquipment: [], disclosureVersion: 'HEALTH_DISCLOSURE_V1', scheduling: { targetDate: localDate, durationMinutes: checkIn.safety.maxDurationMinutes, priority: 'MEDIUM', earliestStartLocalTime, latestEndLocalTime } }),
      });
      const created = workoutCreateResponseSchema.parse(payload).data;
      setWorkoutDetail({ workout: created.workout, revision: created.revision, proposal: null, action: null, timeRequest: null });
      setStage('WORKOUT_DRAFT');
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  async function loadSavedWorkouts(): Promise<void> {
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore(`fitness/workouts?localDate=${encodeURIComponent(localDate)}&page=1&pageSize=50`, { method: 'GET' });
      setSavedWorkouts(workoutListResponseSchema.parse(payload).data.items);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function openSavedWorkout(workoutId: string): Promise<void> {
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore(`fitness/workouts/${workoutId}`, { method: 'GET' });
      const detail = workoutDetailResponseSchema.parse(payload).data;
      setWorkoutDetail({ ...detail, proposal: detail.proposal === null ? null : proposalResponseSchema.parse({ data: detail.proposal }).data, action: detail.action as { id?: string } | null, timeRequest: detail.timeRequest as { id?: string } | null });
      setStage(detail.workout.state === 'ACCEPTED' ? 'ACTION_SCHEDULE_REQUESTED' : detail.workout.state === 'COMPLETED' || detail.workout.state === 'SKIPPED' ? 'DONE' : detail.workout.state === 'PROPOSAL_PENDING' ? 'PROPOSAL_PENDING' : 'WORKOUT_DRAFT');
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveRevision(input: { title: string; rationale: string }): Promise<void> {
    if (!workoutDetail) return;
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore(`fitness/workouts/${workoutDetail.workout.id}/revisions`, {
        method: 'POST', ...idempotentInit(),
        body: JSON.stringify({ expectedVersion: workoutDetail.workout.version, parentRevisionId: workoutDetail.revision.id, ...input, items: workoutDetail.revision.items, scheduling: workoutDetail.revision.scheduling }),
      });
      const revised = workoutRevisionResponseSchema.parse(payload).data;
      setWorkoutDetail((current) => current ? { ...current, workout: revised.workout, revision: revised.revision } : current);
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  async function submitProposal(): Promise<void> {
    if (!workoutDetail) return;
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore(`fitness/workouts/${workoutDetail.workout.id}/proposal`, {
        method: 'POST', ...idempotentInit(), body: JSON.stringify({ expectedVersion: workoutDetail.workout.version, revisionId: workoutDetail.revision.id }),
      });
      const proposed = workoutProposalResponseSchema.parse(payload).data;
      setWorkoutDetail((current) => current ? { ...current, workout: proposed.workout, proposal: proposalResponseSchema.parse({ data: proposed.proposal }).data } : current);
      setStage('PROPOSAL_PENDING');
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  async function decideProposal(decision: 'ACCEPT' | 'REJECT'): Promise<void> {
    if (!workoutDetail?.proposal) return;
    setFailure(null);
    setIsBusy(true);
    try {
      await requestCore(`proposals/${workoutDetail.proposal.id}/decision`, { method: 'POST', ...idempotentInit(), body: JSON.stringify({ version: workoutDetail.proposal.version, decision }) });
      const payload = await requestCore(`fitness/workouts/${workoutDetail.workout.id}`, { method: 'GET' });
      const detail = workoutDetailResponseSchema.parse(payload).data;
      setWorkoutDetail({ ...detail, proposal: detail.proposal === null ? null : proposalResponseSchema.parse({ data: detail.proposal }).data, action: detail.action as { id?: string } | null, timeRequest: detail.timeRequest as { id?: string } | null });
      setStage(decision === 'ACCEPT' ? 'ACTION_SCHEDULE_REQUESTED' : 'DONE');
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  async function recordFeedback(outcome: 'COMPLETED' | 'SKIPPED'): Promise<void> {
    if (!workoutDetail) return;
    setFailure(null);
    setIsBusy(true);
    try {
      const now = new Date();
      const body = outcome === 'COMPLETED'
        ? { outcome, expectedVersion: workoutDetail.workout.version, hadPain: false, note: null, perceivedEffort: null, startedAt: new Date(now.getTime() - 30 * 60_000).toISOString(), endedAt: now.toISOString() }
        : { outcome, expectedVersion: workoutDetail.workout.version, hadPain: false, note: null, perceivedEffort: null, startedAt: null, endedAt: null };
      const payload = await requestCore(`fitness/workouts/${workoutDetail.workout.id}/feedback`, { method: 'POST', ...idempotentInit(), body: JSON.stringify(body) });
      const result = workoutFeedbackResponseSchema.parse(payload).data;
      setWorkoutDetail((current) => current ? { ...current, workout: result.workout, action: result.action as { id?: string } | null } : current);
      setStage('DONE');
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  if (stage === 'SAFETY_BLOCKED' && checkIn?.safety.eligibility === 'BLOCKED') {
    return <section className="domain-workspace health-safety" aria-labelledby="fitness-heading"><p className="section-kicker">FITNESS / SAFETY BLOCK</p><h1 id="fitness-heading">训练与恢复</h1><div className="health-safety__notice" role="alert"><AlertTriangle aria-hidden="true" size={20} /><h2>STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP</h2><p>已报告疼痛或急性风险。系统不会创建训练、查询目录或调用 Provider。</p></div></section>;
  }

  return (
    <section className="domain-workspace health-workspace" aria-labelledby="fitness-heading">
      <header className="domain-workspace__header"><p className="section-kicker">FITNESS / OWNER REVIEW</p><h1 id="fitness-heading">训练与恢复</h1><p>先记录本地状态，再由你审阅内部目录、草稿和提案。该流程不作医疗诊断。</p></header>
      {stage === 'CHECK_IN' || stage === 'FAILED' ? <form className="domain-card domain-form" onSubmit={(event) => void submitCheckIn(event)}>
        <div className="domain-card__heading"><Activity aria-hidden="true" size={19} /><div><h2>今天的训练状态</h2><p>{localDate} · 仅本地保存</p></div></div>
        <label>本地日期<input type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} /></label>
        <label>睡眠分钟<input min="0" max="1440" step="1" type="number" value={sleepMinutes} onChange={(event) => setSleepMinutes(event.target.value)} /></label>
        <label>主观精力（1–5）<select value={energyLevel} onChange={(event) => setEnergyLevel(event.target.value)}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>不适程度（0–5）<select value={discomfortLevel} onChange={(event) => setDiscomfortLevel(event.target.value)}>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="health-toggle"><input checked={hasPain} type="checkbox" onChange={(event) => setHasPain(event.target.checked)} /> 是否存在疼痛</label>
        <label className="health-toggle"><input checked={acuteRisk} type="checkbox" onChange={(event) => setAcuteRisk(event.target.checked)} /> 是否存在急性风险</label>
        {failure ? <p className="domain-form__error" role="alert">{failure}</p> : null}
        <button disabled={isBusy} type="submit"><Save aria-hidden="true" size={16} /> {isBusy ? '正在保存…' : '保存并查看训练目录'}</button>
        <button disabled={isBusy} onClick={() => void loadSavedWorkouts()} type="button">读取本地训练草稿</button>
        {savedWorkouts.map((savedWorkout) => <button key={savedWorkout.id} disabled={isBusy} onClick={() => void openSavedWorkout(savedWorkout.id)} type="button">打开训练草稿 {savedWorkout.id}</button>)}
      </form> : null}
      {stage === 'CATALOG_REVIEW' && catalog ? <section className="health-catalog" aria-labelledby="fitness-catalog-heading">
        <header><p className="section-kicker">FIRST_PARTY_INTERNAL</p><h2 id="fitness-catalog-heading">项目内部非医疗目录</h2><p>版本 {catalog.manifest.catalogVersion} · hash {catalog.manifest.contentSha256.slice(0, 12)}… · redistribution=false</p></header>
        <label>训练目标<select value={goal} onChange={(event) => setGoal(event.target.value as typeof goal)}><option value="RECOVERY">恢复</option><option value="MOBILITY">灵活</option><option value="STRENGTH">力量</option><option value="ENDURANCE">耐力</option></select></label>
        <div className="health-review__facts"><label>最早开始时间<input type="time" value={earliestStartLocalTime} onChange={(event) => setEarliestStartLocalTime(event.target.value)} /></label><label>最晚结束时间<input type="time" value={latestEndLocalTime} onChange={(event) => setLatestEndLocalTime(event.target.value)} /></label></div>
        <p className="health-catalog__provider">本次恢复状态最多安排 {checkIn?.safety.eligibility === 'ELIGIBLE' ? checkIn.safety.maxDurationMinutes : 0} 分钟；目录选择不会提高该上限。</p>
        <p className="health-catalog__provider">{textProviderReady ? '测试 Workout selector 可用；仍需你审阅。' : 'WORKOUT_TEXT_SELECTION 未配置（503 / 审批未完成）；可手动选择。'}</p>
        <button disabled={!textProviderReady || isBusy} onClick={() => void createWorkout('ASSISTED')} type="button">使用测试 Workout selector</button>
        <ul>{catalog.items.map((item) => <li key={item.citation.citationId}><label><input aria-label={`选择 ${item.name}`} checked={selectedCitationIds.includes(item.citation.citationId)} type="checkbox" onChange={() => toggleCitation(item.citation.citationId)} /> <strong>{item.name}</strong><span>{item.neutralTechniqueText}</span><small>引用 {item.citation.citationId.slice(0, 12)}…</small></label></li>)}</ul>
        <button disabled={isBusy || selectedCitationIds.length === 0} onClick={() => void createWorkout('MANUAL')} type="button">创建手动训练草稿</button>
      </section> : null}
      {workoutDetail ? <WorkoutReview key={workoutDetail.revision.id} workout={workoutDetail.workout} revision={workoutDetail.revision} proposal={workoutDetail.proposal} action={workoutDetail.action} timeRequest={workoutDetail.timeRequest} busy={isBusy} failure={failure} onSaveRevision={saveRevision} onSubmitProposal={submitProposal} onDecideProposal={decideProposal} onFeedback={recordFeedback} /> : null}
    </section>
  );
}
