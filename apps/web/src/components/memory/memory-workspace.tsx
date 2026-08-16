'use client';

import {
  memoryDocumentListResponseSchema,
  memoryDocumentResponseSchema,
  memoryRevisionListResponseSchema,
  type MemoryDocument,
  type MemoryRevision,
  type MemoryScope,
} from '@ev/contracts';
import { History, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

const scopes: MemoryScope[] = ['GENERAL', 'FITNESS', 'LEARNING', 'PROJECT'];
const scopeCopy: Record<MemoryScope, string> = { GENERAL: '通用', FITNESS: '训练', LEARNING: '学习', PROJECT: '项目' };

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '本地记忆暂时未完成操作，请稍后重试。';
}

export function MemoryWorkspace() {
  const [documents, setDocuments] = useState<MemoryDocument[]>([]);
  const [scope, setScope] = useState<MemoryScope>('GENERAL');
  const [draft, setDraft] = useState('');
  const [revisions, setRevisions] = useState<MemoryRevision[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void requestCore('memory', { method: 'GET' })
      .then((payload) => {
        const loaded = memoryDocumentListResponseSchema.parse(payload).data;
        const initial = loaded[0];
        setDocuments(loaded);
        setScope(initial?.scope ?? 'GENERAL');
        setDraft(initial?.content ?? '');
      })
      .catch((error: unknown) => setFailure(failureMessage(error)))
      .finally(() => setIsLoading(false));
  }, []);

  const document = documents.find((item) => item.scope === scope);

  function selectScope(nextScope: MemoryScope): void {
    setScope(nextScope);
    setDraft(documents.find((item) => item.scope === nextScope)?.content ?? '');
    setRevisions([]);
    setFailure(null);
  }

  async function save(): Promise<void> {
    setFailure(null);
    setIsSaving(true);
    try {
      const payload = await requestCore(`memory/${scope}`, {
        method: 'PUT', body: JSON.stringify({ content: draft, expectedVersion: document?.version ?? null }),
      });
      const next = memoryDocumentResponseSchema.parse(payload).data;
      setDocuments((current) => [...current.filter((item) => item.scope !== scope), next].sort((left, right) => left.scope.localeCompare(right.scope)));
      setDraft(next.content);
      setRevisions([]);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function loadRevisions(): Promise<void> {
    setFailure(null);
    try {
      const payload = await requestCore(`memory/${scope}/revisions`, { method: 'GET' });
      setRevisions(memoryRevisionListResponseSchema.parse(payload).data);
    } catch (error) {
      setFailure(failureMessage(error));
    }
  }

  async function restore(revisionVersion: number): Promise<void> {
    if (!document) return;
    setFailure(null);
    try {
      const payload = await requestCore(`memory/${scope}/restore`, {
        method: 'POST', body: JSON.stringify({ expectedVersion: document.version, revisionVersion }),
      });
      const next = memoryDocumentResponseSchema.parse(payload).data;
      setDocuments((current) => [...current.filter((item) => item.scope !== scope), next].sort((left, right) => left.scope.localeCompare(right.scope)));
      setDraft(next.content);
      await loadRevisions();
    } catch (error) {
      setFailure(failureMessage(error));
    }
  }

  async function remove(): Promise<void> {
    if (!document || !window.confirm(`永久删除 ${scopeCopy[scope]} 记忆及其全部历史版本？此操作无法恢复。`)) return;
    setFailure(null);
    try {
      await requestCore(`memory/${scope}`, { method: 'DELETE', body: JSON.stringify({ expectedVersion: document.version }) });
      setDocuments((current) => current.filter((item) => item.scope !== scope));
      setDraft('');
      setRevisions([]);
    } catch (error) {
      setFailure(failureMessage(error));
    }
  }

  return (
    <section className="domain-workspace" aria-labelledby="memory-heading">
      <header className="domain-workspace__header">
        <p className="section-kicker">LOCAL MEMORY / AUDITABLE</p>
        <h1 id="memory-heading">Agent 本地记忆</h1>
        <p>记忆按领域分开保存。后台 Agent 可以自然更新它，但你始终可以查看、编辑、恢复旧版本，或永久删除整个领域记忆。</p>
      </header>

      <div className="memory-workspace">
        <nav aria-label="记忆范围" className="memory-scopes">
          {scopes.map((item) => <button key={item} aria-pressed={item === scope} disabled={isLoading} type="button" onClick={() => selectScope(item)}>切换记忆范围：{item}<small>{scopeCopy[item]}</small></button>)}
        </nav>
        <div className="domain-card memory-editor">
          <div className="memory-editor__heading"><div><p className="section-kicker">{scope}</p><h2>{document ? `${scope} · v${document.version}` : `${scope} · 尚未建立`}</h2></div><span>{isLoading ? '正在读取…' : '仅本机'}</span></div>
          <label htmlFor="memory-content">{scope} 记忆内容</label>
          <textarea disabled={isLoading} id="memory-content" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="用简洁的 Markdown 记录稳定、可复用的偏好或上下文。" />
          <div className="memory-editor__actions">
            <button disabled={isLoading || isSaving || draft.trim().length === 0} type="button" onClick={() => void save()}><Save aria-hidden="true" size={16} /> {isSaving ? '正在保存…' : '保存新版本'}</button>
            <button disabled={isLoading} type="button" onClick={() => void loadRevisions()}><History aria-hidden="true" size={16} /> 查看历史版本</button>
            <button disabled={isLoading || !document} type="button" onClick={() => void remove()}><Trash2 aria-hidden="true" size={16} /> 删除当前记忆</button>
          </div>
          {failure ? <p className="domain-form__error" role="alert">{failure}</p> : null}
          <p className="domain-result__boundary">SQLite 保存版本事实；MEMORY.md 是本地可读投影。</p>
        </div>
      </div>

      {revisions.length > 0 ? <section className="domain-card memory-history" aria-labelledby="memory-history-heading"><p className="section-kicker">REVISION HISTORY</p><h2 id="memory-history-heading">历史版本</h2><ul>{revisions.map((revision) => <li key={revision.version}><div><strong>v{revision.version}</strong><p>{revision.content}</p></div><button disabled={!document || revision.version === document.version} type="button" onClick={() => void restore(revision.version)}><RotateCcw aria-hidden="true" size={15} /> 恢复版本 {revision.version}</button></li>)}</ul></section> : null}
    </section>
  );
}
