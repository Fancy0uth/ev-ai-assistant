'use client';

import {
  courseDetailResponseSchema,
  courseLearningContextResponseSchema,
  courseResourceSearchCreateResponseSchema,
  courseResourceSearchRunSchema,
  courseResourceSearchResponseSchema,
  type CourseDetail,
  type CourseResourceCitation,
  type CourseResourceSearchRun,
} from '@ev/contracts';
import { ExternalLink, LoaderCircle, Save, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CoreClientError, isUncertainCoreWriteFailure, requestCore } from '@/lib/core-client';

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '课程档案暂时无法完成操作，请稍后重试。';
}

function shortHash(hash: string): string { return `${hash.slice(0, 12)}…`; }

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `course-search-${Date.now()}`;
}

function currentRunFromError(error: unknown): CourseResourceSearchRun | undefined {
  if (!(error instanceof CoreClientError) || !error.details || typeof error.details !== 'object') return undefined;
  const parsed = courseResourceSearchRunSchema.safeParse((error.details as { currentRun?: unknown }).currentRun);
  return parsed.success ? parsed.data : undefined;
}

export function CourseDetailWorkspace({ courseId }: { courseId: string }) {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [stage, setStage] = useState('NOT_STARTED');
  const [progressNote, setProgressNote] = useState('');
  const [query, setQuery] = useState('');
  const [run, setRun] = useState<CourseResourceSearchRun | null>(null);
  const [executionKey, setExecutionKey] = useState<string | null>(null);
  const [citations, setCitations] = useState<CourseResourceCitation[]>([]);
  const [disclosure, setDisclosure] = useState<{ availability: string; adapterKind: string; evidenceKind: string; providerLabel: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    void requestCore(`courses/${courseId}`, { method: 'GET' })
      .then((payload) => {
        const loaded = courseDetailResponseSchema.parse(payload).data;
        setDetail(loaded);
        setStage(loaded.learningContext.stage);
        setProgressNote(loaded.learningContext.progressNote);
        setCitations(loaded.sources.public);
      })
      .catch((error: unknown) => setFailure(failureMessage(error)))
      .finally(() => setLoading(false));
  }, [courseId]);

  async function saveContext(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    setSaving(true);
    setFailure(null);
    try {
      const payload = await requestCore(`courses/${courseId}/learning-context`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion: detail.learningContext.version, stage, progressNote }),
      });
      const context = courseLearningContextResponseSchema.parse(payload).data;
      setDetail((current) => current ? { ...current, learningContext: context } : current);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function prepareSearch(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setSearching(true);
    try {
      const payload = await requestCore(`courses/${courseId}/resource-searches`, {
        method: 'POST', body: JSON.stringify({ query }),
      });
      const created = courseResourceSearchCreateResponseSchema.parse(payload).data;
      setRun(created.run);
      setExecutionKey(null);
      setDisclosure(created.disclosure);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setSearching(false);
    }
  }

  async function executeSearch(): Promise<void> {
    if (!run) return;
    const idempotencyKey = executionKey ?? newIdempotencyKey();
    setExecutionKey(idempotencyKey);
    setFailure(null);
    setSearching(true);
    setRun((current) => current ? { ...current, status: 'SEARCHING' } : current);
    try {
      const payload = await requestCore(`resource-searches/${run.id}/execute`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ expectedVersion: run.version, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' }),
      });
      const completed = courseResourceSearchResponseSchema.parse(payload).data;
      setRun(completed.run);
      setCitations(completed.citations);
    } catch (error) {
      const currentRun = currentRunFromError(error);
      if (currentRun) setRun(currentRun);
      if (!isUncertainCoreWriteFailure(error)) setExecutionKey(null);
      setFailure(failureMessage(error));
    } finally {
      setSearching(false);
    }
  }

  if (loading) return <section className="course-detail-workspace course-detail-workspace--loading" aria-busy="true"><LoaderCircle aria-hidden="true" /><p>正在加载课程档案…</p></section>;
  if (!detail) return <section className="course-detail-workspace" role="alert"><h1>课程档案不可用</h1><p>{failure ?? '课程不存在或你无权访问。'}</p></section>;

  return (
    <section className="course-detail-workspace" aria-labelledby="course-detail-heading">
      <header className="course-detail-workspace__header">
        <div><p className="section-kicker">COURSE / DETAIL</p><h1 id="course-detail-heading">{detail.course.title}</h1><p>课程资料分为课程官方、你提供与匿名公开检索；网页正文不会保存到本地。</p></div>
        <p className="course-detail-workspace__actions">已开放 {detail.actionCounts.open} 项学习行动</p>
      </header>

      <div className="course-detail-workspace__grid">
        <section className="domain-card course-detail-card" aria-labelledby="course-progress-heading">
          <h2 id="course-progress-heading">学习进度</h2>
          <form className="domain-form" onSubmit={(event) => void saveContext(event)}>
            <label>学习阶段<select aria-label="学习阶段" value={stage} onChange={(event) => setStage(event.target.value)}><option value="NOT_STARTED">尚未开始</option><option value="PREPARING">准备中</option><option value="IN_PROGRESS">进行中</option><option value="REVIEWING">复盘中</option><option value="COMPLETE">已完成</option></select></label>
            <label>进度记录<textarea aria-label="进度记录" value={progressNote} maxLength={2000} onChange={(event) => setProgressNote(event.target.value)} /></label>
            <button disabled={saving} type="submit"><Save aria-hidden="true" size={16} />{saving ? '正在保存…' : '保存学习进度'}</button>
          </form>
        </section>

        <section className="domain-card course-detail-card" aria-labelledby="course-rules-heading">
          <h2 id="course-rules-heading">上课规则</h2>
          {detail.rules.length === 0 ? <p>尚未记录重复上课规则。</p> : <ul className="course-detail-list">{detail.rules.map((rule) => <li key={rule.id}>{`周${rule.weekday} ${rule.startLocalTime}–${rule.endLocalTime}，第 ${rule.weekStart}–${rule.weekEnd} 周`}</li>)}</ul>}
        </section>
      </div>

      <section className="course-detail-sources" aria-labelledby="course-sources-heading">
        <div className="course-detail-section-heading"><p className="section-kicker">SOURCES</p><h2 id="course-sources-heading">可追溯资料</h2></div>
        <div className="course-detail-workspace__grid">
          <SourceCard title="课程官方" empty="尚未添加课程官网。">{detail.sources.official.map((source) => <li key={source.url}><SourceLink title={source.title} url={source.url} /></li>)}</SourceCard>
          <SourceCard title="你提供" empty="尚未添加个人课程资料。">{detail.sources.user.map((source) => <li key={source.id}><SourceLink title={source.title} url={source.url} /></li>)}</SourceCard>
          <SourceCard title="匿名公开检索" empty="尚未保存公开 citation。">{citations.map((citation) => <li key={citation.id}><SourceLink title={citation.title} url={citation.url} /><small>{`${citation.publisher} · ${citation.retrievedAt.slice(0, 10)} · ${shortHash(citation.contentHash)}`}</small></li>)}</SourceCard>
        </div>
      </section>

      <section className="course-detail-search" aria-labelledby="course-search-heading">
        <div className="course-detail-section-heading"><p className="section-kicker">匿名公开检索</p><h2 id="course-search-heading">查找可引用的公开资料</h2><p>仅在确认披露后请求已配置的匿名 Search capability；不发送 Cookie、Authorization 或课程私密内容。</p></div>
        <form className="course-detail-search__form" onSubmit={(event) => void prepareSearch(event)}>
          <label>匿名公开检索关键词<input aria-label="匿名公开检索关键词" value={query} maxLength={300} onChange={(event) => setQuery(event.target.value)} /></label>
          <button disabled={!query.trim() || searching} type="submit"><Search aria-hidden="true" size={16} />{searching ? '正在准备…' : '准备匿名公开检索'}</button>
        </form>
        {run?.status === 'BLOCKED_PROVIDER' ? <p className="course-detail-status" role="status">BLOCKED_PROVIDER：{disclosure?.providerLabel ?? '匿名公开检索能力尚未配置'}。没有页面抓取或样例结果。</p> : null}
        {run?.status === 'AWAITING_DISCLOSURE' ? <div className="course-detail-disclosure"><p>DISCLOSURE_READY：将请求 {disclosure?.providerLabel}；adapter={disclosure?.adapterKind}，evidence={disclosure?.evidenceKind}。</p><button disabled={searching} type="button" onClick={() => void executeSearch()}>确认披露并开始检索</button></div> : null}
        {run?.status === 'SEARCHING' ? <p className="course-detail-status" role="status">SEARCHING：正在验证公开 URL、DNS、重定向和响应边界。</p> : null}
        {run?.status === 'SUCCEEDED' ? <p className="course-detail-status" role="status">CITATIONS_READY：已保存 {run.citationCount} 条 metadata-only citation。{run.rejectedCount > 0 ? ` PARTIAL_RESULTS_REJECTED：拒绝 ${run.rejectedCount} 条不安全结果。` : ''}</p> : null}
        {run?.status === 'FAILED' ? <p className="course-detail-status" role="alert">FAILED：{run.failureCode ?? '公开资料检索未完成'}。</p> : null}
      </section>
      {failure ? <p className="dashboard-alert" role="alert">{failure}</p> : null}
    </section>
  );
}

function SourceCard({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const entries = children as React.ReactNode[];
  return <article className="domain-card course-detail-source-card"><h3>{title}</h3>{entries.length ? <ul className="course-detail-list">{children}</ul> : <p>{empty}</p>}</article>;
}

function SourceLink({ title, url }: { title: string; url: string }) {
  return <a href={url} rel="noreferrer" target="_blank">{title}<ExternalLink aria-hidden="true" size={14} /></a>;
}
