export type TeachingWeekPattern = 'EVERY_WEEK' | 'ODD_WEEKS' | 'EVEN_WEEKS';

export interface CalendarRuleExpansionInput {
  ruleId: string;
  termWeekOneMonday: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startLocalTime: string;
  endLocalTime: string;
  weekStart: number;
  weekEnd: number;
  weekPattern: TeachingWeekPattern;
}

export interface CalendarOccurrence {
  ruleId: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  teachingWeek: number;
}

export interface LocalTimeBlock {
  id: string;
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  isHard: boolean;
}

export interface TimeBlockConflict {
  firstEventId: string;
  secondEventId: string;
  hasHardEvent: boolean;
}

function localDateAfterDays(localDate: string, days: number): string {
  const start = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new RangeError('termWeekOneMonday must be an ISO date');
  start.setUTCDate(start.getUTCDate() + days);
  return start.toISOString().slice(0, 10);
}

function shouldIncludeWeek(week: number, pattern: TeachingWeekPattern): boolean {
  return (
    pattern === 'EVERY_WEEK' ||
    (pattern === 'ODD_WEEKS' && week % 2 === 1) ||
    (pattern === 'EVEN_WEEKS' && week % 2 === 0)
  );
}

function minuteOfDay(localTime: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!match) throw new RangeError('local time must use HH:mm');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new RangeError('local time is out of range');
  return hour * 60 + minute;
}

export function expandCalendarRule(input: CalendarRuleExpansionInput): CalendarOccurrence[] {
  if (!Number.isInteger(input.weekStart) || !Number.isInteger(input.weekEnd) || input.weekStart < 1) {
    throw new RangeError('teaching weeks must be positive integers');
  }
  if (input.weekEnd < input.weekStart) throw new RangeError('weekEnd must not precede weekStart');
  if (minuteOfDay(input.startLocalTime) >= minuteOfDay(input.endLocalTime)) {
    throw new RangeError('event start must precede event end');
  }

  const occurrences: CalendarOccurrence[] = [];
  for (let teachingWeek = input.weekStart; teachingWeek <= input.weekEnd; teachingWeek += 1) {
    if (!shouldIncludeWeek(teachingWeek, input.weekPattern)) continue;
    occurrences.push({
      ruleId: input.ruleId,
      localDate: localDateAfterDays(
        input.termWeekOneMonday,
        (teachingWeek - 1) * 7 + (input.weekday - 1),
      ),
      startLocalTime: input.startLocalTime,
      endLocalTime: input.endLocalTime,
      teachingWeek,
    });
  }
  return occurrences;
}

function overlaps(first: LocalTimeBlock, second: LocalTimeBlock): boolean {
  if (first.localDate !== second.localDate) return false;
  return (
    minuteOfDay(first.startLocalTime) < minuteOfDay(second.endLocalTime) &&
    minuteOfDay(second.startLocalTime) < minuteOfDay(first.endLocalTime)
  );
}

export function detectConflicts(events: readonly LocalTimeBlock[]): TimeBlockConflict[] {
  const conflicts: TimeBlockConflict[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const first = events[index];
    if (!first) continue;
    for (let otherIndex = index + 1; otherIndex < events.length; otherIndex += 1) {
      const second = events[otherIndex];
      if (!second || !overlaps(first, second)) continue;
      conflicts.push({
        firstEventId: first.id,
        secondEventId: second.id,
        hasHardEvent: first.isHard || second.isHard,
      });
    }
  }
  return conflicts;
}
