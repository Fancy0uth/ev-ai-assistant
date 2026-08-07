import { describe, expect, it } from 'vitest';
import { calculateDailyStatus, type DailyStatusTask } from '../src/daily-status';

function task(
  id: string,
  priority: DailyStatusTask['priority'],
  status: DailyStatusTask['status'] = 'OPEN',
): DailyStatusTask {
  return {
    id,
    title: `任务 ${id}`,
    area: 'WORK',
    priority,
    status,
  };
}

describe('calculateDailyStatus', () => {
  it('marks a day tight when several high-priority tasks remain', () => {
    const result = calculateDailyStatus({
      tasks: [task('1', 'HIGH'), task('2', 'HIGH'), task('3', 'HIGH')],
      yesterday: null,
    });

    expect(result).toMatchObject({
      score: 57,
      level: 'TIGHT',
      source: 'RULES_V1',
    });
    expect(result.reasons).toContain('仍有 3 个高优先级任务');
    expect(result.priorities.map(({ id }) => id)).toEqual(['1', '2', '3']);
  });

  it('adds the completion bonus and excludes completed work from priorities', () => {
    const result = calculateDailyStatus({
      tasks: [task('1', 'HIGH', 'DONE'), task('2', 'MEDIUM', 'DONE')],
      yesterday: { taskCompletion: 0.5, studyCompletion: 0.5 },
    });

    expect(result.score).toBe(90);
    expect(result.level).toBe('STEADY');
    expect(result.reasons).toContain('已完成 2/2 个任务');
    expect(result.priorities).toEqual([]);
  });

  it('caps high-priority pressure, applies the open-task penalty and orders priorities', () => {
    const result = calculateDailyStatus({
      tasks: [
        task('low', 'LOW'),
        task('medium', 'MEDIUM'),
        task('high-1', 'HIGH'),
        task('high-2', 'HIGH'),
        task('high-3', 'HIGH'),
        task('high-4', 'HIGH'),
        task('high-5', 'HIGH'),
      ],
      yesterday: null,
    });

    expect(result.score).toBe(46);
    expect(result.level).toBe('TIGHT');
    expect(result.reasons).toContain('待处理任务共 7 个，注意控制负载');
    expect(result.priorities.map(({ priority }) => priority)).toEqual([
      'HIGH',
      'HIGH',
      'HIGH',
    ]);
  });
});
