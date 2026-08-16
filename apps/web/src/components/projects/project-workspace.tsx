'use client';

import {
  projectScopeListResponseSchema,
  projectScopeResponseSchema,
  projectSnapshotResponseSchema,
  type ProjectScope,
} from '@ev/contracts';
import { FileSearch, FolderSearch, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '项目只读范围暂时未完成操作，请稍后重试。';
}

export function ProjectWorkspace() {
  const [scopes, setScopes] = useState<ProjectScope[]>([]);
  const [scopeId, setScopeId] = useState('');
  const [label, setLabel] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [snapshot, setSnapshot] = useState<ReturnType<typeof projectSnapshotResponseSchema.parse>['data'] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReading, setIsReading] = useState(false);

  useEffect(() => {
    void requestCore('projects', { method: 'GET' })
      .then((payload) => {
        const loaded = projectScopeListResponseSchema.parse(payload).data;
        setScopes(loaded);
        setScopeId(loaded[0]?.id ?? '');
      })
      .catch((error: unknown) => setFailure(failureMessage(error)))
      .finally(() => setIsLoading(false));
  }, []);

  async function createScope(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setIsSaving(true);
    try {
      const payload = await requestCore('projects', { method: 'POST', body: JSON.stringify({ label, rootPath }) });
      const scope = projectScopeResponseSchema.parse(payload).data;
      setScopes((current) => [...current, scope]);
      setScopeId(scope.id);
      setLabel('');
      setRootPath('');
      setSnapshot(null);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function readSnapshot(): Promise<void> {
    if (!scopeId) return;
    setFailure(null);
    setIsReading(true);
    try {
      const payload = await requestCore(`projects/${scopeId}/snapshot`, { method: 'GET' });
      setSnapshot(projectSnapshotResponseSchema.parse(payload).data);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsReading(false);
    }
  }

  return (
    <section className="domain-workspace" aria-labelledby="projects-heading">
      <header className="domain-workspace__header">
        <p className="section-kicker">PROJECT / READ-ONLY CONTEXT</p>
        <h1 id="projects-heading">项目与工作流</h1>
        <p>先登记项目目录，再读取有限的规划上下文。后续本地 Codex 只能在该只读快照基础上提出下一步建议。</p>
      </header>

      <div className="domain-workspace__grid">
        <form className="domain-card domain-form" onSubmit={(event) => void createScope(event)}>
          <div className="domain-card__heading"><FolderSearch aria-hidden="true" size={19} /><div><h2>登记只读项目范围</h2><p>路径只保存在这台电脑的本地数据库。</p></div></div>
          <label>项目名称<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label>本机项目目录<input value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="例如：D:\\projects\\my-repo" /></label>
          <button disabled={isSaving} type="submit"><Save aria-hidden="true" size={16} /> {isSaving ? '正在登记…' : '登记只读项目范围'}</button>
          {isLoading ? <p className="domain-form__hint">正在读取已登记项目…</p> : null}
        </form>

        <aside className="domain-card course-profile">
          <p className="section-kicker">PROJECT SCOPE</p>
          {scopes.length === 0 ? <><h2>还没有项目范围</h2><p>登记后才能让本地 Agent 看见经过限制的规划文件。</p></> : <>
            <h2>选择项目</h2>
            <ul className="course-list">{scopes.map((scope) => <li key={scope.id}><button aria-pressed={scope.id === scopeId} type="button" onClick={() => { setScopeId(scope.id); setSnapshot(null); }}>选择项目：{scope.label}</button></li>)}</ul>
            <button className="project-read-button" disabled={!scopeId || isReading} type="button" onClick={() => void readSnapshot()}><FileSearch aria-hidden="true" size={16} /> {isReading ? '正在读取…' : '读取只读规划快照'}</button>
          </>}
        </aside>
      </div>

      {failure ? <p className="domain-form__error domain-workspace__error" role="alert">{failure}</p> : null}
      {snapshot ? <section className="domain-card project-snapshot"><p className="section-kicker">READ-ONLY SNAPSHOT</p><h2>{snapshot.scope.label}</h2><p>本页不会执行命令、修改文件、提交 Git 或读取 .env。</p>{snapshot.files.length > 0 ? <ul>{snapshot.files.map((file) => <li key={file.relativePath}><h3>{file.relativePath}</h3><pre>{file.content}</pre></li>)}</ul> : <p>该目录中没有可读取的规划文件。</p>}</section> : null}
    </section>
  );
}
