'use client';

import type { TaskArea, TaskStatus } from '@ev/contracts';

export type TaskDateFilter = 'today' | 'future' | 'undated';

interface TaskFiltersProps {
  area?: TaskArea | undefined;
  status?: TaskStatus | undefined;
  date?: TaskDateFilter | undefined;
  onChange: (next: {
    area?: TaskArea | undefined;
    status?: TaskStatus | undefined;
    date?: TaskDateFilter | undefined;
  }) => void;
}

export function TaskFilters({ area, status, date, onChange }: TaskFiltersProps) {
  return (
    <fieldset className="tasks-filters">
      <legend>筛选任务</legend>
      <label>
        领域筛选
        <select
          value={area ?? ''}
          onChange={(event) => onChange({ area: (event.target.value || undefined) as TaskArea | undefined })}
        >
          <option value="">全部领域</option>
          <option value="WORK">工作</option>
          <option value="STUDY">学习</option>
          <option value="LIFE">生活</option>
        </select>
      </label>

      <label>
        状态筛选
        <select
          value={status ?? ''}
          onChange={(event) =>
            onChange({ status: (event.target.value || undefined) as TaskStatus | undefined })
          }
        >
          <option value="">全部状态</option>
          <option value="OPEN">待开始</option>
          <option value="IN_PROGRESS">进行中</option>
          <option value="DONE">已完成</option>
          <option value="DEFERRED">已延期</option>
          <option value="CANCELLED">已取消</option>
        </select>
      </label>

      <label>
        目标日期筛选
        <select
          value={date ?? ''}
          onChange={(event) =>
            onChange({ date: (event.target.value || undefined) as TaskDateFilter | undefined })
          }
        >
          <option value="">全部日期</option>
          <option value="today">今天</option>
          <option value="future">未来</option>
          <option value="undated">未安排</option>
        </select>
      </label>
    </fieldset>
  );
}
