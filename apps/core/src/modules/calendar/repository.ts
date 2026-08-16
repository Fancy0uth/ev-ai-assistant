import type { CalendarRule, Event, Signal, Term, TimeRequest } from '@ev/contracts';
import type Database from 'better-sqlite3';

export interface NewTerm extends Term {
  ownerId: string;
}

export interface NewCalendarRule extends CalendarRule {
  ownerId: string;
}

export interface NewEvent extends Event {
  ownerId: string;
}

export interface NewTimeRequest extends TimeRequest {
  ownerId: string;
}

export interface NewSignal extends Signal {
  ownerId: string;
}

interface TermRow {
  id: string;
  title: string;
  timezone: string;
  week_one_monday: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CalendarRuleRow {
  id: string;
  term_id: string;
  title: string;
  weekday: number;
  start_local_time: string;
  end_local_time: string;
  week_start: number;
  week_end: number;
  week_pattern: CalendarRule['weekPattern'];
  is_hard: number;
  version: number;
}

interface EventRow {
  id: string;
  calendar_rule_id: string | null;
  title: string;
  kind: Event['kind'];
  local_date: string;
  start_local_time: string;
  end_local_time: string;
  is_hard: number;
  status: Event['status'];
  version: number;
  created_at: string;
  updated_at: string;
}

interface TimeRequestRow {
  id: string;
  source: TimeRequest['source'];
  title: string;
  target_date: string;
  duration_minutes: number;
  priority: TimeRequest['priority'];
  earliest_start_local_time: string | null;
  latest_end_local_time: string | null;
  is_fixed: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SignalRow {
  id: string;
  local_date: string;
  kind: Signal['kind'];
  value: number;
  source: Signal['source'];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarRepository {
  createTerm(term: NewTerm): Term;
  findTerm(ownerId: string, termId: string): Term | undefined;
  listTerms(ownerId: string): Term[];
  createRule(rule: NewCalendarRule): CalendarRule;
  createEvent(event: NewEvent): Event;
  listEventsForDate(ownerId: string, localDate: string): Event[];
  createTimeRequest(request: NewTimeRequest): TimeRequest;
  listTimeRequestsForDate(ownerId: string, localDate: string): TimeRequest[];
  createSignal(signal: NewSignal): Signal;
}

function toTerm(row: TermRow): Term {
  return {
    id: row.id,
    title: row.title,
    timezone: row.timezone,
    weekOneMonday: row.week_one_monday,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRule(row: CalendarRuleRow): CalendarRule {
  return {
    id: row.id,
    termId: row.term_id,
    title: row.title,
    weekday: row.weekday,
    startLocalTime: row.start_local_time,
    endLocalTime: row.end_local_time,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    weekPattern: row.week_pattern,
    isHard: row.is_hard === 1,
    version: row.version,
  };
}

function toEvent(row: EventRow): Event {
  return {
    id: row.id,
    calendarRuleId: row.calendar_rule_id,
    title: row.title,
    kind: row.kind,
    localDate: row.local_date,
    startLocalTime: row.start_local_time,
    endLocalTime: row.end_local_time,
    isHard: row.is_hard === 1,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTimeRequest(row: TimeRequestRow): TimeRequest {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    targetDate: row.target_date,
    durationMinutes: row.duration_minutes,
    priority: row.priority,
    earliestStartLocalTime: row.earliest_start_local_time,
    latestEndLocalTime: row.latest_end_local_time,
    isFixed: row.is_fixed === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSignal(row: SignalRow): Signal {
  return {
    id: row.id,
    localDate: row.local_date,
    kind: row.kind,
    value: row.value,
    source: row.source,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const termColumns = `
  id, title, timezone, week_one_monday, version, created_at, updated_at
`;

const ruleColumns = `
  id, term_id, title, weekday, start_local_time, end_local_time, week_start, week_end,
  week_pattern, is_hard, version
`;

const eventColumns = `
  id, calendar_rule_id, title, kind, local_date, start_local_time, end_local_time, is_hard,
  status, version, created_at, updated_at
`;

const timeRequestColumns = `
  id, source, title, target_date, duration_minutes, priority, earliest_start_local_time,
  latest_end_local_time, is_fixed, version, created_at, updated_at
`;

const signalColumns = `
  id, local_date, kind, value, source, version, created_at, updated_at
`;

export function createCalendarRepository(database: Database.Database): CalendarRepository {
  const findTermStatement = database.prepare(
    `select ${termColumns} from terms where id = ? and owner_id = ?`,
  );

  return {
    createTerm(term) {
      database
        .prepare(
          `insert into terms (
             id, owner_id, title, timezone, week_one_monday, version, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          term.id,
          term.ownerId,
          term.title,
          term.timezone,
          term.weekOneMonday,
          term.version,
          term.createdAt,
          term.updatedAt,
        );
      const row = findTermStatement.get(term.id, term.ownerId) as TermRow;
      return toTerm(row);
    },

    findTerm(ownerId, termId) {
      const row = findTermStatement.get(termId, ownerId) as TermRow | undefined;
      return row ? toTerm(row) : undefined;
    },

    listTerms(ownerId) {
      const rows = database
        .prepare(
          `select ${termColumns}
           from terms
           where owner_id = ?
           order by week_one_monday desc, created_at desc, id asc`,
        )
        .all(ownerId) as TermRow[];
      return rows.map(toTerm);
    },

    createRule(rule) {
      database
        .prepare(
          `insert into calendar_rules (
             id, owner_id, term_id, title, weekday, start_local_time, end_local_time, week_start,
             week_end, week_pattern, is_hard, version
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          rule.id,
          rule.ownerId,
          rule.termId,
          rule.title,
          rule.weekday,
          rule.startLocalTime,
          rule.endLocalTime,
          rule.weekStart,
          rule.weekEnd,
          rule.weekPattern,
          rule.isHard ? 1 : 0,
          rule.version,
        );
      const row = database
        .prepare(`select ${ruleColumns} from calendar_rules where id = ? and owner_id = ?`)
        .get(rule.id, rule.ownerId) as CalendarRuleRow;
      return toRule(row);
    },

    createEvent(event) {
      database
        .prepare(
          `insert into events (
             id, owner_id, calendar_rule_id, title, kind, local_date, start_local_time,
             end_local_time, is_hard, status, version, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.ownerId,
          event.calendarRuleId,
          event.title,
          event.kind,
          event.localDate,
          event.startLocalTime,
          event.endLocalTime,
          event.isHard ? 1 : 0,
          event.status,
          event.version,
          event.createdAt,
          event.updatedAt,
        );
      const row = database
        .prepare(`select ${eventColumns} from events where id = ? and owner_id = ?`)
        .get(event.id, event.ownerId) as EventRow;
      return toEvent(row);
    },

    listEventsForDate(ownerId, localDate) {
      const rows = database
        .prepare(
          `select ${eventColumns}
           from events
           where owner_id = ? and local_date = ?
           order by start_local_time asc, end_local_time asc, id asc`,
        )
        .all(ownerId, localDate) as EventRow[];
      return rows.map(toEvent);
    },

    createTimeRequest(request) {
      database
        .prepare(
          `insert into time_requests (
             id, owner_id, source, title, target_date, duration_minutes, priority,
             earliest_start_local_time, latest_end_local_time, is_fixed, version, created_at,
             updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.id,
          request.ownerId,
          request.source,
          request.title,
          request.targetDate,
          request.durationMinutes,
          request.priority,
          request.earliestStartLocalTime,
          request.latestEndLocalTime,
          request.isFixed ? 1 : 0,
          request.version,
          request.createdAt,
          request.updatedAt,
        );
      const row = database
        .prepare(`select ${timeRequestColumns} from time_requests where id = ? and owner_id = ?`)
        .get(request.id, request.ownerId) as TimeRequestRow;
      return toTimeRequest(row);
    },

    listTimeRequestsForDate(ownerId, localDate) {
      const rows = database
        .prepare(
          `select ${timeRequestColumns}
           from time_requests
           where owner_id = ? and target_date = ?
           order by
             case priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,
             created_at asc,
             id asc`,
        )
        .all(ownerId, localDate) as TimeRequestRow[];
      return rows.map(toTimeRequest);
    },

    createSignal(signal) {
      database
        .prepare(
          `insert into signals (
             id, owner_id, local_date, kind, value, source, version, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          signal.id,
          signal.ownerId,
          signal.localDate,
          signal.kind,
          signal.value,
          signal.source,
          signal.version,
          signal.createdAt,
          signal.updatedAt,
        );
      const row = database
        .prepare(`select ${signalColumns} from signals where id = ? and owner_id = ?`)
        .get(signal.id, signal.ownerId) as SignalRow;
      return toSignal(row);
    },
  };
}
