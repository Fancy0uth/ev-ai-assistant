'use client';

import { taskListResponseSchema, type Task, type TaskArea, type TaskStatus } from '@ev/contracts';
import { type ReadonlyURLSearchParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { TaskFilters, type TaskDateFilter } from './task-filters';

const areas = ['WORK', 'STUDY', 'LIFE'] as const;
const statuses = ['OPEN', 'IN_PROGRESS', 'DONE', 'DEFERRED', 'CANCELLED'] as const;
const dateFilters = ['today', 'future', 'undated'] as const;

const areaLabels: Record<TaskArea, string> = {
  WORK: '工作',
  STUDY: '学习',
  LIFE: '生活',
};

const priorityLabels = { LOW: '低优先级', MEDIUM: '中优先级', HIGH: '高优先级' } as const;

const statusLabels: Record<TaskStatus, string> = {
  OPEN: '待开始',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  DEFERRED: '已延期',
  CANCELLED: '已取消',
};

interface TasksUrlState {
  page: number;
  area?: TaskArea | undefined;
  status?: TaskStatus | undefined;
  date?: TaskDateFilter | undefined;
}

type TaskPage = ReturnType<typeof taskListResponseSchema.parse>['data'];

type ViewState =
  | { requestKey: string; kind: 'ready'; page: TaskPage }
  | { requestKey: string; kind: 'error'; message: string };

function allowedValue<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && allowed.includes(value as T) ? (value as T) : undefined;
}

function parsedPage(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

function readUrlState(searchParams: ReadonlyURLSearchParams): TasksUrlState {
  return {
    page: parsedPage(searchParams.get('page')),
    area: allowedValue(searchParams.get('area'), areas),
    status: allowedValue(searchParams.get('status'), statuses),
    date: allowedValue(searchParams.get('date'), dateFilters),
  };
}

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(
    parts.filter((part) => ['year', 'month', 'day'].includes(part.type)).map((part) => [part.type, part.value]),
  );
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function coreQuery(filters: TasksUrlState): string {
  const query = new URLSearchParams({ page: String(filters.page), pageSize: '20' });
  if (filters.area) query.set('area', filters.area);
  if (filters.status) query.set('status', filters.status);

  const today = todayInShanghai();
  if (filters.date === 'today') query.set('targetDate', today);
  if (filters.date === 'future') {
    query.set('dateScope', 'FUTURE');
    query.set('referenceDate', today);
  }
  if (filters.date === 'undated') query.set('dateScope', 'UNDATED');
  return query.toString();
}

function tasksUrl(filters: TasksUrlState): string {
  const query = new URLSearchParams({ page: String(filters.page) });
  if (filters.area) query.set('area', filters.area);
  if (filters.status) query.set('status', filters.status);
  if (filters.date) query.set('date', filters.date);
  return `/tasks?${query.toString()}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof CoreClientError) return error.message;
  return '任务数据格式无法识别，请稍后重试';
}

export function TasksWorkspace() {
  const { push, replace } = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readUrlState(searchParams), [searchParams]);
  const requestKey = `${filters.page}|${filters.area ?? ''}|${filters.status ?? ''}|${filters.date ?? ''}`;
  const requestId = useRef(0);
  const [retryKey, setRetryKey] = useState(0);
  const [view, setView] = useState<ViewState | null>(null);
  const activeRequestKey = `${requestKey}|${retryKey}`;

  useEffect(() => {
    const controller = new AbortController();
    const currentRequestId = ++requestId.current;

    void requestCore(`tasks?${coreQuery(filters)}`, { method: 'GET', signal: controller.signal })
      .then((payload) => taskListResponseSchema.parse(payload).data)
      .then((page) => {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        setView({ requestKey: activeRequestKey, kind: 'ready', page });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        if (error instanceof CoreClientError && error.status === 401 && error.code === 'AUTHENTICATION_REQUIRED') {
          replace('/login');
          return;
        }
        setView({ requestKey: activeRequestKey, kind: 'error', message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [activeRequestKey, filters, replace]);

  const navigate = useCallback(
    (next: TasksUrlState) => {
      push(tasksUrl(next));
    },
    [push],
  );

  const changeFilters = useCallback(
    (next: Pick<TasksUrlState, 'area' | 'status' | 'date'>) => {
      navigate({ ...filters, ...next, page: 1 });
    },
    [filters, navigate],
  );

  if (!view || view.requestKey !== activeRequestKey) {
    return <TasksLoading />;
  }

  if (view.kind === 'error') {
    return (
      <section className="dashboard-fatal tasks-failure" role="alert">
        <p className="section-kicker">TASKS UNAVAILABLE</p>
        <h1>任务暂时无法读取</h1>
        <p>{view.message}</p>
        <button type="button" onClick={() => setRetryKey((key) => key + 1)}>
          重新加载
        </button>
      </section>
    );
  }

  const { items, pagination } = view.page;
  return (
    <section className="tasks-workspace" aria-labelledby="tasks-title">
      <header className="tasks-workspace__header">
        <div>
          <p className="section-kicker">TASKS / SERVER PAGINATION</p>
          <h1 id="tasks-title">任务工作台</h1>
          <p>在这里查看各领域的任务安排。筛选和页码会保留在浏览器地址中。</p>
        </div>
      </header>

      <TaskFilters area={filters.area} status={filters.status} date={filters.date} onChange={changeFilters} />

      {items.length === 0 ? (
        <section className="task-empty tasks-empty" role="status">
          <span aria-hidden="true">—</span>
          <div>
            <h2>没有匹配的任务</h2>
            <p>调整筛选条件，或稍后再试。</p>
          </div>
        </section>
      ) : (
        <>
          <p className="tasks-result-summary" aria-live="polite">
            共 {pagination.total} 项任务，第 {pagination.page} / {pagination.totalPages} 页
          </p>
          <ul className="tasks-readonly-list" aria-label="任务列表">
            {items.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </>
      )}

      <nav className="tasks-pagination" aria-label="任务分页">
        <button
          type="button"
          disabled={pagination.page <= 1}
          onClick={() => navigate({ ...filters, page: filters.page - 1 })}
        >
          上一页
        </button>
        <span aria-live="polite">第 {pagination.page} / {pagination.totalPages || 1} 页</span>
        <button
          type="button"
          disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
          onClick={() => navigate({ ...filters, page: filters.page + 1 })}
        >
          下一页
        </button>
      </nav>
    </section>
  );
}

function TasksLoading() {
  return (
    <section className="tasks-loading" aria-busy="true" aria-label="正在加载任务">
      <span />
      <span />
      <span />
    </section>
  );
}

function TaskRow({ task }: { task: Task }) {
  return (
    <li className="tasks-readonly-row">
      <h2>{task.title}</h2>
      <dl>
        <div>
          <dt>领域</dt>
          <dd>{areaLabels[task.area]}</dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>{priorityLabels[task.priority]}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{statusLabels[task.status]}</dd>
        </div>
        <div>
          <dt>目标日期</dt>
          <dd>{task.targetDate ? `目标日期：${task.targetDate}` : '未安排'}</dd>
        </div>
      </dl>
    </li>
  );
}
