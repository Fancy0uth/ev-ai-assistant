'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import * as z from 'zod';
import {
  workoutPlanningProfileV2Schema, workoutDetailedPlanningCapabilityDescriptorSchema, workoutPlanningCandidateV2Schema,
  workoutContextPreviewV2Schema, previewWorkoutContextV2Schema, createDetailedWorkoutV2Schema, reviseDetailedWorkoutV2Schema,
  workoutRevisionV2Schema, workoutSchema, proposalSchema, proposalDecisionSchema, fitnessCheckInResponseSchema,
  createFitnessCheckInSchema, workoutFeedbackSchema,
  type WorkoutPlanningProfileV2, type WorkoutPlanningAuthorizationV2, type WorkoutFeedbackInput,
  type FitnessCheckIn, type WorkoutContextPreviewV2, type WorkoutDetailedPlanningCapabilityDescriptor,
  type WorkoutPlanningCandidateV2,
} from '@ev/contracts';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { createIdempotencyKey } from '@/lib/idempotency-key';
import { DetailedWorkoutReview } from './detailed-workout-review';

const envelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema }).strict();
const profileResponse = envelope(z.object({ profile: workoutPlanningProfileV2Schema.nullable() }).strict());
const memoryItem = z.object({ id: z.uuid(), version: z.number().int().positive(), scopeType: z.enum(['FITNESS', 'DOMAIN']), scopeId: z.string(), characters: z.number().int().nonnegative() }).strict();
const memoryResponse = envelope(z.object({ items: z.array(memoryItem) }).strict());
const lineage = z.object({ id: z.uuid() }).passthrough().nullable();
const detailSchema = z.object({ workout: workoutSchema, revision: workoutRevisionV2Schema, citations: z.array(z.object({ candidate: workoutPlanningCandidateV2Schema, name: z.string(), instructions: z.array(z.string()) }).strict()), proposal: proposalSchema.nullable(), action: lineage, timeRequest: lineage, feedback: z.unknown().nullable() }).strict();
const resultSchema = z.object({ workout: workoutSchema, revision: workoutRevisionV2Schema }).strict();
const memoryStatusSchema = z.object({ state: z.enum(['RECORDED', 'SKIPPED_HUMAN_EDIT', 'SKIPPED_DELETED', 'REPLAYED', 'DEGRADED']), sourceId: z.string().optional() }).strict();
export type DetailedWorkoutDetail = z.infer<typeof detailSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
type Field = WorkoutPlanningAuthorizationV2['allowedFields'][number];
const mandatory: Field[] = ['PROFILE_GOALS', 'PROFILE_EQUIPMENT', 'PROFILE_LIMITATIONS', 'CHECK_IN', 'CANDIDATES', 'SCHEDULING'];
const optional: [Field, string][] = [['PROFILE_EXPERIENCE', '训练经验与每周频次'], ['PROFILE_BODY_MEASUREMENTS', '身体数据'], ['PROFILE_FITNESS_DESCRIPTION', '身体状态描述'], ['RECENT_FEEDBACK', '最近14天最多5条训练反馈'], ['FITNESS_MEMORY', '选中的健身记忆']];
const emptyProfile: WorkoutPlanningProfileV2 = { version: 1, goals: ['STRENGTH'], experience: 'UNKNOWN', weeklyTrainingDays: 0, availableEquipment: [], bodyMeasurements: { weight: null, height: null }, fitnessDescription: null, limitations: 'UNKNOWN', limitationsComplete: false };

function errorText(error: unknown): string {
  if (error instanceof CoreClientError) return `${error.code}：${error.message}${error.status === 409 ? ' 请重新保存相关输入并预览、确认。' : ''}`;
  if (error instanceof z.ZodError) return '输入或服务响应不符合冻结契约；请检查填写内容，未确认操作成功。';
  return '请求结果未能确认，请重试同一操作；已填写内容仍保留。';
}

export function DetailedWorkoutWorkspace({ initialDate, onBack }: { initialDate: string; onBack: () => void }) {
  const [profile, setProfile] = useState(emptyProfile);
  const [version, setVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [limitMode, setLimitMode] = useState('UNKNOWN');
  const [limitations, setLimitations] = useState('');
  const [equipment, setEquipment] = useState('');
  const [capability, setCapability] = useState<WorkoutDetailedPlanningCapabilityDescriptor | null>(null);
  const [memory, setMemory] = useState<z.infer<typeof memoryItem>[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<string[]>([]);
  const [fields, setFields] = useState<Field[]>(mandatory);
  const [checkInput, setCheckInput] = useState({ localDate: initialDate, sleepMinutes: 420, energyLevel: 3, discomfortLevel: 0, hasPain: false, acuteRisk: false });
  const [checkIn, setCheckIn] = useState<FitnessCheckIn | null>(null);
  const [goal, setGoal] = useState<WorkoutPlanningProfileV2['goals'][number]>('STRENGTH');
  const [scheduling, setScheduling] = useState({ targetDate: initialDate, durationMinutes: 30, priority: 'MEDIUM' as const, earliestStartLocalTime: '10:00', latestEndLocalTime: '11:00' });
  const [candidates, setCandidates] = useState<WorkoutPlanningCandidateV2[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [preview, setPreview] = useState<WorkoutContextPreviewV2 | null>(null);
  const [consent, setConsent] = useState(false);
  const [detail, setDetail] = useState<DetailedWorkoutDetail | null>(null);
  const [saved, setSaved] = useState<{ workout: z.infer<typeof workoutSchema>; revisionSchema: 'WORKOUT_PLAN_V1' | 'WORKOUT_PLAN_V2' }[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [safetyNotice, setSafetyNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const keys = useRef(new Map<string, string>());
  const generation = useRef<{ hash: string; consentedAt: string } | null>(null);
  function invalidate() { setPreview(null); setConsent(false); generation.current = null; }
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setFailure(null);
    try { await task(); } catch (error) { setFailure(errorText(error)); if (error instanceof CoreClientError && error.status === 409) invalidate(); }
    finally { lock.current = false; setBusy(false); }
  }
  async function post(path: string, body: unknown) {
    const serialized = JSON.stringify(body); const semantic = path + serialized;
    const key = keys.current.get(semantic) ?? createIdempotencyKey(); keys.current.set(semantic, key);
    return requestCore(path, { method: 'POST', headers: { 'Idempotency-Key': key }, body: serialized });
  }
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([requestCore('fitness/planning/profile', { method: 'GET', signal: controller.signal }), requestCore('fitness/planning/capability', { method: 'GET', signal: controller.signal }), requestCore('fitness/planning/memory', { method: 'GET', signal: controller.signal })]).then(([p, c, m]) => {
      if (controller.signal.aborted) return;
      const next = profileResponse.parse(p).data.profile;
      setCapability(envelope(workoutDetailedPlanningCapabilityDescriptorSchema).parse(c).data); setMemory(memoryResponse.parse(m).data.items);
      if (next) { setProfile(next); setVersion(next.version); setDirty(false); setGoal(next.goals[0]!); setEquipment(next.availableEquipment.join('\n')); setLimitMode(next.limitations === 'UNKNOWN' ? 'UNKNOWN' : next.limitations.length ? 'KNOWN' : 'NONE'); setLimitations(next.limitations === 'UNKNOWN' ? '' : next.limitations.join('\n')); }
      setLoaded(true);
    }).catch((e) => { if (!controller.signal.aborted) setFailure(errorText(e)); });
    return () => controller.abort();
  }, []);
  function editProfile(next: WorkoutPlanningProfileV2) { setProfile(next); setDirty(true); invalidate(); setCandidates([]); setSelectedCandidates([]); }
  async function saveProfile() { await run(async () => {
    const next = workoutPlanningProfileV2Schema.parse({ ...profile, availableEquipment: equipment.split('\n').map((s) => s.trim()).filter(Boolean), limitations: limitMode === 'UNKNOWN' ? 'UNKNOWN' : limitMode === 'NONE' ? [] : limitations.split('\n').map((s) => s.trim()).filter(Boolean), limitationsComplete: limitMode !== 'UNKNOWN' });
    if (limitMode === 'KNOWN' && (next.limitations === 'UNKNOWN' || !next.limitations.length)) throw new Error('limitations missing');
    const { version: ignored, ...body } = next;
    const result = profileResponse.parse(await requestCore('fitness/planning/profile', { method: 'PUT', body: JSON.stringify({ expectedVersion: version, profile: body }) })).data.profile;
    if (!result) throw new Error('missing profile');
    setProfile(result); setVersion(result.version); setDirty(false); invalidate();
  }); }
  async function saveCheck() { await run(async () => {
    invalidate(); setCandidates([]); setSelectedCandidates([]);
    const input = createFitnessCheckInSchema.parse(checkInput);
    const next = fitnessCheckInResponseSchema.parse(await post('fitness/check-ins', input)).data.checkIn;
    // Only a parsed, confirmed check-in ends this command, including BLOCKED results.
    // A lost/invalid response keeps its key; subsequent candidate reads cannot undo the save.
    keys.current.delete('fitness/check-ins' + JSON.stringify(input));
    setCheckIn(next);
    if (next.safety.eligibility === 'BLOCKED') { setFailure('STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP：疼痛或急性风险阻止规划，模型不能解除。'); return; }
    try {
      const items = envelope(z.object({ items: z.array(workoutPlanningCandidateV2Schema).max(5) }).strict()).parse(await requestCore(`fitness/planning/candidates?${new URLSearchParams({ checkInId: next.id, goal })}`, { method: 'GET' })).data.items;
      setCandidates(items); setSelectedCandidates(items.map((c) => c.citationId));
    } catch (error) {
      setFailure(`当天状态已保存；候选读取失败。再次点击将重新保存当天状态并读取候选。${errorText(error)}`);
    }
  }); }
  const eligible = loaded && !dirty && version !== null && profile.limitationsComplete && profile.generalExerciseScope === 'GENERAL_ADULT_19_64_V1' && checkIn?.safety.eligibility === 'ELIGIBLE' && !checkInput.hasPain && !checkInput.acuteRisk && selectedCandidates.length > 0;
  async function previewContext() { await run(async () => {
    invalidate(); if (!eligible || !checkIn || version === null) return;
    const input = previewWorkoutContextV2Schema.parse({ schemaVersion: 'WORKOUT_PLANNING_V2', goal, scheduling, checkInId: checkIn.id, expectedCheckInVersion: checkIn.version, expectedProfileVersion: version, authorization: { disclosureVersion: 'HEALTH_DISCLOSURE_V2', allowedFields: fields, selectedFitnessMemoryIds: fields.includes('FITNESS_MEMORY') ? selectedMemory : [] }, candidateCitationIds: selectedCandidates });
    setPreview(envelope(workoutContextPreviewV2Schema).parse(await requestCore('fitness/planning/context/preview', { method: 'POST', body: JSON.stringify(input) })).data);
  }); }
  async function readDetail(id: string) { const next = envelope(detailSchema).parse(await requestCore(`fitness/planning/workouts/${id}`, { method: 'GET' })).data; setDetail(next); }
  async function generate() { await run(async () => {
    if (!eligible || !preview || !consent || capability?.availability !== 'READY') return;
    const receipt = preview.previewReceipt;
    if (!generation.current || generation.current.hash !== preview.contextHash) generation.current = { hash: preview.contextHash, consentedAt: new Date().toISOString() };
    const input = createDetailedWorkoutV2Schema.parse({ schemaVersion: 'WORKOUT_PLANNING_V2', goal, scheduling, checkInId: receipt.checkInId, expectedCheckInVersion: receipt.checkInVersion, expectedProfileVersion: receipt.profileVersion, disclosureVersion: 'HEALTH_DISCLOSURE_V2', contextHash: preview.contextHash, allowedFields: receipt.allowedFields, consentedAt: generation.current.consentedAt });
    const created = envelope(resultSchema.extend({ totalDurationSeconds: z.number().int().positive(), capabilityRunId: z.uuid().nullable() }).strict()).parse(await post('fitness/planning/workouts', input)).data;
    await readDetail(created.workout.id); invalidate(); setMemoryStatus(null); setSafetyNotice(null);
  }); }
  async function revise(input: { title: string; rationale: string }) { await run(async () => {
    if (!detail) return; const r = detail.revision;
    const body = reviseDetailedWorkoutV2Schema.parse({ expectedVersion: detail.workout.version, parentRevisionId: r.id, ...input, goal: r.goal, items: r.items, alternatives: r.alternatives, scheduling: r.scheduling, contextReceipt: r.contextReceipt, policyVersion: r.policyVersion });
    const result = envelope(resultSchema).parse(await post(`fitness/planning/workouts/${detail.workout.id}/revisions`, body)).data; setDetail({ ...detail, ...result });
  }); }
  async function propose() { await run(async () => { if (!detail) return; const result = envelope(z.object({ workout: workoutSchema, proposal: proposalSchema }).strict()).parse(await post(`fitness/planning/workouts/${detail.workout.id}/proposal`, { expectedVersion: detail.workout.version, revisionId: detail.revision.id })).data; setDetail({ ...detail, ...result }); }); }
  async function decide(decision: 'ACCEPT' | 'REJECT') { await run(async () => { if (!detail?.proposal) return; await post(`proposals/${detail.proposal.id}/decision`, proposalDecisionSchema.parse({ version: detail.proposal.version, decision })); await readDetail(detail.workout.id); }); }
  async function feedback(input: WorkoutFeedbackInput) { await run(async () => {
    if (!detail) return;
    const result = envelope(z.object({ workout: workoutSchema, feedback: z.unknown(), action: lineage, activitySession: z.unknown().nullable(), safetyNotice: z.literal('STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP').nullable(), memoryStatus: memoryStatusSchema }).strict()).parse(await post(`fitness/planning/workouts/${detail.workout.id}/feedback`, workoutFeedbackSchema.parse(input))).data;
    setDetail({ ...detail, workout: result.workout, feedback: result.feedback, action: result.action }); setMemoryStatus(result.memoryStatus); setSafetyNotice(result.safetyNotice);
  }); }
  return <section className="domain-workspace health-workspace" aria-label="DeepSeek 详细训练计划">
    <h1>DeepSeek 详细训练计划</h1><button disabled={busy} onClick={onBack}>返回手动训练流程</button>
    <p>{!capability ? '正在读取能力状态' : capability.availability !== 'READY' ? '未配置详细训练能力，生成不可用。' : capability.adapterKind === 'TEST_FIXTURE' ? 'Fake 测试能力，仅合成验证。' : '详细训练能力已配置；配置存在不代表真实调用已测试。'}</p>
    <Link href="/settings/providers">配置 DeepSeek</Link><button disabled={busy} onClick={() => void run(async () => { setCapability(envelope(workoutDetailedPlanningCapabilityDescriptorSchema).parse(await requestCore('fitness/planning/capability', { method: 'GET' })).data); })}>刷新能力状态</button>
    {failure ? <p role="alert">{failure}</p> : null}
    <fieldset className="domain-form" disabled={busy || !loaded}><legend>训练画像（本地保存）</legend>
      <label>训练目标<select value={goal} onChange={(e) => { const value = e.target.value as typeof goal; setGoal(value); editProfile({ ...profile, goals: [value] }); }}>{['RECOVERY', 'MOBILITY', 'STRENGTH', 'ENDURANCE'].map((g) => <option key={g}>{g}</option>)}</select></label>
      <label>训练经验<select value={profile.experience} onChange={(e) => editProfile({ ...profile, experience: e.target.value as typeof profile.experience })}>{['UNKNOWN', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label>每周训练天数<input type="number" min="0" max="14" value={profile.weeklyTrainingDays} onChange={(e) => editProfile({ ...profile, weeklyTrainingDays: Number(e.target.value) })} /></label>
      <label>可用器械（每行一项，最多5项）<textarea value={equipment} onChange={(e) => { setEquipment(e.target.value); editProfile(profile); }} /></label>
      {(['weight', 'height'] as const).map((key) => <label key={key}>{key === 'weight' ? '体重（KG，可不填）' : '身高（CM，可不填）'}<input type="number" min="1" value={profile.bodyMeasurements[key]?.value ?? ''} onChange={(e) => editProfile({ ...profile, bodyMeasurements: { ...profile.bodyMeasurements, [key]: e.target.value ? { value: Number(e.target.value), unit: key === 'weight' ? 'KG' : 'CM' } : null } })} /></label>)}
      <label>身体状态描述<textarea maxLength={500} value={profile.fitnessDescription ?? ''} onChange={(e) => editProfile({ ...profile, fitnessDescription: e.target.value || null })} /></label>
      <label>病史与训练限制<select value={limitMode} onChange={(e) => { setLimitMode(e.target.value); editProfile(profile); }}><option value="UNKNOWN">UNKNOWN · 尚未确认</option><option value="NONE">我明确确认无已知限制</option><option value="KNOWN">我已填写已知限制</option></select></label>
      {limitMode === 'KNOWN' ? <label>已知限制（每行一项，最多5项）<textarea value={limitations} onChange={(e) => { setLimitations(e.target.value); editProfile(profile); }} /></label> : null}
      <p>当前公开依据组合仅用于一般力量训练，复用慢走、椅子坐站和靠墙俯卧撑；不用于疾病治疗或康复，也不代表专业人员审核过你的个人情况。</p>
      <label><input type="checkbox" checked={profile.generalExerciseScope === 'GENERAL_ADULT_19_64_V1'} onChange={(e) => editProfile({ ...profile, generalExerciseScope: e.target.checked ? 'GENERAL_ADULT_19_64_V1' : null })} />我确认自己为19–64岁、平时有运动且目前健康的一般成人；没有疾病、受伤、不适症状、近期手术或其他健康事件，不在孕期或近期产后，对这些动作适合自己没有疑虑。</label>
      <p>不符合或无法确认以上条件时，请先咨询医疗专业人员；不要为了生成建议而勾选。当天疼痛、急性风险和已知限制仍单独检查。</p>
      <p>未知信息不能推定无疾病；限制将由安全规则检查，模型不能解除疼痛风险。</p><button onClick={() => void saveProfile()}>保存画像</button>{!dirty && version ? <p role="status">画像已保存 v{version}</p> : null}
    </fieldset>
    <fieldset className="domain-form" disabled={busy || !loaded}><legend>当天状态与时间预算</legend>
      <label>本地训练日期<input type="date" value={checkInput.localDate} onChange={(e) => { setCheckInput({ ...checkInput, localDate: e.target.value }); setScheduling({ ...scheduling, targetDate: e.target.value }); setCheckIn(null); invalidate(); }} /></label>
      {(['sleepMinutes', 'energyLevel', 'discomfortLevel'] as const).map((key) => <label key={key}>{{ sleepMinutes: '睡眠分钟', energyLevel: '主观精力（1–5）', discomfortLevel: '不适程度（0–5）' }[key]}<input type="number" value={checkInput[key]} onChange={(e) => { setCheckInput({ ...checkInput, [key]: Number(e.target.value) }); setCheckIn(null); invalidate(); }} /></label>)}
      {(['hasPain', 'acuteRisk'] as const).map((key) => <label key={key}><input type="checkbox" checked={checkInput[key]} onChange={(e) => { setCheckInput({ ...checkInput, [key]: e.target.checked }); setCheckIn(null); invalidate(); }} />{key === 'hasPain' ? '是否存在疼痛' : '是否存在急性风险'}</label>)}
      <label>训练预算（分钟）<input type="number" min="5" max="120" value={scheduling.durationMinutes} onChange={(e) => { setScheduling({ ...scheduling, durationMinutes: Number(e.target.value) }); invalidate(); }} /></label>
      {(['earliestStartLocalTime', 'latestEndLocalTime'] as const).map((key) => <label key={key}>{key === 'earliestStartLocalTime' ? '最早开始时间' : '最晚结束时间'}<input type="time" value={scheduling[key]} onChange={(e) => { setScheduling({ ...scheduling, [key]: e.target.value }); invalidate(); }} /></label>)}
      <button disabled={dirty} onClick={() => void saveCheck()}>保存当天状态并读取候选</button>
      {checkInput.hasPain || checkInput.acuteRisk ? <p role="alert">疼痛或急性风险将阻止规划，请停止训练并寻求专业帮助。</p> : null}
    </fieldset>
    <fieldset disabled={busy}><legend>有限候选与外发范围</legend>
      {candidates.map((c) => <label key={c.citationId}><input type="checkbox" checked={selectedCandidates.includes(c.citationId)} onChange={(e) => { setSelectedCandidates(e.target.checked ? [...selectedCandidates, c.citationId] : selectedCandidates.filter((id) => id !== c.citationId)); invalidate(); }} />{c.technicalSummary}<small> {c.source} · {c.version} · {c.hash} · NOT_MEDICALLY_CERTIFIED</small></label>)}
      {candidates.filter(c => c.publicGuidance).map(c => <details key={`basis-${c.citationId}`}><summary>{c.technicalSummary.split(':')[0]}：公开适用依据</summary><p>公开指导，不是个人专业审核。允许阶段：{c.publicGuidance!.phases.map(p => ({ WARMUP: '热身', MAIN: '主训练', COOLDOWN: '放松' })[p]).join('、')}</p>{c.publicGuidance!.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.publisher} 原文</a> · 审核 {s.reviewedAt} · 核验 {s.accessedAt}<br />{s.summary}</p>)}<p>{c.publicGuidance!.engineeringEstimates}</p></details>)}
      <p>必需发送：{mandatory.join('、')}（目标、器械、限制、当天状态、候选、排程）。</p>
      {optional.map(([field, label]) => <label key={field}><input type="checkbox" checked={fields.includes(field)} onChange={(e) => { setFields(e.target.checked ? [...fields, field] : fields.filter((v) => v !== field)); invalidate(); }} />允许发送{label}</label>)}
      {memory.map((m) => <label key={m.id}><input type="checkbox" disabled={!fields.includes('FITNESS_MEMORY')} checked={selectedMemory.includes(m.id)} onChange={(e) => { setSelectedMemory(e.target.checked ? [...selectedMemory, m.id] : selectedMemory.filter((id) => id !== m.id)); invalidate(); }} />记忆 {m.scopeType}/{m.scopeId} · v{m.version} · {m.characters} 字符 · {m.id}</label>)}
      <p>最多选2条当前记忆、合计2000字符。关闭记忆不等于允许发送历史反馈。</p>
      <button disabled={!eligible} onClick={() => void previewContext()}>预览实际外发内容</button>
    </fieldset>
    {preview ? <section aria-label="实际外发预览"><p>外发 hash {preview.contextHash} · WORKOUT_PLANNING_V2 · HEALTH_DISCLOSURE_V2</p><p>实际字段：{preview.previewReceipt.allowedFields.join('、')} · 反馈 {preview.fieldCounts.feedback} · 记忆 {preview.fieldCounts.fitnessMemory} · 候选 {preview.fieldCounts.candidates} · {preview.fieldCounts.utf8Bytes} 字节</p><details><summary>展开实际发送 payload</summary><pre>{JSON.stringify(preview.payload, null, 2)}</pre></details><p>预览时间 {preview.previewReceipt.previewedAt}；点击生成时另记客户端同意声明，服务器另记实际确认时间。</p><label><input disabled={busy} type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); generation.current = null; }} />我已审阅上述实际内容并同意发送</label></section> : null}
    <button disabled={busy || !eligible || !preview || !consent || capability?.availability !== 'READY'} onClick={() => void generate()}>同意后生成详细草稿</button>
    <button disabled={busy} onClick={() => void run(async () => { const schema = envelope(z.object({ items: z.array(z.object({ workout: workoutSchema, revisionSchema: z.enum(['WORKOUT_PLAN_V1', 'WORKOUT_PLAN_V2']) }).strict()), pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }).strict() }).strict()); setSaved(schema.parse(await requestCore(`fitness/planning/workouts?page=1&pageSize=20&localDate=${encodeURIComponent(checkInput.localDate)}`, { method: 'GET' })).data.items); })}>读取详细训练草稿</button>
    {saved.map((entry) => entry.revisionSchema === 'WORKOUT_PLAN_V1' ? <p key={entry.workout.id}>旧 V1 草稿 {entry.workout.id}，请返回手动训练入口。</p> : <button key={entry.workout.id} disabled={busy} onClick={() => void run(async () => { setMemoryStatus(null); setSafetyNotice(null); await readDetail(entry.workout.id); })}>打开详细草稿 {entry.workout.id}</button>)}
    {detail ? <DetailedWorkoutReview key={detail.revision.id} detail={detail} busy={busy} memoryStatus={memoryStatus} safetyNotice={safetyNotice} onRevise={revise} onPropose={propose} onDecide={decide} onFeedback={feedback} onAgain={() => { invalidate(); setCheckIn(null); setCandidates([]); setSelectedCandidates([]); setDetail(null); void run(async () => setMemory(memoryResponse.parse(await requestCore('fitness/planning/memory', { method: 'GET' })).data.items)); }} /> : null}
  </section>;
}
