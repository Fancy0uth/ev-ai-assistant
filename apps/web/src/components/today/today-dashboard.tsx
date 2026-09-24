'use client';

import {
  todaySnapshotSchema,
  type Task,
  type TaskStatus,
  type TodaySnapshot,
} from '@ev/contracts';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { millisecondsUntilShanghaiMidnight, todayInShanghai } from '@/lib/today-date';
import { AppShell } from '../shell/app-shell';
import { AgentPanel } from './agent-panel';
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
  const [date, setDate] = useState(initialDate);
  const dateRef = useRef(initialDate);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const pendingKeysRef = useRef(new Set<string>());
  const requestGeneration = useRef(0);
  const mounted = useRef(false);
  const savedAwaitingRefresh = useRef(false);

  const syncDate = useCallback((): string => {
    const currentDate = todayInShanghai();
    if (currentDate !== dateRef.current) {
      dateRef.current = currentDate;
      requestGeneration.current += 1;
      setDate(currentDate);
      setError(null);
    }
    return currentDate;
  }, []);

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

  const refresh = useCallback(async function refreshSnapshot(): Promise<boolean> {
    const requestedDate = syncDate();
    const generation = ++requestGeneration.current;
    setIsRefreshing(true);
    try {
      const payload = await requestCore(`today?date=${encodeURIComponent(requestedDate)}`, {
        method: 'GET',
      });
      if (!mounted.current || generation !== requestGeneration.current) return false;
      if (requestedDate !== todayInShanghai()) return refreshSnapshot();
      setSnapshot(todaySnapshotSchema.parse(payload).data);
      savedAwaitingRefresh.current = false;
      setError(null);
      return true;
    } catch (failure) {
      if (!mounted.current || generation !== requestGeneration.current) return false;
      if (requestedDate !== todayInShanghai()) return refreshSnapshot();
      if (failure instanceof CoreClientError && failure.status === 401) {
        handleFailure(failure);
      } else {
        setError(
          savedAwaitingRefresh.current
            ? `已保存，列表刷新失败。${errorMessage(failure)}；请重试读取，无需再次提交。`
            : errorMessage(failure),
        );
      }
      return false;
    } finally {
      if (mounted.current && generation === requestGeneration.current) setIsRefreshing(false);
    }
  }, [handleFailure, syncDate]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    let midnightTimer: number;
    const checkDate = (): void => {
      if (todayInShanghai() !== dateRef.current) void refresh();
      clearTimeout(midnightTimer);
      midnightTimer = window.setTimeout(checkDate, millisecondsUntilShanghaiMidnight());
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') checkDate();
    };
    checkDate();
    window.addEventListener('focus', checkDate);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      clearTimeout(midnightTimer);
      window.removeEventListener('focus', checkDate);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  function beginMutation(key: string): number | null {
    if (pendingKeysRef.current.has(key)) return null;
    pendingKeysRef.current.add(key);
    setPendingKeys(new Set(pendingKeysRef.current));
    setError(null);
    setIsRefreshing(false);
    return ++requestGeneration.current;
  }

  function finishMutation(key: string): void {
    pendingKeysRef.current.delete(key);
    if (mounted.current) setPendingKeys(new Set(pendingKeysRef.current));
  }

  async function createTask(draft: TaskDraft): Promise<boolean> {
    const targetDate = syncDate();
    const generation = beginMutation('create');
    if (generation === null) return false;
    try {
      await requestCore('tasks', {
        method: 'POST',
        body: JSON.stringify({ ...draft, targetDate }),
      });
      if (mounted.current) {
        savedAwaitingRefresh.current = true;
        void refresh();
      }
      // A committed write succeeds even if the subsequent read fails.
      return true;
    } catch (failure) {
      if (mounted.current && targetDate === todayInShanghai()) {
        requestGeneration.current += 1;
        setIsRefreshing(false);
        handleFailure(failure);
      }
      return false;
    } finally {
      finishMutation('create');
    }
  }

  async function updateTaskStatus(task: Task, status: TaskStatus): Promise<void> {
    const submittedDate = syncDate();
    const generation = beginMutation(task.id);
    if (generation === null) return;
    try {
      await requestCore(`tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: task.version, status }),
      });
      if (mounted.current) {
        savedAwaitingRefresh.current = true;
        void refresh();
      }
    } catch (failure) {
      if (mounted.current && submittedDate === todayInShanghai()) {
        requestGeneration.current += 1;
        setIsRefreshing(false);
        handleFailure(failure);
      }
    } finally {
      finishMutation(task.id);
    }
  }

  async function logout(): Promise<void> {
    const generation = beginMutation('logout');
    if (generation === null) return;
    try {
      await requestCore('auth/logout', { method: 'POST' });
      if (mounted.current) replace('/login');
    } catch (failure) {
      if (mounted.current && generation === requestGeneration.current) handleFailure(failure);
    } finally {
      finishMutation('logout');
    }
  }

  if (!snapshot && !error) {
    return (
      <AppShell
        agent={<DashboardSkeleton variant="agent" />}
        isLoggingOut={pendingKeys.has('logout')}
        onLogout={() => void logout()}
      >
        <DashboardSkeleton variant="canvas" />
      </AppShell>
    );
  }

  if (!snapshot) {
    return (
      <AppShell
        agent={<DashboardSkeleton variant="agent" />}
        isLoggingOut={pendingKeys.has('logout')}
        onLogout={() => void logout()}
      >
        <section className="dashboard-fatal" role="alert">
          <p className="section-kicker">LOCAL CORE ERROR</p>
          <h1>今天的数据暂时没有读到</h1>
          <p>{error}</p>
          <button type="button" disabled={isRefreshing} onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" size={16} /> {isRefreshing ? '正在读取…' : '重新连接'}
          </button>
        </section>
      </AppShell>
    );
  }

  const currentSnapshot = snapshot.date === date ? snapshot : null;

  return (
    <AppShell
      agent={currentSnapshot ? <AgentPanel snapshot={currentSnapshot} variant="desktop" /> : <DashboardSkeleton variant="agent" />}
      isLoggingOut={pendingKeys.has('logout')}
      onLogout={() => void logout()}
    >
      <header className="today-header" id="today-overview">
        <div>
          <p className="section-kicker">DAILY COMMAND CENTER / {date}</p>
          <h1>今天，从最重要的事开始。</h1>
          <p>任务、状态与 Agent 能力全部来自这台电脑上的真实数据。</p>
        </div>
        <div className="core-connection" role="status">
          <span aria-hidden="true" /> {isRefreshing ? '正在读取今天的数据' : error ? '数据需要刷新' : 'Core 已连接'}
        </div>
      </header>

      {error ? (
        <div className="dashboard-alert" role="alert">
          <p>{error}</p>
          <button type="button" disabled={isRefreshing} onClick={() => void refresh()}>
            {isRefreshing ? '正在读取…' : '重试'}
          </button>
        </div>
      ) : null}

      {currentSnapshot ? <StatusOverview snapshot={currentSnapshot} /> : null}
      <TaskComposer isPending={pendingKeys.has('create')} onCreate={createTask} />
      {currentSnapshot ? (
        <>
          <AgentPanel snapshot={currentSnapshot} variant="mobile" />
          <TaskList
            tasks={currentSnapshot.tasks}
            updatingTaskIds={pendingKeys}
            onStatusChange={updateTaskStatus}
          />
        </>
      ) : isRefreshing ? (
        <DashboardSkeleton variant="canvas" />
      ) : (
        <p role="status">今天的数据暂未读取，请重试。</p>
      )}
    </AppShell>
  );
}

function DashboardSkeleton({ variant }: { variant: 'canvas' | 'agent' }) {
  if (variant === 'agent') {
    return (
      <div className="agent-skeleton" aria-label="正在加载 Agent 状态" aria-busy="true">
        <span />
        <span />
        <span />
      </div>
    );
  }
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
