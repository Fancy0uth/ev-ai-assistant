import { randomUUID } from 'node:crypto';
import type { Event, Proposal, TimeRequest } from '@ev/contracts';
import type Database from 'better-sqlite3';
import type { CalendarRepository } from '../calendar/repository';
import type { ProposalRepository } from '../proposals/repository';

export interface DailyPlanJobResult {
  status: 'PENDING_CONFIRMATION' | 'NO_CHANGES';
  proposal: Proposal | null;
}

interface DailyPlanJobRow {
  status: DailyPlanJobResult['status'];
  proposal_id: string | null;
}

interface DailyPlannerJobServiceOptions {
  now?: () => Date;
  newId?: () => string;
}

export interface DailyPlannerJobService {
  runStartupCatchUp(): DailyPlanJobResult | null;
  runForDate(ownerId: string, localDate: string): DailyPlanJobResult;
}

function localDateFor(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function minutes(time: string): number {
  const [hours, minute] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minute ?? 0);
}

function timeFor(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutesPart = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutesPart).padStart(2, '0')}`;
}

function eventKindFor(request: TimeRequest): Event['kind'] {
  if (request.source === 'FITNESS_AGENT') return 'WORKOUT';
  if (request.source === 'LEARNING_AGENT') return 'STUDY';
  return 'WORK_BLOCK';
}

function findSlot(request: TimeRequest, events: Event[]): { start: string; end: string } | null {
  const earliest = minutes(request.earliestStartLocalTime ?? '09:00');
  const latest = minutes(request.latestEndLocalTime ?? '21:00');
  for (let start = earliest; start + request.durationMinutes <= latest; start += 5) {
    const end = start + request.durationMinutes;
    const overlaps = events.some(
      (event) =>
        event.status === 'CONFIRMED' &&
        start < minutes(event.endLocalTime) &&
        minutes(event.startLocalTime) < end,
    );
    if (!overlaps) return { start: timeFor(start), end: timeFor(end) };
    if (request.isFixed) return null;
  }
  return null;
}

export function createDailyPlannerJobService(
  database: Database.Database,
  calendarRepository: CalendarRepository,
  proposalRepository: ProposalRepository,
  findOwnerId: () => string | undefined,
  options: DailyPlannerJobServiceOptions = {},
): DailyPlannerJobService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const findJobStatement = database.prepare(
    `select status, proposal_id from daily_plan_jobs where owner_id = ? and local_date = ?`,
  );

  function existingResult(ownerId: string, localDate: string): DailyPlanJobResult | undefined {
    const row = findJobStatement.get(ownerId, localDate) as DailyPlanJobRow | undefined;
    if (!row) return undefined;
    return {
      status: row.status,
      proposal: row.proposal_id ? proposalRepository.findById(ownerId, row.proposal_id) ?? null : null,
    };
  }

  function runForDate(ownerId: string, localDate: string): DailyPlanJobResult {
    const existing = existingResult(ownerId, localDate);
    if (existing) return existing;

    const events = calendarRepository.listEventsForDate(ownerId, localDate);
    const changes: Proposal['changes'] = [];
    for (const request of calendarRepository.listTimeRequestsForDate(ownerId, localDate)) {
      const slot = findSlot(request, events);
      if (!slot) continue;
      const event: Event = {
        id: newId(),
        calendarRuleId: null,
        title: request.title,
        kind: eventKindFor(request),
        localDate,
        startLocalTime: slot.start,
        endLocalTime: slot.end,
        isHard: false,
        status: 'CONFIRMED',
        version: 1,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      };
      changes.push({ operation: 'CREATE_EVENT', event });
      events.push(event);
    }

    const timestamp = now().toISOString();
    const proposal =
      changes.length === 0
        ? null
        : proposalRepository.create({
            id: newId(),
            ownerId,
            kind: 'SCHEDULE',
            status: 'PENDING',
            source: 'DAILY_SCHEDULER',
            title: `${localDate} 每日安排建议`,
            changes,
            version: 1,
            createdAt: timestamp,
            expiresAt: null,
          });
    const status = proposal ? 'PENDING_CONFIRMATION' : 'NO_CHANGES';
    database
      .prepare(
        `insert into daily_plan_jobs (
           owner_id, local_date, status, proposal_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?)`,
      )
      .run(ownerId, localDate, status, proposal?.id ?? null, timestamp, timestamp);
    return { status, proposal };
  }

  return {
    runStartupCatchUp() {
      const current = now();
      if (current.getHours() < 7) return null;
      const ownerId = findOwnerId();
      return ownerId ? runForDate(ownerId, localDateFor(current)) : null;
    },

    runForDate,
  };
}
