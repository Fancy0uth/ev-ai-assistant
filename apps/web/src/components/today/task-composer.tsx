'use client';

import type { TaskArea, TaskPriority } from '@ev/contracts';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export interface TaskDraft {
  title: string;
  area: TaskArea;
  priority: TaskPriority;
}

interface TaskComposerProps {
  isPending: boolean;
  onCreate: (draft: TaskDraft) => Promise<boolean>;
}

export function TaskComposer({ isPending, onCreate }: TaskComposerProps) {
  const [title, setTitle] = useState('');
  const [area, setArea] = useState<TaskArea>('WORK');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [validationError, setValidationError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setValidationError('请先写下任务内容');
      return;
    }
    setValidationError(null);
    if (await onCreate({ title: normalizedTitle, area, priority })) setTitle('');
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
            aria-invalid={validationError ? true : undefined}
            aria-describedby={validationError ? 'task-composer-error' : undefined}
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
        <button className="composer-submit" type="submit" disabled={isPending}>
          <Plus aria-hidden="true" size={17} />
          {isPending ? '正在保存…' : '添加到今天'}
        </button>
      </form>
      {validationError ? (
        <p className="composer-error" id="task-composer-error" role="alert">
          {validationError}
        </p>
      ) : null}
    </section>
  );
}
