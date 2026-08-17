import { dailyPlanModelOutputSchema, type DailyPlanModelOutput } from '@ev/contracts';
import { describe, expect, it } from 'vitest';
import type { DailyPlanningPacket } from '../src/modules/daily-planning/context-service';
import {
  DailyPlanValidationError,
  validateDailyPlanOutput,
} from '../src/modules/daily-planning/validator';

const packet: DailyPlanningPacket = {
  baseScheduleVersion: 7,
  timeBlocks: [
    { startLocalTime: '09:00', endLocalTime: '10:00', isHard: true },
    { startLocalTime: '12:00', endLocalTime: '13:00', isHard: false },
  ],
  timeRequests: [
    {
      contextRef: 'TIME_REQUEST_1',
      timeRequestId: '00000000-0000-4000-8000-000000000421',
      timeRequestVersion: 3,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '10:00',
      latestEndLocalTime: '12:00',
      isFixed: false,
    },
    {
      contextRef: 'TIME_REQUEST_2',
      timeRequestId: '00000000-0000-4000-8000-000000000422',
      timeRequestVersion: 4,
      durationMinutes: 90,
      priority: 'MEDIUM',
      earliestStartLocalTime: null,
      latestEndLocalTime: null,
      isFixed: false,
    },
    {
      contextRef: 'TIME_REQUEST_3',
      timeRequestId: '00000000-0000-4000-8000-000000000423',
      timeRequestVersion: 5,
      durationMinutes: 900,
      priority: 'LOW',
      earliestStartLocalTime: null,
      latestEndLocalTime: null,
      isFixed: false,
    },
  ],
  recoveryLevel: 'READY',
};

function modelOutput(actions: DailyPlanModelOutput['actions']): DailyPlanModelOutput {
  return dailyPlanModelOutputSchema.parse({
    schemaVersion: 'DAILY_PLAN_MODEL_V1',
    summary: '已生成仅供审阅的日程建议。',
    actions,
  });
}

describe('daily plan model output validator', () => {
  it('converts valid scheduled and unschedulable actions into locally identified pending items', () => {
    const result = validateDailyPlanOutput(
      packet,
      modelOutput([
        {
          operation: 'SCHEDULE_TIME_REQUEST',
          contextRef: 'TIME_REQUEST_1',
          startLocalTime: '10:00',
          endLocalTime: '11:00',
          rationale: '在可用窗口内安排高优先级请求。',
        },
        {
          operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE',
          contextRef: 'TIME_REQUEST_2',
          reasonCode: 'INSUFFICIENT_TIME',
          rationale: '今日剩余时间不足以安排该请求。',
        },
      ]),
    );

    expect(result).toEqual([
      {
        ordinal: 1,
        status: 'PENDING_REVIEW',
        operation: 'SCHEDULE_TIME_REQUEST',
        timeRequestId: '00000000-0000-4000-8000-000000000421',
        timeRequestVersion: 3,
        startLocalTime: '10:00',
        endLocalTime: '11:00',
        reasonCode: null,
        rationale: '在可用窗口内安排高优先级请求。',
      },
      {
        ordinal: 2,
        status: 'PENDING_REVIEW',
        operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE',
        timeRequestId: '00000000-0000-4000-8000-000000000422',
        timeRequestVersion: 4,
        startLocalTime: null,
        endLocalTime: null,
        reasonCode: 'INSUFFICIENT_TIME',
        rationale: '今日剩余时间不足以安排该请求。',
      },
    ]);
    expect(result.every((item) => !('id' in item))).toBe(true);
  });

  it('rejects a model reference that is absent from the packet', () => {
    const unknownReference = modelOutput([
      {
        operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE',
        contextRef: 'TIME_REQUEST_99',
        reasonCode: 'CAPACITY_LIMIT',
        rationale: '该引用不存在于当前上下文。',
      },
    ]);

    expect(() => validateDailyPlanOutput(packet, unknownReference)).toThrow(DailyPlanValidationError);
  });

  it('rejects a scheduled duration that differs from the matched request', () => {
    const wrongDuration = modelOutput([
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_1',
        startLocalTime: '10:00',
        endLocalTime: '10:30',
        rationale: '时长不正确的建议。',
      },
    ]);

    expect(() => validateDailyPlanOutput(packet, wrongDuration)).toThrow(DailyPlanValidationError);
  });

  it('rejects starts before 05:00 and ends after 23:00', () => {
    const earlyStart = modelOutput([
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_2',
        startLocalTime: '04:59',
        endLocalTime: '06:29',
        rationale: '过早的建议。',
      },
    ]);
    const lateEnd = modelOutput([
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_2',
        startLocalTime: '21:32',
        endLocalTime: '23:02',
        rationale: '过晚的建议。',
      },
    ]);

    expect(() => validateDailyPlanOutput(packet, earlyStart)).toThrow(DailyPlanValidationError);
    expect(() => validateDailyPlanOutput(packet, lateEnd)).toThrow(DailyPlanValidationError);
  });

  it('rejects placements outside the matched request availability window', () => {
    const outsideAvailability = modelOutput([
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_1',
        startLocalTime: '11:30',
        endLocalTime: '12:30',
        rationale: '超出结束可用时间。',
      },
    ]);

    expect(() => validateDailyPlanOutput(packet, outsideAvailability)).toThrow(
      DailyPlanValidationError,
    );
  });

  it('rejects overlap with hard fixed blocks but permits overlap with soft blocks', () => {
    const overlapFixedBlock = modelOutput([
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_2',
        startLocalTime: '09:15',
        endLocalTime: '10:45',
        rationale: '与硬固定块冲突。',
      },
    ]);
    const overlapSoftBlock = modelOutput([
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_2',
        startLocalTime: '12:00',
        endLocalTime: '13:30',
        rationale: '软块仅用于模型偏好，不是本地拒绝条件。',
      },
    ]);

    expect(() => validateDailyPlanOutput(packet, overlapFixedBlock)).toThrow(DailyPlanValidationError);
    expect(validateDailyPlanOutput(packet, overlapSoftBlock)).toHaveLength(1);
  });

  it('rejects overlapping scheduled proposal items', () => {
    const overlappingScheduledItems = modelOutput([
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_1',
        startLocalTime: '10:00',
        endLocalTime: '11:00',
        rationale: '第一项安排。',
      },
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_2',
        startLocalTime: '10:30',
        endLocalTime: '12:00',
        rationale: '第二项与第一项重叠。',
      },
    ]);

    expect(() => validateDailyPlanOutput(packet, overlappingScheduledItems)).toThrow(
      DailyPlanValidationError,
    );
  });

  it('rejects aggregate scheduled duration over 960 minutes', () => {
    const over960Minutes = modelOutput([
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_2',
        startLocalTime: '05:00',
        endLocalTime: '06:30',
        rationale: '第一个有效时段。',
      },
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_3',
        startLocalTime: '06:30',
        endLocalTime: '21:30',
        rationale: '第二个时段使总时长超过上限。',
      },
    ]);

    expect(() => validateDailyPlanOutput(packet, over960Minutes)).toThrow(DailyPlanValidationError);
  });
});
