'use client';

import { useRef, useState } from 'react';
import { courseImportResponseSchema } from '@ev/contracts';
import { isUncertainCoreWriteFailure, requestCore } from '@/lib/core-client';
import { createIdempotencyKey } from '@/lib/idempotency-key';

type ImportData = ReturnType<typeof courseImportResponseSchema.parse>['data'];
type SemanticWriteAttempt = { idempotencyKey: string; body: string };

export function CourseImportReview({ initial, onUpdated }: { initial: ImportData; onUpdated: (value: ImportData) => void }) {
  const [value, setValue] = useState(initial);
  const [draftCandidates, setDraftCandidates] = useState(initial.revision?.candidates ?? []);
  const [savedReview, setSavedReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const extractAttempt = useRef<SemanticWriteAttempt | null>(null);
  const confirmAttempt = useRef<SemanticWriteAttempt | null>(null);
  const revision = value.revision;

  async function extract(): Promise<void> {
    const attempt = extractAttempt.current ?? {
      idempotencyKey: createIdempotencyKey(),
      body: JSON.stringify({ expectedVersion: value.import.version, disclosureVersion: value.disclosure.version }),
    };
    extractAttempt.current = attempt;
    setBusy(true); setFailure(null);
    try {
      const payload = await requestCore(`course-imports/${value.import.id}/extract`, {
        method: 'POST', headers: { 'idempotency-key': attempt.idempotencyKey }, body: attempt.body,
      });
      const next = courseImportResponseSchema.parse(payload).data;
      extractAttempt.current = null;
      setValue(next); setDraftCandidates(next.revision?.candidates ?? []); setSavedReview(false); onUpdated(next);
    } catch (error) {
      if (!isUncertainCoreWriteFailure(error)) extractAttempt.current = null;
      setFailure(error instanceof Error ? error.message : '课表提取未完成');
    }
    finally { setBusy(false); }
  }

  async function saveReview(): Promise<void> {
    if (!revision) return;
    confirmAttempt.current = null;
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
    const attempt = confirmAttempt.current ?? {
      idempotencyKey: createIdempotencyKey(),
      body: JSON.stringify({ expectedVersion: value.import.version, revisionId: revision.id }),
    };
    confirmAttempt.current = attempt;
    setBusy(true); setFailure(null);
    try {
      const payload = await requestCore(`course-imports/${value.import.id}/confirm`, {
        method: 'POST', headers: { 'idempotency-key': attempt.idempotencyKey }, body: attempt.body,
      });
      const next = courseImportResponseSchema.parse(payload).data;
      confirmAttempt.current = null;
      setValue(next); onUpdated(next);
    } catch (error) {
      if (!isUncertainCoreWriteFailure(error)) confirmAttempt.current = null;
      setFailure(error instanceof Error ? error.message : '确认导入未完成');
    }
    finally { setBusy(false); }
  }

  if (value.import.status === 'AWAITING_DISCLOSURE') return <section className="domain-card import-result" aria-live="polite">
    <h2>请确认外发披露</h2><p>Provider：{value.disclosure.providerLabel}；证据：{value.disclosure.evidenceKind}。</p>
    {value.disclosure.evidenceKind === 'AUTOMATED_FAKE' ? <p>自动测试 Fake 证据，不代表真实 Provider。</p> : null}
    <button type="button" disabled={busy} onClick={() => void extract()}>确认披露并提取候选</button>{failure ? <p role="alert">{failure}</p> : null}
  </section>;
  if (value.import.status === 'REVIEW_REQUIRED' && revision) return <section className="domain-card import-result" aria-live="polite">
    <h2>审阅课表候选</h2><p>高置信度只作提示；保存审阅后才能确认导入。</p>
    <ul>{draftCandidates.map((candidate, index) => {
      const candidateLabel = candidate.title ?? `候选 ${index + 1}`;
      const incompleteFields = [
        candidate.title === null ? '课程标题' : null,
        candidate.weekday === null ? '星期' : null,
        candidate.startLocalTime === null ? '开始时间' : null,
        candidate.endLocalTime === null ? '结束时间' : null,
        candidate.weekStart === null ? '起始周' : null,
        candidate.weekEnd === null ? '结束周' : null,
        candidate.weekPattern === null ? '单双周' : null,
      ].filter((field): field is string => field !== null);
      return <li key={candidate.candidateId}>
        <label><input aria-label={`包含课程：${candidateLabel}`} type="checkbox" checked={candidate.included} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item))} /> 包含</label>
        {incompleteFields.length ? <p role="status">待补全：{incompleteFields.join('、')}</p> : <p>排程字段已完整</p>}
        <label>课程标题<input aria-label={`课程标题：${candidateLabel}`} value={candidate.title ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value || null } : item))} /></label>
        <label>地点<input aria-label={`地点：${candidateLabel}`} value={candidate.location ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, location: event.target.value || null } : item))} /></label>
        <label>星期<input aria-label={`星期：${candidateLabel}`} type="number" min="1" max="7" value={candidate.weekday ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, weekday: event.target.value === '' ? null : Number(event.target.value) } : item))} /></label>
        <label>开始<input aria-label={`开始：${candidateLabel}`} type="time" value={candidate.startLocalTime ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, startLocalTime: event.target.value || null } : item))} /></label>
        <label>结束<input aria-label={`结束：${candidateLabel}`} type="time" value={candidate.endLocalTime ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, endLocalTime: event.target.value || null } : item))} /></label>
        <label>起始周<input aria-label={`起始周：${candidateLabel}`} type="number" min="1" max="53" value={candidate.weekStart ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, weekStart: event.target.value === '' ? null : Number(event.target.value) } : item))} /></label>
        <label>结束周<input aria-label={`结束周：${candidateLabel}`} type="number" min="1" max="53" value={candidate.weekEnd ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, weekEnd: event.target.value === '' ? null : Number(event.target.value) } : item))} /></label>
        <label>单双周<select aria-label={`单双周：${candidateLabel}`} value={candidate.weekPattern ?? ''} onChange={(event) => setDraftCandidates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, weekPattern: event.target.value === '' ? null : event.target.value as NonNullable<typeof item.weekPattern> } : item))}>
          <option value="">待补全</option><option value="EVERY_WEEK">每周</option><option value="ODD_WEEKS">单周</option><option value="EVEN_WEEKS">双周</option>
        </select></label>
        <p>总体置信度：{candidate.confidence.overall}</p><p>字段置信度：{Object.entries(candidate.confidence.fields).map(([field, confidence]) => `${field} ${confidence}`).join('；')}</p><p>溯源：{candidate.provenance.map((item) => `${item.kind}(${item.editedFields.join(',') || '原始'})`).join(' → ')}</p>
      </li>;
    })}</ul>
    <button type="button" disabled={busy} onClick={() => void saveReview()}>保存审阅版本</button>
    {savedReview ? <button type="button" disabled={busy} onClick={() => void confirm()}>确认导入课程</button> : null}{failure ? <p role="alert">{failure}</p> : null}
  </section>;
  return <section className="domain-card import-result" aria-live="polite"><h2>课程排程待确认</h2><p>状态：{value.import.status}。日程事件只会在排程 Proposal 被接受后生成。</p></section>;
}
