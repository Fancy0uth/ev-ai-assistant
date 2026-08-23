'use client';

import {
  taskResponseSchema,
  todaySnapshotSchema,
  type Task,
  type TaskStatus,
  type TodaySnapshot,
} from '@ev/contracts';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { createIdempotencyKey } from '@/lib/idempotency-key';
import { StatusOverview } from './status-overview';
import { DayConsole } from './day-console';
import { DailyPlanStatusCard } from './daily-plan-status-card';
import { ModuleQuickLinks } from './module-quick-links';
import { TaskComposer, type TaskCreationResult, type TaskDraft } from './task-composer';
import { TaskList } from './task-list';

interface TodayDashboardProps {
  initialDate: string;
}

type Snapshot = TodaySnapshot['data'];
type RefreshFailureMode = 'standard' | 'after-create';

function errorMessage(error: unknown): string {
  if (error instanceof CoreClientError) return error.message;
  return 'Dashboard 暂时无法读取本地数据，请稍后重试';
}

function isCanonicalAuthenticationError(error: unknown): boolean {
  return (
    error instanceof CoreClientError &&
    error.status === 401 &&
    error.code === 'AUTHENTICATION_REQUIRED'
  );
}

export function TodayDashboard({ initialDate }: TodayDashboardProps) {
  const { replace } = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const createInFlight = useRef(false);

  const handleFailure = useCallback(
    (failure: unknown): void => {
      if (isCanonicalAuthenticationError(failure)) {
        replace('/login');
        return;
      }
      setError(errorMessage(failure));
    },
    [replace],
  );

  const loadSnapshot = useCallback(async (): Promise<Snapshot> => {
    const payload = await requestCore(`today?date=${encodeURIComponent(initialDate)}`, {
      method: 'GET',
    });
    return todaySnapshotSchema.parse(payload).data;
  }, [initialDate]);

  const refresh = useCallback(async (failureMode: RefreshFailureMode = 'standard'): Promise<boolean> => {
    setIsRefreshing(true);
    try {
      const nextSnapshot = await loadSnapshot();
      setSnapshot(nextSnapshot);
      setError(null);
      setRefreshWarning(null);
      return true;
    } catch (failure) {
      if (failureMode === 'after-create' && !isCanonicalAuthenticationError(failure)) {
        setRefreshWarning('任务已保存，但今天的数据刷新失败');
        return false;
      }
      handleFailure(failure);
      return false;
    } finally {
      setIsRefreshing(false);
    }
  }, [handleFailure, loadSnapshot]);

  useEffect(() => {
    let isActive = true;
    void loadSnapshot()
      .then((nextSnapshot) => {
        if (!isActive) return;
        setSnapshot(nextSnapshot);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (isActive) handleFailure(failure);
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [handleFailure, loadSnapshot]);

  async function createTask(draft: TaskDraft): Promise<TaskCreationResult> {
    if (createInFlight.current) return 'failed';
    createInFlight.current = true;
    setMutationKey('create');
    setError(null);
    try {
      const payload = await requestCore('tasks', {
        method: 'POST',
        body: JSON.stringify({ ...draft, targetDate: initialDate }),
      });
      taskResponseSchema.parse(payload);
      void refresh('after-create');
      return 'saved';
    } catch (failure) {
      handleFailure(failure);
      return 'failed';
    } finally {
      createInFlight.current = false;
      setMutationKey(null);
    }
  }

  async function updateTaskStatus(task: Task, status: TaskStatus): Promise<void> {
    setMutationKey(task.id);
    setError(null);
    try {
      await requestCore(`tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: task.version, status }),
      });
      await refresh();
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setMutationKey(null);
    }
  }

  async function decideProposal(proposalId: string, input: { version: number; decision: 'ACCEPT' | 'REJECT' }): Promise<void> {
    setMutationKey(proposalId);
    setError(null);
    try {
      await requestCore(`proposals/${proposalId}/decision`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': createIdempotencyKey() },
      });
      await refresh();
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setMutationKey(null);
    }
  }

  if (isLoading || (!snapshot && !error)) {
    return <DashboardSkeleton />;
  }

  if (!snapshot) {
    return (
      <section className="dashboard-fatal" role="alert">
        <p className="section-kicker">LOCAL CORE ERROR</p>
        <h1>今天的数据暂时没有读到</h1>
        <p>{error}</p>
        <button type="button" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" size={16} /> 重新连接
        </button>
      </section>
    );
  }

  return (
    <>
      <header className="today-header">
        <div>
          <p className="section-kicker">DAILY COMMAND CENTER / {snapshot.date}</p>
          <h1>今天的控制台</h1>
          <p>先看今天已确认的时间，再处理具体行动；AI 只能生成等待你审核的计划草案。</p>
        </div>
        <div className="core-connection" role="status" aria-busy={isRefreshing}>
          <span aria-hidden="true" /> {isRefreshing ? '正在刷新今天的数据' : 'Core 已连接'}
        </div>
      </header>

      {refreshWarning ? (
        <div className="dashboard-alert" role="alert">
          <p>{refreshWarning}</p>
          <button type="button" onClick={() => void refresh('after-create')}>
            重新加载今天的数据
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="dashboard-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : null}

      <DayConsole snapshot={snapshot} decidingProposalId={mutationKey} onDecision={decideProposal} />
      <DailyPlanStatusCard date={snapshot.date} dailyPlan={snapshot.dailyPlan} />
      <StatusOverview snapshot={snapshot} />
      <ModuleQuickLinks />
      <TaskComposer isPending={mutationKey === 'create'} targetDate={initialDate} onCreate={createTask} />
      <TaskList
        tasks={snapshot.tasks}
        updatingTaskId={mutationKey}
        onStatusChange={updateTaskStatus}
      />
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="canvas-skeleton" aria-label="正在加载今天的 Dashboard" aria-busy="true">
      <span className="canvas-skeleton__title" />
      <div>
        <span />
        <span />
        <span />
      </div>
      <span className="canvas-skeleton__composer" />
      <span className="canvas-skeleton__list" />
    </div>
  );
}
