'use client';

import { useState } from 'react';
import { courseImportResponseSchema } from '@ev/contracts';
import { requestCore } from '@/lib/core-client';

type ImportData = ReturnType<typeof courseImportResponseSchema.parse>['data'];

export function CourseImportReview({ initial, onUpdated }: { initial: ImportData; onUpdated: (value: ImportData) => void }) {
  const [value, setValue] = useState(initial);
  const [draftCandidates, setDraftCandidates] = useState(initial.revision?.candidates ?? []);
  const [savedReview, setSavedReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const revision = value.revision;

  async function extract(): Promise<void> {
    setBusy(true); setFailure(null);
    try {
      const payload = await requestCore(`course-imports/${value.import.id}/extract`, {
        method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: value.import.version, disclosureVersion: value.disclosure.version }),
      });
      const next = courseImportResponseSchema.parse(payload).data;
      setValue(next); onUpdated(next);
    } catch (error) { setFailure(error instanceof Error ? error.message : '课表提取未完成'); }
    finally { setBusy(false); }
  }

  async function saveReview(): Promise<void> {
    if (!revision) return;
    setBusy(true); setFailure(null);
    try {
      const payload = await requestCore(`course-imports/${value.import.id}/revisions`, {
        method: 'POST', body: JSON.stringify({
          expectedVersion: value.import.version, parentRevisionId: revision.id,
          candidates: draftCandidates.map(({ candidateId, included, title, location, weekday, startLocalTime, endLocalTime, weekStart, weekEnd, weekPattern }) => ({ candidateId, included, title, location, weekday, startLocalTime, endLocalTime, weekStart, weekEnd, weekPattern })),
        }),
      });
      const next = courseImportResponseSchema.parse(payload).data;
      setValue(next); setDraftCandidates(next.revision?.candidates ?? []); onUpdated(next); setSavedReview(true);
    } catch (error) { setFailure(error instanceof Error ? error.message : '候选审阅未保存'); }
    finally { setBusy(false); }
  }

  async function confirm(): Promise<void> {
    if (!revision) return;
    setBusy(true); setFailure(null);
    try {
      const payload = await requestCore(`course-imports/${value.import.id}/confirm`, {
        method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: value.import.version, revisionId: revision.id }),
      });
      const next = courseImportResponseSchema.parse(payload).data;
      setValue(next); onUpdated(next);
    } catch (error) { setFailure(error instanceof Error ? error.message : '确认导入未完成'); }
    finally { setBusy(false); }
  }

  if (value.import.status === 'AWAITING_DISCLOSURE') return <section className="domain-card import-result" aria-live="polite">
    <h2>请确认外发披露</h2><p>Provider：{value.disclosure.providerLabel}；证据：{value.disclosure.evidenceKind}。</p>
    {value.disclosure.evidenceKind === 'AUTOMATED_FAKE' ? <p>自动测试 Fake 证据，不代表真实 Provider。</p> : null}
    <button type="button" disabled={busy} onClick={() => void extract()}>确认披露并提取候选</button>{failure ? <p role="alert">{failure}</p> : null}
  </section>;
  if (value.import.status === 'REVIEW_REQUIRED' && revision) return <section className="domain-card import-result" aria-live="polite">
    <h2>审阅课表候选</h2><p>高置信度只作提示；保存审阅后才能确认导入。</p>
    <ul>{draftCandidates.map((candidate, index) => <li key={candidate.candidateId}>
      <label><input aria-label={`包含课程：${candidate.title}`} type="checkbox" checked={candidate.included} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item))} /> 包含</label>
      <label>课程标题<input aria-label={`课程标题：${candidate.title}`} value={candidate.title} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label>
      <label>地点<input value={candidate.location ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, location: event.target.value || null } : item))} /></label>
      <label>星期<input type="number" min="1" max="7" value={candidate.weekday} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, weekday: Number(event.target.value) } : item))} /></label>
      <label>开始<input type="time" value={candidate.startLocalTime} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, startLocalTime: event.target.value } : item))} /></label>
      <label>结束<input type="time" value={candidate.endLocalTime} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, endLocalTime: event.target.value } : item))} /></label>
      <p>总体置信度：{candidate.confidence.overall}</p><p>字段置信度：{Object.entries(candidate.confidence.fields).map(([field, confidence]) => `${field} ${confidence}`).join('；')}</p><p>溯源：{candidate.provenance.map((item) => `${item.kind}(${item.editedFields.join(',') || '原始'})`).join(' → ')}</p>
    </li>)}</ul>
    <button type="button" disabled={busy} onClick={() => void saveReview()}>保存审阅版本</button>
    {savedReview ? <button type="button" disabled={busy} onClick={() => void confirm()}>确认导入课程</button> : null}{failure ? <p role="alert">{failure}</p> : null}
  </section>;
  return <section className="domain-card import-result" aria-live="polite"><h2>课程排程待确认</h2><p>状态：{value.import.status}。日程事件只会在排程 Proposal 被接受后生成。</p></section>;
}
