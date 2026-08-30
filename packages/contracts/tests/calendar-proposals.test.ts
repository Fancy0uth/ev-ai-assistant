import { describe, expect, it } from 'vitest';
import {
  calendarRuleSchema,
  createProposalSchema,
  eventSchema,
  proposalDecisionSchema,
  proposalSchema,
  signalSchema,
  timeRequestSchema,
} from '../src/index';

const rule = {
  id: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c',
  termId: '4c9ca70a-f3cf-4c0c-ae9d-e2bb4eb3f5b3',
  title: '数据库系统',
  weekday: 1,
  startLocalTime: '08:00',
  endLocalTime: '09:40',
  weekStart: 1,
  weekEnd: 16,
  weekPattern: 'ODD_WEEKS',
  isHard: true,
  version: 1,
};

describe('calendar and proposal contracts', () => {
  it('accepts a bounded recurring course rule and rejects invalid local times', () => {
    expect(calendarRuleSchema.parse(rule)).toEqual(rule);
    expect(
      calendarRuleSchema.safeParse({ ...rule, endLocalTime: '08:00' }).success,
    ).toBe(false);
    expect(calendarRuleSchema.safeParse({ ...rule, weekday: 8 }).success).toBe(false);
    expect(calendarRuleSchema.safeParse({ ...rule, weekStart: 17 }).success).toBe(false);
  });

  it('requires a versioned, reviewable proposal before changes can materialize', () => {
    const proposal = {
      id: 'b502a238-10c6-4b7b-bd87-6981095ad4bd',
      kind: 'SCHEDULE',
      status: 'PENDING',
      source: 'COURSE_IMPORT',
      title: '导入数据库课程',
      changes: [{ operation: 'CREATE_CALENDAR_RULE', rule }],
      version: 1,
      createdAt: '2026-08-17T00:00:00.000Z',
      expiresAt: null,
    };

    expect(proposalSchema.parse(proposal)).toEqual(proposal);
    expect(
      createProposalSchema.safeParse({
        kind: 'SCHEDULE',
        source: 'DAILY_SCHEDULER',
        title: '今日安排',
        changes: [],
      }).success,
    ).toBe(false);
    expect(proposalDecisionSchema.parse({ version: 1, decision: 'ACCEPT' })).toEqual({
      version: 1,
      decision: 'ACCEPT',
    });
    expect(
      proposalDecisionSchema.safeParse({ version: 1, decision: 'ACCEPT', extra: true }).success,
    ).toBe(false);
  });

  it('keeps Course lineage on rules and defers recurrence expansion to a dedicated change', () => {
    const linkedRule = { ...rule, courseId: '00000000-0000-4000-8000-000000000099' };
    expect(calendarRuleSchema.parse(linkedRule)).toEqual(linkedRule);
    expect(createProposalSchema.safeParse({
      kind: 'SCHEDULE',
      source: 'COURSE_IMPORT',
      title: '确认后展开数据库系统',
      changes: [{ operation: 'EXPAND_CALENDAR_RULE', calendarRuleId: rule.id, expectedRuleVersion: 1 }],
    }).success).toBe(true);
  });

  it('keeps Event, Signal and TimeRequest distinct for the daily coordination loop', () => {
    const base = {
      id: 'c52c9b3e-65f4-45c1-8de9-3f10db3f4d1c',
      version: 1,
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    };

    expect(
      eventSchema.parse({
        ...base,
        calendarRuleId: null,
        title: '与导师开会',
        kind: 'MEETING',
        localDate: '2026-08-17',
        startLocalTime: '10:00',
        endLocalTime: '10:30',
        isHard: true,
        status: 'CONFIRMED',
      }).kind,
    ).toBe('MEETING');
    expect(
      eventSchema.safeParse({
        ...base,
        ownerId: '4c9ca70a-f3cf-4c0c-ae9d-e2bb4eb3f5b3',
        calendarRuleId: null,
        title: '不应暴露 Owner',
        kind: 'PERSONAL',
        localDate: '2026-08-17',
        startLocalTime: '10:00',
        endLocalTime: '10:30',
        isHard: false,
        status: 'CONFIRMED',
      }).success,
    ).toBe(false);
    expect(
      signalSchema.safeParse({
        ...base,
        localDate: '2026-08-17',
        kind: 'RECOVERY',
        value: 70,
        source: 'RULES',
      }).success,
    ).toBe(true);
    expect(
      timeRequestSchema.safeParse({
        ...base,
        source: 'FITNESS_AGENT',
        title: '力量训练',
        targetDate: '2026-08-17',
        durationMinutes: 60,
        priority: 'MEDIUM',
        earliestStartLocalTime: '18:00',
        latestEndLocalTime: '21:00',
        isFixed: false,
      }).success,
    ).toBe(true);
  });
});
