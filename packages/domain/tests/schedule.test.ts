import { describe, expect, it } from 'vitest';
import { detectConflicts, expandCalendarRule } from '../src/schedule';

describe('expandCalendarRule', () => {
  it('materializes only the requested odd teaching weeks as local dates', () => {
    const occurrences = expandCalendarRule({
      ruleId: 'rule-database',
      termWeekOneMonday: '2026-09-07',
      weekday: 1,
      startLocalTime: '08:00',
      endLocalTime: '09:40',
      weekStart: 1,
      weekEnd: 5,
      weekPattern: 'ODD_WEEKS',
    });

    expect(occurrences.map((occurrence) => occurrence.localDate)).toEqual([
      '2026-09-07',
      '2026-09-21',
      '2026-10-05',
    ]);
    expect(occurrences.every((occurrence) => occurrence.ruleId === 'rule-database')).toBe(true);
  });

  it('rejects an out-of-range weekday before calculating dates', () => {
    expect(() =>
      expandCalendarRule({
        ruleId: 'invalid-weekday',
        termWeekOneMonday: '2026-09-07',
        weekday: 8,
        startLocalTime: '08:00',
        endLocalTime: '09:40',
        weekStart: 1,
        weekEnd: 1,
        weekPattern: 'EVERY_WEEK',
      }),
    ).toThrow('weekday must be an integer between 1 and 7');
  });
});

describe('detectConflicts', () => {
  it('does not mark adjacent time blocks as conflicts but returns a hard-event overlap', () => {
    const conflicts = detectConflicts([
      {
        id: 'course',
        localDate: '2026-09-07',
        startLocalTime: '08:00',
        endLocalTime: '09:40',
        isHard: true,
      },
      {
        id: 'work-block',
        localDate: '2026-09-07',
        startLocalTime: '09:40',
        endLocalTime: '10:40',
        isHard: false,
      },
      {
        id: 'meeting',
        localDate: '2026-09-07',
        startLocalTime: '09:00',
        endLocalTime: '10:00',
        isHard: true,
      },
    ]);

    expect(conflicts).toEqual([
      { firstEventId: 'course', secondEventId: 'meeting', hasHardEvent: true },
      { firstEventId: 'work-block', secondEventId: 'meeting', hasHardEvent: true },
    ]);
  });
});
