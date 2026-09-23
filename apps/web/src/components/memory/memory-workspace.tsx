'use client';

import {
  courseListResponseSchema,
  entityMemoryDocumentResponseSchema,
  entityMemoryRevisionListResponseSchema,
  memoryCompactionDraftDetailResponseSchema,
  memoryCompactionDraftListResponseSchema,
  memoryCompactionDraftResponseSchema,
  memoryCompactionOutcomeResponseSchema,
  sessionResponseSchema,
  type EntityMemoryDocument,
  type EntityMemoryRevision,
  type EntityMemoryScopeType,
  type MemoryCompactionDraft,
  type MemoryScope,
} from '@ev/contracts';
import { History, RotateCcw, Save, Scissors, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

const legacyScopes: Exclude<MemoryScope, 'PROJECT'>[] = ['GENERAL', 'FITNESS', 'LEARNING'];
const scopeCopy: Record<MemoryScope, string> = { GENERAL: '通用', FITNESS: '训练', LEARNING: '学习', PROJECT: '项目' };
const entityTypeCopy: Record<EntityMemoryScopeType, string> = {
  DOMAIN: '既有领域', PROJECT: '项目', COURSE: '课程', FITNESS: '训练', NUTRITION: '饮食', DAILY: '每日计划',
};

type MemoryIdentity = { scopeType: EntityMemoryScopeType; scopeId: string };
type CourseItem = ReturnType<typeof courseListResponseSchema.parse>['data'][number];

function failureMessage(error: unknown): string {
  if (!(error instanceof CoreClientError)) return '本地记忆暂时未完成操作，请稍后重试。';
  if (error.status === 404) return error.code === 'MEMORY_NOT_FOUND' ? '该范围尚未建立记忆。' : '所选实体不存在或不属于当前 Owner。';
  if (error.status === 409) return '记忆或草案已变化，请重新读取后再确认。';
  if (error.status === 503) return '外部压缩 Provider 未配置；请使用 LOCAL_RULES。';
  return error.message;
}

function identityKey(identity: MemoryIdentity): string {
  return `${identity.scopeType}:${identity.scopeId}`;
}

function defaultDailyScopeId(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MemoryWorkspace() {
  const [scopeType, setScopeType] = useState<EntityMemoryScopeType>('DOMAIN');
  const [scopeId, setScopeId] = useState<MemoryScope | string>('GENERAL');
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [document, setDocument] = useState<EntityMemoryDocument | null>(null);
  const [draft, setDraft] = useState('');
  const [revisions, setRevisions] = useState<EntityMemoryRevision[]>([]);
  const [compactionDrafts, setCompactionDrafts] = useState<MemoryCompactionDraft[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [mutatingDraftId, setMutatingDraftId] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const identity: MemoryIdentity = { scopeType, scopeId: String(scopeId) };
  const scopeGeneration = useRef({ key: 'DOMAIN:GENERAL', epoch: 0 });
  const renderedGeneration = scopeGeneration.current;
  const mounted = useRef(true);
  const readyGeneration = useRef<typeof renderedGeneration | null>(null);
  const mutationGeneration = useRef<typeof renderedGeneration | null>(null);
  const isCurrent = (generation: typeof renderedGeneration) => mounted.current && scopeGeneration.current === generation;
  const belongsHere = (value: MemoryIdentity) => identityKey(value) === renderedGeneration.key;

  // Object identity distinguishes A → B → A, even when the scope key matches again.
  async function scopedRequest(generation: typeof renderedGeneration, path: string, init: RequestInit): Promise<unknown> {
    if (!isCurrent(generation)) throw new Error('STALE_MEMORY_REQUEST');
    const result = await requestCore(path, init);
    if (!isCurrent(generation)) throw new Error('STALE_MEMORY_REQUEST');
    return result;
  }

  function selectIdentity(next: MemoryIdentity): void {
    if (identityKey(next) === scopeGeneration.current.key) return;
    scopeGeneration.current = { key: identityKey(next), epoch: scopeGeneration.current.epoch + 1 };
    readyGeneration.current = null;
    mutationGeneration.current = null;
    ++loadSequence.current;
    setScopeType(next.scopeType);
    setScopeId(next.scopeId);
    setDocument(null);
    setDraft('');
    setRevisions([]);
    setCompactionDrafts([]);
    setFailure(null);
    setNotice(null);
    setIsSaving(false);
    setIsCompacting(false);
    setMutatingDraftId(null);
    setIsLoading(Boolean(next.scopeId));
  }

  function canAct(): boolean {
    return isCurrent(renderedGeneration) && readyGeneration.current === renderedGeneration
      && mutationGeneration.current === null && (!document || belongsHere(document));
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      requestCore('courses', { method: 'GET' }),
      requestCore('auth/session', { method: 'GET' }),
    ]).then(([coursePayload, sessionPayload]) => {
      if (!active) return;
      setCourses(courseListResponseSchema.parse(coursePayload).data);
      const session = sessionResponseSchema.parse(sessionPayload).data;
      setOwnerId(session.authenticated ? session.owner.id : '');
    }).catch((error: unknown) => { if (active) setFailure(failureMessage(error)); })
      .finally(() => { if (active) setIsBooting(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!scopeId) {
      setIsLoading(false);
      setDocument(null);
      setDraft('');
      setRevisions([]);
      setCompactionDrafts([]);
      return;
    }
    void loadIdentity({ scopeType, scopeId: String(scopeId) });
  }, [scopeId, scopeType]);

  async function loadIdentity(nextIdentity: MemoryIdentity): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    const sequence = ++loadSequence.current;
    const path = `memory/entities/${encodeURIComponent(nextIdentity.scopeType)}/${encodeURIComponent(nextIdentity.scopeId)}`;
    setIsLoading(true);
    try {
      let loadedDocument: EntityMemoryDocument | null = null;
      try {
        const documentPayload = await scopedRequest(generation,path, { method: 'GET' });
        loadedDocument = entityMemoryDocumentResponseSchema.parse(documentPayload).data;
      } catch (error) {
      if (!isCurrent(generation)) return;
        if (!(error instanceof CoreClientError) || error.code !== 'MEMORY_NOT_FOUND') throw error;
      }
      const revisionsPayload = await scopedRequest(generation,`${path}/revisions`, { method: 'GET' });
      const loadedRevisions = entityMemoryRevisionListResponseSchema.parse(revisionsPayload).data;
      const loadedDrafts = loadedDocument === null
        ? []
        : memoryCompactionDraftListResponseSchema.parse(await scopedRequest(generation,
          `memory/compactions/${encodeURIComponent(nextIdentity.scopeType)}/${encodeURIComponent(nextIdentity.scopeId)}`,
          { method: 'GET' },
        )).data.items;
      if (!isCurrent(generation) || sequence !== loadSequence.current) return;
      if ((loadedDocument && !belongsHere(loadedDocument)) || loadedRevisions.some((item) => !belongsHere(item))
        || loadedDrafts.some((item) => !belongsHere(item))) throw new Error('MEMORY_IDENTITY_MISMATCH');
      readyGeneration.current = generation;
      setDocument(loadedDocument);
      setDraft(loadedDocument?.content ?? '');
      setRevisions(loadedRevisions);
      setCompactionDrafts(loadedDrafts);
      setFailure(null);
    } catch (error) {
      if (!isCurrent(generation)) return;
      if (!isCurrent(generation) || sequence !== loadSequence.current) return;
      setDocument(null);
      setDraft('');
      setRevisions([]);
      setCompactionDrafts([]);
      setFailure(failureMessage(error));
    } finally {
      if (!isCurrent(generation)) return;
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }

  function selectLegacyScope(scope: MemoryScope): void {
    selectIdentity({ scopeType: 'DOMAIN', scopeId: scope });
  }

  function selectEntityType(nextType: EntityMemoryScopeType): void {
    if (nextType === 'PROJECT') return;
    const nextScopeId = nextType === 'DOMAIN'
      ? 'GENERAL'
      : nextType === 'COURSE'
          ? courses[0]?.id ?? ''
          : nextType === 'DAILY'
            ? defaultDailyScopeId()
            : ownerId;
    selectIdentity({ scopeType: nextType, scopeId: nextScopeId });
  }

  async function loadRevisions(): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    if (!scopeId) return;
    setFailure(null);
    try {
      const payload = await scopedRequest(generation,
        `memory/entities/${encodeURIComponent(scopeType)}/${encodeURIComponent(String(scopeId))}/revisions`,
        { method: 'GET' },
      );
      const loaded = entityMemoryRevisionListResponseSchema.parse(payload).data;
      if (loaded.some((item) => !belongsHere(item))) throw new Error('MEMORY_IDENTITY_MISMATCH');
      setRevisions(loaded);
    } catch (error) {
      if (!isCurrent(generation)) return;
      setFailure(failureMessage(error));
    }
  }

  async function refreshCompactionDrafts(nextIdentity: MemoryIdentity): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    const payload = await scopedRequest(generation,
      `memory/compactions/${encodeURIComponent(nextIdentity.scopeType)}/${encodeURIComponent(nextIdentity.scopeId)}`,
      { method: 'GET' },
    );
    const loaded = memoryCompactionDraftListResponseSchema.parse(payload).data.items;
    if (loaded.some((item) => !belongsHere(item))) throw new Error('MEMORY_IDENTITY_MISMATCH');
    setCompactionDrafts(loaded);
  }

  async function save(): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    if (!canAct()) return;
    if (!scopeId) return;
    setFailure(null);
    setNotice(null);
    setIsSaving(true);
    mutationGeneration.current = generation;
    try {
      const payload = await scopedRequest(generation,
        `memory/entities/${encodeURIComponent(scopeType)}/${encodeURIComponent(String(scopeId))}`,
        { method: 'PUT', body: JSON.stringify({ content: draft, expectedVersion: document?.version ?? null }) },
      );
      const next = entityMemoryDocumentResponseSchema.parse(payload).data;
      if (!belongsHere(next)) throw new Error('MEMORY_IDENTITY_MISMATCH');
      setDocument(next);
      setDraft(next.content);
      await Promise.all([loadRevisions(), refreshCompactionDrafts({ scopeType, scopeId: String(scopeId) })]);
      if (!isCurrent(generation)) return;
      setNotice('已追加一个可审计的记忆版本。');
    } catch (error) {
      if (!isCurrent(generation)) return;
      setFailure(failureMessage(error));
    } finally {
      if (!isCurrent(generation)) return;
      mutationGeneration.current = null;
      setIsSaving(false);
    }
  }

  async function restore(revisionVersion: number): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    if (!canAct()) return;
    if (!document) return;
    setFailure(null);
    setNotice(null);
    mutationGeneration.current = generation;
    try {
      const payload = await scopedRequest(generation,
        `memory/entities/${encodeURIComponent(scopeType)}/${encodeURIComponent(String(scopeId))}/restore`,
        { method: 'POST', body: JSON.stringify({ expectedVersion: document.version, revisionVersion }) },
      );
      const next = entityMemoryDocumentResponseSchema.parse(payload).data;
      if (!belongsHere(next)) throw new Error('MEMORY_IDENTITY_MISMATCH');
      setDocument(next);
      setDraft(next.content);
      await Promise.all([loadRevisions(), refreshCompactionDrafts(identity)]);
      if (!isCurrent(generation)) return;
      setNotice(`已从历史版本 ${revisionVersion} 追加恢复版本。`);
    } catch (error) {
      if (!isCurrent(generation)) return;
      setFailure(failureMessage(error));
    } finally {
      if (isCurrent(generation)) mutationGeneration.current = null;
    }
  }

  async function remove(): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    if (!canAct()) return;
    if (!document || !window.confirm(`永久删除 ${entityTypeCopy[scopeType]} 记忆及其历史版本？此操作无法恢复。`)) return;
    setFailure(null);
    setNotice(null);
    mutationGeneration.current = generation;
    try {
      await scopedRequest(generation,
        `memory/entities/${encodeURIComponent(scopeType)}/${encodeURIComponent(String(scopeId))}`,
        { method: 'DELETE', body: JSON.stringify({ expectedVersion: document.version }) },
      );
      setDocument(null);
      setDraft('');
      setRevisions([]);
      setCompactionDrafts([]);
      if (!isCurrent(generation)) return;
      setNotice('记忆已删除；此范围的草案与恢复操作已从页面移除。');
    } catch (error) {
      if (!isCurrent(generation)) return;
      setFailure(failureMessage(error));
    } finally {
      if (isCurrent(generation)) mutationGeneration.current = null;
    }
  }

  async function createCompactionDraft(): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    if (!canAct()) return;
    if (!document) return;
    setFailure(null);
    setNotice(null);
    setIsCompacting(true);
    mutationGeneration.current = generation;
    try {
      const payload = await scopedRequest(generation,'memory/compactions', {
        method: 'POST',
        body: JSON.stringify({ ...identity, mode: 'LOCAL_RULES', expectedVersion: document.version }),
      });
      const result = memoryCompactionDraftResponseSchema.parse(payload).data;
      if (!belongsHere(result.draft)) throw new Error('MEMORY_IDENTITY_MISMATCH');
      setCompactionDrafts((current) => [result.draft, ...current.filter((draftItem) => draftItem.id !== result.draft.id)]);
      if (!isCurrent(generation)) return;
      setNotice(result.reused ? '已读取同一版本的待确认压缩草案。' : '已生成 LOCAL_RULES 压缩草案，尚未改写记忆。');
    } catch (error) {
      if (!isCurrent(generation)) return;
      setFailure(failureMessage(error));
    } finally {
      if (!isCurrent(generation)) return;
      mutationGeneration.current = null;
      setIsCompacting(false);
    }
  }

  function replaceCompactionDraft(next: MemoryCompactionDraft): void {
    if (!isCurrent(renderedGeneration) || !belongsHere(next)) return;
    setCompactionDrafts((current) => [next, ...current.filter((draftItem) => draftItem.id !== next.id)]);
  }

  async function rejectCompactionDraft(compactionDraft: MemoryCompactionDraft): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    if (!canAct()) return;
    if (!document || !belongsHere(compactionDraft) || !compactionDrafts.some((item) => item === compactionDraft)) return;
    setFailure(null);
    setMutatingDraftId(compactionDraft.id);
    mutationGeneration.current = generation;
    try {
      const payload = await scopedRequest(generation,`memory/compactions/drafts/${encodeURIComponent(compactionDraft.id)}/reject`, {
        method: 'POST', body: JSON.stringify({ expectedDraftVersion: compactionDraft.version }),
      });
      replaceCompactionDraft(memoryCompactionDraftDetailResponseSchema.parse(payload).data.draft);
      if (!isCurrent(generation)) return;
      setNotice('已拒绝压缩草案；记忆内容未变化。');
    } catch (error) {
      if (!isCurrent(generation)) return;
      setFailure(failureMessage(error));
    } finally {
      if (!isCurrent(generation)) return;
      mutationGeneration.current = null;
      setMutatingDraftId(null);
    }
  }

  async function confirmCompactionDraft(compactionDraft: MemoryCompactionDraft): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    if (!canAct()) return;
    if (!document || !belongsHere(compactionDraft) || !compactionDrafts.some((item) => item === compactionDraft)) return;
    if (!document) return;
    setFailure(null);
    setMutatingDraftId(compactionDraft.id);
    mutationGeneration.current = generation;
    try {
      const payload = await scopedRequest(generation,`memory/compactions/drafts/${encodeURIComponent(compactionDraft.id)}/confirm`, {
        method: 'POST', body: JSON.stringify({ expectedVersion: document.version, expectedDraftVersion: compactionDraft.version }),
      });
      const result = memoryCompactionOutcomeResponseSchema.parse(payload).data;
      if (!belongsHere(result.document) || !belongsHere(result.draft) || result.draft.id !== compactionDraft.id) throw new Error('MEMORY_IDENTITY_MISMATCH');
      setDocument(result.document);
      setDraft(result.document.content);
      replaceCompactionDraft(result.draft);
      await loadRevisions();
      if (!isCurrent(generation)) return;
      setNotice('已确认草案并追加压缩后的记忆版本。');
    } catch (error) {
      if (!isCurrent(generation)) return;
      setFailure(failureMessage(error));
    } finally {
      if (!isCurrent(generation)) return;
      mutationGeneration.current = null;
      setMutatingDraftId(null);
    }
  }

  async function restoreDraftSource(compactionDraft: MemoryCompactionDraft, revisionVersion: number): Promise<void> {
    const generation = renderedGeneration;
    if (!isCurrent(generation)) return;
    if (!canAct()) return;
    if (!document || !belongsHere(compactionDraft) || !compactionDrafts.some((item) => item === compactionDraft)) return;
    if (!document) return;
    setFailure(null);
    setMutatingDraftId(compactionDraft.id);
    mutationGeneration.current = generation;
    try {
      const payload = await scopedRequest(generation,`memory/compactions/drafts/${encodeURIComponent(compactionDraft.id)}/restore`, {
        method: 'POST', body: JSON.stringify({ expectedVersion: document.version, revisionVersion }),
      });
      const result = memoryCompactionOutcomeResponseSchema.parse(payload).data;
      if (!belongsHere(result.document) || !belongsHere(result.draft) || result.draft.id !== compactionDraft.id) throw new Error('MEMORY_IDENTITY_MISMATCH');
      setDocument(result.document);
      setDraft(result.document.content);
      replaceCompactionDraft(result.draft);
      await loadRevisions();
      if (!isCurrent(generation)) return;
      setNotice(`已从草案来源版本 ${revisionVersion} 追加恢复版本。`);
    } catch (error) {
      if (!isCurrent(generation)) return;
      setFailure(failureMessage(error));
    } finally {
      if (!isCurrent(generation)) return;
      mutationGeneration.current = null;
      setMutatingDraftId(null);
    }
  }

  const currentScopeLabel = scopeType === 'DOMAIN' ? `${scopeId} · ${scopeCopy[scopeId as MemoryScope]}` : `${entityTypeCopy[scopeType]} · ${scopeId || '未选择'}`;
  const scopeAvailable = Boolean(scopeId) && !(scopeType === 'COURSE' && courses.length === 0) && !((scopeType === 'FITNESS' || scopeType === 'NUTRITION') && !ownerId);

  return (
    <section className="domain-workspace" aria-labelledby="memory-heading">
      <header className="domain-workspace__header">
        <p className="section-kicker">LOCAL MEMORY / ENTITY + COMPACTION REVIEW</p>
        <h1 id="memory-heading">Agent 本地记忆</h1>
        <p>既有领域继续作为 DOMAIN 记忆使用；课程、训练、饮食与每日计划可按实体单独保存。压缩只产生草案，确认前不会改写内容。</p>
      </header>

      <div className="memory-workspace">
        <nav aria-label="既有记忆范围" className="memory-scopes">
          {legacyScopes.map((item) => <button key={item} aria-pressed={scopeType === 'DOMAIN' && item === scopeId} disabled={isBooting} type="button" onClick={() => selectLegacyScope(item)}>切换记忆范围：{item}<small>{scopeCopy[item]}</small></button>)}
        </nav>
        <div className="domain-card memory-editor">
          <div className="memory-editor__heading"><div><p className="section-kicker">{scopeType} / {scopeId || 'UNSELECTED'}</p><h2>{document ? `${currentScopeLabel} · v${document.version}` : `${currentScopeLabel} · 尚未建立`}</h2></div><span>{isBooting || isLoading ? '正在读取…' : '仅本机'}</span></div>

          <div className="memory-scope-picker">
            <label>实体记忆范围<select aria-label="实体记忆类型" value={scopeType} disabled={isBooting} onChange={(event) => selectEntityType(event.target.value as EntityMemoryScopeType)}><option value="DOMAIN">DOMAIN（既有领域）</option><option value="COURSE">COURSE（课程）</option><option value="FITNESS">FITNESS（当前 Owner）</option><option value="NUTRITION">NUTRITION（当前 Owner）</option><option value="DAILY">DAILY（日期）</option></select></label>
            {scopeType === 'DOMAIN' ? <label>既有领域<select aria-label="既有记忆范围" value={scopeId} onChange={(event) => selectIdentity({ scopeType, scopeId: event.target.value })}>{legacyScopes.map((item) => <option key={item} value={item}>{item} · {scopeCopy[item]}</option>)}</select></label> : null}
            {scopeType === 'COURSE' ? <label>课程<select aria-label="课程实体记忆范围" value={scopeId} disabled={courses.length === 0} onChange={(event) => selectIdentity({ scopeType, scopeId: event.target.value })}><option value="">选择课程</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label> : null}
            {scopeType === 'DAILY' ? <label>计划日期<input aria-label="每日实体记忆日期" value={scopeId} type="date" onChange={(event) => selectIdentity({ scopeType, scopeId: event.target.value })} /></label> : null}
            {(scopeType === 'FITNESS' || scopeType === 'NUTRITION') ? <p className="domain-form__hint">该实体固定绑定当前 Owner；其他实体不会共享此记忆。</p> : null}
            {scopeType === 'COURSE' && courses.length === 0 ? <p className="domain-form__hint">尚无课程；请先在学习页建立课程档案。</p> : null}
          </div>

          <label htmlFor="memory-content">{currentScopeLabel} 记忆内容</label>
          <textarea disabled={isBooting || isLoading || !scopeAvailable} id="memory-content" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="用简洁的 Markdown 记录稳定、可复用的偏好或上下文。" />
          <div className="memory-editor__actions">
            <button disabled={isBooting || isLoading || isSaving || !scopeAvailable || draft.trim().length === 0} type="button" onClick={() => void save()}><Save aria-hidden="true" size={16} /> {isSaving ? '正在保存…' : '追加记忆版本'}</button>
            <button disabled={isBooting || isLoading || !document} type="button" onClick={() => void loadRevisions()}><History aria-hidden="true" size={16} /> 查看历史版本</button>
            <button disabled={isBooting || isLoading || !document} type="button" onClick={() => void remove()}><Trash2 aria-hidden="true" size={16} /> 删除当前记忆</button>
          </div>
          {failure ? <p className="domain-form__error" role="alert">{failure}</p> : null}
          {notice ? <p className="meal-confirmation" role="status">{notice}</p> : null}
          <p className="domain-result__boundary">版本记录是事实来源；DOMAIN 兼容既有 SQLite/MEMORY.md 投影，实体范围有独立审计链。</p>
        </div>
      </div>

      {document ? <section className="domain-card memory-compaction" aria-labelledby="memory-compaction-heading"><div className="memory-editor__heading"><div><p className="section-kicker">LOCAL_RULES / DRAFT ONLY</p><h2 id="memory-compaction-heading">记忆压缩草案</h2></div><span>{compactionDrafts.length} 个草案</span></div><p>草案显示来源版本、字节预算与逐段差异；拒绝不改写，确认才会追加新版本。</p><div className="memory-editor__actions"><button disabled={isCompacting} aria-busy={isCompacting || undefined} type="button" onClick={() => void createCompactionDraft()}><Scissors aria-hidden="true" size={16} /> {isCompacting ? '正在生成…' : '生成 LOCAL_RULES 压缩草案'}</button></div>{compactionDrafts.length === 0 ? <p className="domain-form__hint">还没有压缩草案。</p> : <ul className="memory-compaction__list">{compactionDrafts.map((compactionDraft) => {
        const busy = mutatingDraftId === compactionDraft.id;
        return <li key={compactionDraft.id}><strong>{compactionDraft.status} · {compactionDraft.mode} · {compactionDraft.trigger}</strong><p>{compactionDraft.summary}</p><p>来源：{compactionDraft.sourceRevisions.map((source) => `v${source.version}（${source.contentBytes} bytes）`).join('、') || '无'}；预算：输入 {compactionDraft.inputBytes} / 输出 {compactionDraft.outputBytes ?? '—'} / 上限 {compactionDraft.byteBudget} bytes。</p>{compactionDraft.diff ? <details><summary>差异：保留 {compactionDraft.diff.kept.length} 段，合并 {compactionDraft.diff.merged.length} 段</summary><ul>{compactionDraft.diff.kept.slice(0, 8).map((segment, index) => <li key={`kept:${index}`}>保留：{segment.segment}</li>)}{compactionDraft.diff.merged.slice(0, 8).map((segment, index) => <li key={`merged:${index}`}>合并：{segment.segment}</li>)}</ul></details> : null}{compactionDraft.failureCode ? <p>未生成原因：{compactionDraft.failureCode}</p> : null}{compactionDraft.status === 'PENDING' ? <div className="memory-editor__actions"><button disabled={busy} type="button" onClick={() => void rejectCompactionDraft(compactionDraft)}>拒绝压缩草案</button><button disabled={busy} aria-busy={busy || undefined} type="button" onClick={() => void confirmCompactionDraft(compactionDraft)}>{busy ? '正在确认…' : '确认压缩草案'}</button></div> : null}{compactionDraft.status === 'ACCEPTED' ? <div className="memory-compaction__restore"><p>确认后的草案可从其来源版本追加恢复：</p>{compactionDraft.sourceRevisions.map((source) => <button disabled={busy} key={source.id} type="button" onClick={() => void restoreDraftSource(compactionDraft, source.version)}><RotateCcw aria-hidden="true" size={14} /> 恢复来源版本 {source.version}</button>)}</div> : null}</li>;
      })}</ul>}</section> : null}

      {document && revisions.length > 0 ? <section className="domain-card memory-history" aria-labelledby="memory-history-heading"><p className="section-kicker">REVISION HISTORY</p><h2 id="memory-history-heading">历史版本</h2><ul>{revisions.map((revision) => <li key={revision.id}><div><strong>v{revision.version} · {revision.source}</strong><p>{revision.content}</p></div><button disabled={revision.version === document.version} type="button" onClick={() => void restore(revision.version)}><RotateCcw aria-hidden="true" size={15} /> 追加恢复版本 {revision.version}</button></li>)}</ul></section> : null}
    </section>
  );
}
