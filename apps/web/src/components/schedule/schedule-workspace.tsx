'use client';

import { courseImportResponseSchema, termListResponseSchema, termResponseSchema, type Term } from '@ev/contracts';
import { CalendarPlus, FileImage, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '本地日程操作暂时未完成，请稍后重试。';
}

function imageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('课表截图无法读取'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

export function ScheduleWorkspace() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [termTitle, setTermTitle] = useState('');
  const [weekOneMonday, setWeekOneMonday] = useState('');
  const [termId, setTermId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ReturnType<typeof courseImportResponseSchema.parse>['data'] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isSavingTerm, setIsSavingTerm] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    void requestCore('terms', { method: 'GET' })
      .then((payload) => {
        const loaded = termListResponseSchema.parse(payload).data;
        setTerms(loaded);
        setTermId(loaded[0]?.id ?? '');
      })
      .catch((error: unknown) => setFailure(failureMessage(error)))
      .finally(() => setIsLoading(false));
  }, []);

  async function createTerm(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setIsSavingTerm(true);
    try {
      const payload = await requestCore('terms', {
        method: 'POST',
        body: JSON.stringify({ title: termTitle, timezone: 'Asia/Shanghai', weekOneMonday }),
      });
      const term = termResponseSchema.parse(payload).data;
      setTerms((current) => [term, ...current]);
      setTermId(term.id);
      setTermTitle('');
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsSavingTerm(false);
    }
  }

  async function importScreenshot(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!file || !termId) return;
    setFailure(null);
    setIsImporting(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('仅支持 PNG、JPEG 或 WebP 课表截图');
      }
      if (file.size > 5_000_000) throw new Error('课表截图不能超过 5 MB');
      const payload = await requestCore('course-imports', {
        method: 'POST',
        body: JSON.stringify({ termId, image: { mimeType: file.type, base64: await imageAsBase64(file) } }),
      });
      setImportResult(courseImportResponseSchema.parse(payload).data);
      setFile(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : failureMessage(error));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="domain-workspace" aria-labelledby="schedule-heading">
      <header className="domain-workspace__header">
        <p className="section-kicker">SCHEDULE / REVIEW GATE</p>
        <h1 id="schedule-heading">日程与课表</h1>
        <p>课表截图先变成候选时间块；只有你确认的提案才能写入日程。原图不会保存在本地数据库。</p>
      </header>

      <div className="domain-workspace__grid">
        <form className="domain-card domain-form" onSubmit={(event) => void createTerm(event)}>
          <div className="domain-card__heading">
            <CalendarPlus aria-hidden="true" size={19} />
            <div><h2>建立学期</h2><p>这是课表规则的本地边界。</p></div>
          </div>
          <label>学期名称<input value={termTitle} onChange={(event) => setTermTitle(event.target.value)} /></label>
          <label>第一教学周的周一<input type="date" value={weekOneMonday} onChange={(event) => setWeekOneMonday(event.target.value)} /></label>
          <button disabled={isSavingTerm} type="submit"><Save aria-hidden="true" size={16} /> {isSavingTerm ? '正在建立…' : '建立本地学期'}</button>
          {isLoading ? <p className="domain-form__hint">正在读取本地课程边界…</p> : null}
          {!isLoading && terms.length === 0 ? <p className="domain-form__hint">还没有学期</p> : null}
          {!isLoading && terms.length > 0 ? <ul className="term-list">{terms.map((term) => <li key={term.id}><strong>{term.title}</strong><small>第一周：{term.weekOneMonday}</small></li>)}</ul> : null}
        </form>

        <form className="domain-card domain-form" onSubmit={(event) => void importScreenshot(event)}>
          <div className="domain-card__heading">
            <FileImage aria-hidden="true" size={19} />
            <div><h2>导入课表截图</h2><p>先建立学期后，才能把截图交给识别流程。</p></div>
          </div>
          <label>
            归属学期
            <select value={termId} disabled={terms.length === 0} onChange={(event) => setTermId(event.target.value)}>
              <option value="">选择学期</option>
              {terms.map((term) => <option key={term.id} value={term.id}>{term.title}</option>)}
            </select>
          </label>
          <label>
            课表截图
            <input aria-label="课表截图" accept="image/png,image/jpeg,image/webp" type="file" disabled={terms.length === 0} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <p className="domain-form__hint">PNG、JPEG 或 WebP，最大 5 MB；原图仅用于本次识别请求。</p>
          <button disabled={!file || !termId || isImporting} type="submit"><FileImage aria-hidden="true" size={16} /> {isImporting ? '正在识别…' : '生成待审核日程'}</button>
        </form>
      </div>

      {failure ? <p className="domain-form__error domain-workspace__error" role="alert">{failure}</p> : null}
      {importResult ? <ImportResult result={importResult} /> : null}
    </section>
  );
}

function ImportResult({ result }: { result: ReturnType<typeof courseImportResponseSchema.parse>['data'] }) {
  return (
    <section className="domain-card import-result" aria-live="polite">
      <p className="section-kicker">IMPORT RESULT</p>
      <h2>{result.run.status === 'PROPOSED' ? '已生成待确认提案' : result.run.status === 'REVIEW_REQUIRED' ? '需要人工核对候选' : '导入暂未完成'}</h2>
      <p>识别到 {result.run.candidateCount} 个候选时间块；状态：{result.run.status}</p>
      {result.run.candidates.length > 0 ? <ul>{result.run.candidates.map((candidate) => <li key={`${candidate.title}-${candidate.weekday}-${candidate.startLocalTime}`}><strong>{candidate.title}</strong><small>周{candidate.weekday} · {candidate.startLocalTime}–{candidate.endLocalTime} · 置信度 {Math.round(candidate.confidence * 100)}%</small></li>)}</ul> : null}
      {result.proposal ? <p className="domain-result__boundary">提案“{result.proposal.title}”正在等待你的确认，尚未写入日程。</p> : null}
    </section>
  );
}
