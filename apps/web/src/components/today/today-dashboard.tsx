'use client';

import {
  todaySnapshotSchema,
  type Task,
  type TaskStatus,
  type TodaySnapshot,
} from '@ev/contracts';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { StatusOverview } from './status-overview';
import { TaskComposer, type TaskDraft } from './task-composer';
import { TaskList } from './task-list';

interface TodayDashboardProps {
  initialDate: string;
}

type Snapshot = TodaySnapshot['data'];

function errorMessage(error: unknown): string {
  if (error instanceof CoreClientError) return error.message;
  return 'Dashboard 暂时无法读取本地数据，请稍后重试';
}

export function TodayDashboard({ initialDate }: TodayDashboardProps) {
  const { replace } = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);

  const handleFailure = useCallback(
    (failure: unknown): void => {
      if (failure instanceof CoreClientError && failure.status === 401) {
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

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const nextSnapshot = await loadSnapshot();
      setSnapshot(nextSnapshot);
      setError(null);
      return true;
    } catch (failure) {
      handleFailure(failure);
      return false;
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

  async function createTask(draft: TaskDraft): Promise<boolean> {
    setMutationKey('create');
    setError(null);
    try {
      await requestCore('tasks', {
        method: 'POST',
        body: JSON.stringify({ ...draft, targetDate: initialDate }),
      });
      return await refresh();
    } catch (failure) {
      handleFailure(failure);
      return false;
    } finally {
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
          <h1>今天，从最重要的事开始。</h1>
          <p>任务、状态与 Agent 能力全部来自这台电脑上的真实数据。</p>
        </div>
        <div className="core-connection" role="status">
          <span aria-hidden="true" /> Core 已连接
        </div>
      </header>

      {error ? (
        <div className="dashboard-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : null}

      <StatusOverview snapshot={snapshot} />
      <TaskComposer isPending={mutationKey === 'create'} onCreate={createTask} />
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
