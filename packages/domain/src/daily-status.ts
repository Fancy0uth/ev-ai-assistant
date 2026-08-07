export type DailyTaskArea = 'WORK' | 'STUDY' | 'LIFE';
export type DailyTaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type DailyTaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'DEFERRED' | 'CANCELLED';
export type DailyStatusLevel = 'STEADY' | 'TIGHT' | 'OVERLOADED';

export interface DailyStatusTask {
  id: string;
  title: string;
  area: DailyTaskArea;
  priority: DailyTaskPriority;
  status: DailyTaskStatus;
}

export interface YesterdaySummary {
  taskCompletion: number;
  studyCompletion: number;
}

export interface DailyStatusInput {
  tasks: readonly DailyStatusTask[];
  yesterday: YesterdaySummary | null;
}

export interface DailyStatus {
  score: number;
  level: DailyStatusLevel;
  source: 'RULES_V1';
  reasons: string[];
  priorities: DailyStatusTask[];
}

const priorityRank: Record<DailyTaskPriority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

function isRemaining(task: DailyStatusTask): boolean {
  return task.status !== 'DONE' && task.status !== 'CANCELLED';
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score));
}

function levelForScore(score: number): DailyStatusLevel {
  if (score >= 70) return 'STEADY';
  if (score >= 45) return 'TIGHT';
  return 'OVERLOADED';
}

export function calculateDailyStatus(input: DailyStatusInput): DailyStatus {
  const actionableTasks = input.tasks.filter((task) => task.status !== 'CANCELLED');
  const remainingTasks = actionableTasks.filter(isRemaining);
  const completedCount = actionableTasks.filter((task) => task.status === 'DONE').length;
  const completionRatio =
    actionableTasks.length === 0 ? 0 : completedCount / actionableTasks.length;
  const highPriorityCount = remainingTasks.filter((task) => task.priority === 'HIGH').length;

  const completionBonus = Math.round(completionRatio * 12);
  const highPriorityPenalty = Math.min(28, highPriorityCount * 7);
  const openTaskPenalty = remainingTasks.length > 6 ? 4 : 0;
  const score = clampScore(78 + completionBonus - highPriorityPenalty - openTaskPenalty);

  const reasons: string[] = [];
  if (highPriorityCount > 0) {
    reasons.push(`仍有 ${highPriorityCount} 个高优先级任务`);
  }
  if (remainingTasks.length > 6) {
    reasons.push(`待处理任务共 ${remainingTasks.length} 个，注意控制负载`);
  }
  if (completedCount > 0) {
    reasons.push(`已完成 ${completedCount}/${actionableTasks.length} 个任务`);
  }
  if (reasons.length === 0) {
    reasons.push(
      remainingTasks.length === 0
        ? '今天没有待处理任务'
        : `今天有 ${remainingTasks.length} 个待处理任务，负载可控`,
    );
  }

  const priorities = [...remainingTasks]
    .sort(
      (left, right) =>
        priorityRank[left.priority] - priorityRank[right.priority] ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 3)
    .map(({ id, title, area, priority, status }) => ({
      id,
      title,
      area,
      priority,
      status,
    }));

  return {
    score,
    level: levelForScore(score),
    source: 'RULES_V1',
    reasons: reasons.slice(0, 3),
    priorities,
  };
}
