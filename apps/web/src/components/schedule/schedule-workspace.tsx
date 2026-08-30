'use client';

import {
  courseArtifactResponseSchema,
  courseImportResponseSchema,
  termListResponseSchema,
  termResponseSchema,
  type Term,
} from '@ev/contracts';
import { CalendarPlus, FileImage, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { ManualEventProposalPanel } from './manual-event-proposal-panel';

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '本地日程操作暂时未完成，请稍后重试。';
}

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
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
      const uploaded = courseArtifactResponseSchema.parse(await requestCore('course-artifacts', {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      })).data;
      const payload = await requestCore('course-imports', {
        method: 'POST',
        body: JSON.stringify({ termId, artifactId: uploaded.artifact.id }),
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
        <p>课表截图先作为私有本地文件保存，再变成候选时间块；只有你确认的提案才能写入日程。</p>
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
          <p className="domain-form__hint">PNG、JPEG 或 WebP，最大 5 MB；图片会先安全保存在本地，确认外发前不会发送给 Provider。</p>
          <button disabled={!file || !termId || isImporting} type="submit"><FileImage aria-hidden="true" size={16} /> {isImporting ? '正在保存…' : '保存并查看外发披露'}</button>
        </form>
      </div>

      {failure ? <p className="domain-form__error domain-workspace__error" role="alert">{failure}</p> : null}
      {importResult ? <ImportResult result={importResult} /> : null}
      <ManualEventProposalPanel initialDate={todayInShanghai()} />
    </section>
  );
}

function ImportResult({ result }: { result: ReturnType<typeof courseImportResponseSchema.parse>['data'] }) {
  const blocked = result.import.status === 'BLOCKED_PROVIDER';
  return (
    <section className="domain-card import-result" aria-live="polite">
      <p className="section-kicker">IMPORT RESULT</p>
      <h2>{blocked ? 'Provider 未配置，外发已阻断' : '请先确认外发披露'}</h2>
      <p>图片已保存到 Owner 私有本地 artifact；状态：{result.import.status}</p>
      <p className="domain-result__boundary">用途：{result.disclosure.purpose}。Provider：{result.disclosure.providerLabel}；证据：{result.disclosure.evidenceKind}。</p>
      <p>将发送：{result.disclosure.selectedData.join('、')}。本任务尚未调用任何外部 Provider。</p>
    </section>
  );
}
