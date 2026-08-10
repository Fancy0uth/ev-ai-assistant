'use client';

import type { Task } from '@ev/contracts';
import { useRef, useState } from 'react';

export function TaskActions({
  task,
  isPending,
  onComplete,
  onDefer,
  onCancel,
}: {
  task: Task;
  isPending: boolean;
  onComplete: (task: Task) => Promise<boolean>;
  onDefer: (task: Task, targetDate: string | null) => Promise<boolean>;
  onCancel: (task: Task) => Promise<boolean>;
}) {
  const [isDeferring, setIsDeferring] = useState(false);
  const [targetDate, setTargetDate] = useState(task.targetDate ?? '');
  const targetDateRef = useRef<HTMLInputElement>(null);

  function openDeferredDate(): void {
    setTargetDate(task.targetDate ?? '');
    setIsDeferring(true);
    queueMicrotask(() => targetDateRef.current?.focus());
  }

  async function defer(): Promise<void> {
    if (await onDefer(task, targetDate || null)) setIsDeferring(false);
  }

  return (
    <div className="task-actions" aria-label={`任务操作：${task.title}`}>
      <button
        type="button"
        disabled={isPending}
        aria-label={`完成任务：${task.title}`}
        onClick={() => void onComplete(task)}
      >
        完成
      </button>
      <button
        type="button"
        disabled={isPending}
        aria-label={`延期任务：${task.title}`}
        onClick={openDeferredDate}
      >
        延期
      </button>
      <button
        type="button"
        disabled={isPending}
        aria-label={`取消任务：${task.title}`}
        onClick={() => void onCancel(task)}
      >
        取消
      </button>
      {isDeferring ? (
        <div className="task-defer-control">
          <label>
            延期目标日期
            <input
              ref={targetDateRef}
              type="date"
              value={targetDate}
              disabled={isPending}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </label>
          <button type="button" disabled={isPending} onClick={() => void defer()}>
            确认延期
          </button>
        </div>
      ) : null}
    </div>
  );
}
