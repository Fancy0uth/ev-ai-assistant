'use client';

import type { Task, TaskStatus } from '@ev/contracts';
import { Check, Clock3, RotateCcw } from 'lucide-react';
import Link from 'next/link';

interface TaskListProps {
  tasks: Task[];
  updatingTaskId: string | null;
  onStatusChange: (task: Task, status: TaskStatus) => Promise<void>;
}

const areaCopy = { WORK: '开发', STUDY: '学习', LIFE: '生活' } as const;
const priorityCopy = { HIGH: '高', MEDIUM: '中', LOW: '低' } as const;

export function TaskList({ tasks, updatingTaskId, onStatusChange }: TaskListProps) {
  return (
    <section className="task-list-card" id="today-tasks" aria-labelledby="tasks-heading">
      <div className="task-list-card__header">
        <div>
          <p className="section-kicker">TODAY QUEUE</p>
          <h2 id="tasks-heading">今天的任务</h2>
        </div>
        <span>{tasks.length} 项</span>
      </div>

      {tasks.length === 0 ? (
        <div className="task-empty" role="status">
          <span aria-hidden="true">
            <Check size={22} />
          </span>
          <div>
            <h3>今天还没有任务</h3>
            <p>从上方写下一件真实要完成的事，状态面板会立即重新计算。</p>
          </div>
        </div>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => {
            const isDone = task.status === 'DONE';
            const isDeferred = task.status === 'DEFERRED';
            const isUpdating = updatingTaskId === task.id;
            return (
              <li className={isDone ? 'task-row task-row--done' : 'task-row'} key={task.id}>
                <label className="task-check-target">
                  <input
                    className="task-checkbox"
                    type="checkbox"
                    checked={isDone}
                    disabled={isUpdating}
                    aria-label={`${isDone ? '重新打开' : '完成'}任务：${task.title}`}
                    onChange={() => void onStatusChange(task, isDone ? 'OPEN' : 'DONE')}
                  />
                </label>
                <div className="task-row__content">
                  <div className="task-row__titleline">
                    <p>{task.title}</p>
                    <span className={`task-status task-status--${task.status.toLowerCase()}`}>
                      {isUpdating
                        ? '更新中'
                        : isDone
                          ? '已完成'
                          : isDeferred
                            ? '已推迟'
                            : task.status === 'IN_PROGRESS'
                              ? '进行中'
                              : '待处理'}
                    </span>
                  </div>
                  <div className="task-meta">
                    <span>{areaCopy[task.area]}</span>
                    <span>{priorityCopy[task.priority]}优先级</span>
                    <span>v{task.version}</span>
                  </div>
                  <Link
                    aria-label={`查看任务详情：${task.title}`}
                    className="task-module-link"
                    href={`/tasks/${task.id}`}
                  >
                    查看任务详情
                  </Link>
                </div>
                <button
                  className="task-secondary-action"
                  type="button"
                  disabled={isUpdating}
                  onClick={() =>
                    void onStatusChange(task, isDone || isDeferred ? 'OPEN' : 'DEFERRED')
                  }
                >
                  {isDone || isDeferred ? (
                    <RotateCcw aria-hidden="true" size={15} />
                  ) : (
                    <Clock3 aria-hidden="true" size={15} />
                  )}
                  {isDone || isDeferred ? '恢复' : '稍后'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
