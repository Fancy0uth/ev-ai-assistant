'use client';

import type { TaskArea, TaskPriority, TaskSchedulingInput } from '@ev/contracts';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export interface TaskDraft {
  title: string;
  area: TaskArea;
  priority: TaskPriority;
  scheduling?: TaskSchedulingInput;
}

export type TaskCreationResult = 'saved' | 'failed';

interface TaskComposerProps {
  isPending: boolean;
  targetDate: string;
  onCreate: (draft: TaskDraft) => Promise<TaskCreationResult>;
}

type ValidationError = { field: 'title' | 'duration' | 'window'; message: string };

export function TaskComposer({ isPending, targetDate, onCreate }: TaskComposerProps) {
  const [title, setTitle] = useState('');
  const [area, setArea] = useState<TaskArea>('WORK');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [includeScheduling, setIncludeScheduling] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [earliestStartLocalTime, setEarliestStartLocalTime] = useState('');
  const [latestEndLocalTime, setLatestEndLocalTime] = useState('');
  const [isFixed, setIsFixed] = useState(false);
  const [validationError, setValidationError] = useState<ValidationError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setValidationError({ field: 'title', message: '请先写下任务内容' });
      return;
    }
    const minutes = Number(durationMinutes);
    if (includeScheduling && (!Number.isInteger(minutes) || minutes < 5 || minutes > 960)) {
      setValidationError({ field: 'duration', message: '预计时长必须是 5 到 960 分钟之间的整数' });
      return;
    }
    if (includeScheduling && earliestStartLocalTime && latestEndLocalTime && latestEndLocalTime <= earliestStartLocalTime) {
      setValidationError({ field: 'window', message: '最晚结束时间必须晚于最早开始时间' });
      return;
    }
    setValidationError(null);
    const draft: TaskDraft = {
      title: normalizedTitle,
      area,
      priority,
      ...(includeScheduling
        ? {
            scheduling: {
              durationMinutes: minutes,
              earliestStartLocalTime: earliestStartLocalTime || null,
              latestEndLocalTime: latestEndLocalTime || null,
              isFixed,
            },
          }
        : {}),
    };
    if ((await onCreate(draft)) === 'saved') {
      setTitle('');
      setIncludeScheduling(false);
      setDurationMinutes('60');
      setEarliestStartLocalTime('');
      setLatestEndLocalTime('');
      setIsFixed(false);
    }
  }

  return (
    <section className="task-composer-card" aria-labelledby="composer-heading">
      <div className="composer-copy">
        <p className="section-kicker">QUICK CAPTURE</p>
        <h2 id="composer-heading">把下一件事放进今天</h2>
      </div>
      <form className="task-composer" onSubmit={(event) => void submit(event)} noValidate>
        <div className="composer-title-field">
          <label htmlFor="new-task">新任务</label>
          <input
            id="new-task"
            value={title}
            maxLength={200}
            placeholder="例如：完成 Agent 路由设计"
            aria-invalid={validationError?.field === 'title' ? true : undefined}
            aria-describedby={validationError?.field === 'title' ? 'task-composer-error' : undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="composer-select-field">
          <label htmlFor="task-area">领域</label>
          <select id="task-area" value={area} onChange={(event) => setArea(event.target.value as TaskArea)}>
            <option value="WORK">开发</option>
            <option value="STUDY">学习</option>
            <option value="LIFE">生活</option>
          </select>
        </div>
        <div className="composer-select-field">
          <label htmlFor="task-priority">优先级</label>
          <select
            id="task-priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
          >
            <option value="LOW">低</option>
            <option value="MEDIUM">中</option>
            <option value="HIGH">高</option>
          </select>
        </div>
        <p className="task-composer__target-date">计划日期：{targetDate}</p>
        <label className="task-composer__scheduling-toggle">
          <input
            checked={includeScheduling}
            type="checkbox"
            onChange={(event) => setIncludeScheduling(event.target.checked)}
          />
          加入每日计划
        </label>
        {includeScheduling ? (
          <div className="task-composer__scheduling" aria-label="每日计划排程">
            <label>
              预计时长（分钟）
              <input
                aria-describedby={validationError?.field === 'duration' ? 'task-composer-error' : undefined}
                aria-invalid={validationError?.field === 'duration' ? true : undefined}
                max={960}
                min={5}
                type="number"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
              />
            </label>
            <label>
              最早开始时间
              <input
                aria-describedby={validationError?.field === 'window' ? 'task-composer-error' : undefined}
                type="time"
                value={earliestStartLocalTime}
                onChange={(event) => setEarliestStartLocalTime(event.target.value)}
              />
            </label>
            <label>
              最晚结束时间
              <input
                aria-describedby={validationError?.field === 'window' ? 'task-composer-error' : undefined}
                type="time"
                value={latestEndLocalTime}
                onChange={(event) => setLatestEndLocalTime(event.target.value)}
              />
            </label>
            <label className="task-composer__fixed-toggle">
              <input checked={isFixed} type="checkbox" onChange={(event) => setIsFixed(event.target.checked)} />
              固定安排
            </label>
          </div>
        ) : null}
        <button className="composer-submit" type="submit" disabled={isPending}>
          <Plus aria-hidden="true" size={17} />
          {isPending ? '正在保存…' : '添加到今天'}
        </button>
      </form>
      {validationError ? (
        <p className="composer-error" id="task-composer-error" role="alert">
          {validationError.message}
        </p>
      ) : null}
    </section>
  );
}
