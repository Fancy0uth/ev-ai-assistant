'use client';

import {
  eventResponseSchema,
  projectSnapshotResponseSchema,
  taskResponseSchema,
  type Event,
  type ProjectScope,
  type Task,
} from '@ev/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

type DetailState<T> =
  | { phase: 'loading'; id: string; requestKey: number }
  | { phase: 'ready'; id: string; requestKey: number; data: T }
  | { phase: 'notFound'; id: string; requestKey: number }
  | { phase: 'error'; id: string; requestKey: number; message: string };

interface ProjectSnapshot {
  scope: ProjectScope;
  files: Array<{ relativePath: 'PRD.md' | 'TECH_SPEC.md' | 'ARCHITECTURE.md' | 'TASKS.md'; content: string }>;
}

function messageFor(error: unknown, resource: 'Task' | 'Event' | '项目'): string {
  if (error instanceof CoreClientError) {
    if (resource === '项目' && error.status === 422 && error.code === 'PROJECT_ROOT_UNAVAILABLE') {
      return '项目根当前不可读/快照不可用，请检查本机目录后重试。';
    }
    return error.message;
  }
  return `${resource}详情暂时不可用，请稍后重试。`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof CoreClientError && error.status === 404;
}

function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof CoreClientError && error.status === 401 && error.code === 'AUTHENTICATION_REQUIRED';
}

function useEntityDetail<T>({
  id,
  path,
  resource,
  parse,
}: {
  id: string;
  path: string;
  resource: 'Task' | 'Event' | '项目';
  parse: (payload: unknown) => T;
}): { state: DetailState<T>; retry: () => void } {
  const { replace } = useRouter();
  const [state, setState] = useState<DetailState<T>>({ phase: 'loading', id, requestKey: 0 });
  const [retryKey, setRetryKey] = useState(0);
  const requestIdRef = useRef(0);
  const currentIdRef = useRef(id);

  useLayoutEffect(() => {
    currentIdRef.current = id;
  }, [id]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    void requestCore(path, { method: 'GET', cache: 'no-store', signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId || currentIdRef.current !== id) return;
        setState({ phase: 'ready', id, requestKey: retryKey, data: parse(payload) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId || currentIdRef.current !== id) return;
        if (isAuthenticationFailure(error)) {
          setState({ phase: 'loading', id, requestKey: retryKey });
          replace('/login');
          return;
        }
        if (isNotFound(error)) {
          setState({ phase: 'notFound', id, requestKey: retryKey });
          return;
        }
        setState({ phase: 'error', id, requestKey: retryKey, message: messageFor(error, resource) });
      });
    return () => {
      controller.abort();
      requestIdRef.current += 1;
    };
  }, [id, parse, path, replace, resource, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const visibleState = state.id === id && state.requestKey === retryKey
    ? state
    : { phase: 'loading', id, requestKey: retryKey } as DetailState<T>;
  return { state: visibleState, retry };
}

function DetailLoading({ resource }: { resource: string }) {
  return <section className="entity-detail entity-detail--loading" aria-busy="true" aria-label={`正在读取${resource}详情`}><span /><span /></section>;
}

function DetailNotFound({ resource, href }: { resource: string; href: string }) {
  return (
    <section className="entity-detail entity-detail--not-found">
      <p className="section-kicker">NOT FOUND</p>
      <h1>{resource}不存在或已不可访问</h1>
      <p>该路径中的资源不存在，或当前账号没有访问权限。</p>
      <Link href={href}>返回{resource}模块</Link>
    </section>
  );
}

function DetailError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <section className="entity-detail entity-detail--error" role="alert">
      <p>{message}</p>
      <button type="button" onClick={retry}>重试</button>
    </section>
  );
}

function taskFromPayload(payload: unknown): Task {
  return taskResponseSchema.parse(payload).data;
}

function eventFromPayload(payload: unknown): Event {
  return eventResponseSchema.parse(payload).data;
}

function projectFromPayload(payload: unknown): ProjectSnapshot {
  return projectSnapshotResponseSchema.parse(payload).data;
}

export function TaskDetailWorkspace({ id }: { id: string }) {
  const { state, retry } = useEntityDetail({ id, path: `tasks/${id}`, resource: 'Task', parse: taskFromPayload });
  if (state.phase === 'loading') return <DetailLoading resource="任务" />;
  if (state.phase === 'notFound') return <DetailNotFound href="/tasks" resource="任务" />;
  if (state.phase === 'error') return <DetailError message={state.message} retry={retry} />;
  const task = state.data;
  const scheduling = task.scheduling ?? null;
  return (
    <section className="entity-detail" aria-labelledby="task-detail-heading">
      <p className="section-kicker">TASK DETAIL</p>
      <h1 id="task-detail-heading">{task.title}</h1>
      <dl className="entity-detail__facts">
        <div><dt>领域</dt><dd>{task.area}</dd></div>
        <div><dt>优先级</dt><dd>{task.priority}</dd></div>
        <div><dt>状态</dt><dd>{task.status}</dd></div>
        <div><dt>目标日期</dt><dd>{task.targetDate ?? '未设置'}</dd></div>
        <div><dt>排程</dt><dd>{scheduling ? `${scheduling.durationMinutes} 分钟 · ${scheduling.earliestStartLocalTime ?? '不限'}–${scheduling.latestEndLocalTime ?? '不限'} · ${scheduling.isFixed ? '固定' : '可调整'}` : '未加入每日计划'}</dd></div>
        <div><dt>版本</dt><dd>v{task.version}</dd></div>
      </dl>
      <Link href="/tasks">返回任务模块</Link>
    </section>
  );
}

export function EventDetailWorkspace({ id }: { id: string }) {
  const { state, retry } = useEntityDetail({ id, path: `events/${id}`, resource: 'Event', parse: eventFromPayload });
  if (state.phase === 'loading') return <DetailLoading resource="日程" />;
  if (state.phase === 'notFound') return <DetailNotFound href="/schedule" resource="日程" />;
  if (state.phase === 'error') return <DetailError message={state.message} retry={retry} />;
  const event = state.data;
  return (
    <section className="entity-detail" aria-labelledby="event-detail-heading">
      <p className="section-kicker">EVENT DETAIL</p>
      <h1 id="event-detail-heading">{event.title}</h1>
      <dl className="entity-detail__facts">
        <div><dt>日期</dt><dd>{event.localDate}</dd></div>
        <div><dt>时间</dt><dd>{event.startLocalTime}–{event.endLocalTime}</dd></div>
        <div><dt>类型</dt><dd>{event.kind}</dd></div>
        <div><dt>固定安排</dt><dd>{event.isHard ? '是' : '否'}</dd></div>
        <div><dt>状态</dt><dd>{event.status}</dd></div>
        <div><dt>版本</dt><dd>v{event.version}</dd></div>
      </dl>
      <Link href="/schedule">返回日程模块</Link>
    </section>
  );
}

export function ProjectDetailWorkspace({ id }: { id: string }) {
  const { state, retry } = useEntityDetail({ id, path: `projects/${id}/snapshot`, resource: '项目', parse: projectFromPayload });
  if (state.phase === 'loading') return <DetailLoading resource="项目快照" />;
  if (state.phase === 'notFound') return <DetailNotFound href="/projects" resource="项目" />;
  if (state.phase === 'error') return <DetailError message={state.message} retry={retry} />;
  const snapshot = state.data;
  return (
    <section className="entity-detail" aria-labelledby="project-detail-heading">
      <p className="section-kicker">PROJECT SNAPSHOT</p>
      <h1 id="project-detail-heading">{snapshot.scope.label}</h1>
      <dl className="entity-detail__facts">
        <div><dt>本机项目目录</dt><dd>{snapshot.scope.rootPath}</dd></div>
        <div><dt>创建时间</dt><dd>{snapshot.scope.createdAt}</dd></div>
        <div><dt>更新时间</dt><dd>{snapshot.scope.updatedAt}</dd></div>
      </dl>
      <p>仅展示当前快照，不在 Web 中编辑文件。</p>
      {snapshot.files.length > 0 ? <ul className="entity-detail__files">{snapshot.files.map((file) => <li key={file.relativePath}><h2>{file.relativePath}</h2><pre>{file.content}</pre></li>)}</ul> : <p>当前快照没有 allowlisted 规划文件。</p>}
      <Link href="/projects">返回项目模块</Link>
    </section>
  );
}
