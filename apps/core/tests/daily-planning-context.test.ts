import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyPlanContextManifestSchema, dailyPlanRunSchema } from '@ev/contracts';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createDailyPlanningContextService } from '../src/modules/daily-planning/context-service';
import {
  createDailyPlanRunRepository,
  type DailyPlanRunRepository,
} from '../src/modules/daily-planning/repository';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000401';
const otherOwnerId = '00000000-0000-4000-8000-000000000402';
const localDate = '2026-08-18';
const now = new Date('2026-08-18T00:00:00.000Z');

describe('daily planning context builder', () => {
  let database: Database.Database;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-daily-planning-context-'));
    database = openDatabase(join(directory, 'app.sqlite'));
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'daily-plan-owner', 'not-used', now.toISOString());
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function prepare() {
    let sequence = 0;
    return createDailyPlanningContextService(createDailyPlanRunRepository(database), {
      newId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    });
  }

  it('creates a redacted, stable context packet from only confirmed daily inputs', () => {
    const calendar = createCalendarRepository(database);
    calendar.createEvent({
      id: '00000000-0000-4000-8000-000000000411',
      ownerId,
      calendarRuleId: null,
      title: 'Private hard event title',
      kind: 'COURSE',
      localDate,
      startLocalTime: '09:00',
      endLocalTime: '10:30',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: '2026-08-17T01:00:00.000Z',
      updatedAt: '2026-08-17T01:00:00.000Z',
    });
    calendar.createEvent({
      id: '00000000-0000-4000-8000-000000000412',
      ownerId,
      calendarRuleId: null,
      title: 'Private soft event title',
      kind: 'PERSONAL',
      localDate,
      startLocalTime: '18:00',
      endLocalTime: '19:00',
      isHard: false,
      status: 'CONFIRMED',
      version: 1,
      createdAt: '2026-08-17T01:01:00.000Z',
      updatedAt: '2026-08-17T01:01:00.000Z',
    });
    calendar.createEvent({
      id: '00000000-0000-4000-8000-000000000413',
      ownerId,
      calendarRuleId: null,
      title: 'Cancelled event must not leak',
      kind: 'MEETING',
      localDate,
      startLocalTime: '14:00',
      endLocalTime: '15:00',
      isHard: true,
      status: 'CANCELLED',
      version: 1,
      createdAt: '2026-08-17T01:02:00.000Z',
      updatedAt: '2026-08-17T01:02:00.000Z',
    });
    calendar.createTimeRequest({
      id: '00000000-0000-4000-8000-000000000421',
      ownerId,
      source: 'PROJECT_AGENT',
      title: 'Sensitive project title',
      targetDate: localDate,
      durationMinutes: 90,
      priority: 'HIGH',
      earliestStartLocalTime: '10:30',
      latestEndLocalTime: '17:00',
      isFixed: false,
      version: 3,
      createdAt: '2026-08-17T01:05:00.000Z',
      updatedAt: '2026-08-17T01:05:00.000Z',
    });
    calendar.createTimeRequest({
      id: '00000000-0000-4000-8000-000000000422',
      ownerId,
      source: 'FITNESS_AGENT',
      title: 'Sensitive training title',
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'MEDIUM',
      earliestStartLocalTime: null,
      latestEndLocalTime: null,
      isFixed: true,
      version: 2,
      createdAt: '2026-08-17T01:06:00.000Z',
      updatedAt: '2026-08-17T01:06:00.000Z',
    });
    calendar.createSignal({
      id: '00000000-0000-4000-8000-000000000431',
      ownerId,
      localDate,
      kind: 'RECOVERY',
      value: 35,
      source: 'CHECK_IN',
      version: 1,
      createdAt: '2026-08-18T01:00:00.000Z',
      updatedAt: '2026-08-18T01:00:00.000Z',
    });
    calendar.createSignal({
      id: '00000000-0000-4000-8000-000000000432',
      ownerId,
      localDate,
      kind: 'RECOVERY',
      value: 72,
      source: 'CHECK_IN',
      version: 1,
      createdAt: '2026-08-18T02:00:00.000Z',
      updatedAt: '2026-08-18T02:00:00.000Z',
    });
    calendar.createSignal({
      id: '00000000-0000-4000-8000-000000000433',
      ownerId,
      localDate,
      kind: 'DISCOMFORT',
      value: 99,
      source: 'CHECK_IN',
      version: 1,
      createdAt: '2026-08-18T03:00:00.000Z',
      updatedAt: '2026-08-18T03:00:00.000Z',
    });

    const service = prepare();
    const first = service.prepare(ownerId, localDate, 'MANUAL', now);
    const second = service.prepare(ownerId, localDate, 'MANUAL', now);
    const baseScheduleVersion = (
      database.prepare('select version from schedule_versions where owner_id = ?').get(ownerId) as {
        version: number;
      }
    ).version;

    expect(dailyPlanContextManifestSchema.parse(first.run.contextManifest)).toEqual(
      first.run.contextManifest,
    );
    expect(dailyPlanRunSchema.parse(first.run)).toEqual(first.run);
    expect(first.run).toMatchObject({
      contractVersion: 'DAILY_PLAN_V1',
      localDate,
      trigger: 'MANUAL',
      status: 'CONTEXT_READY',
      proposalId: null,
      failureCode: null,
      completedAt: null,
    });
    expect(first.run.contextManifest).toMatchObject({
      purpose: 'DAILY_PLAN_GENERATION',
      localDate,
      sentAt: null,
      entries: [
        { category: 'FIXED_EVENTS', entityCount: 1 },
        { category: 'CONFIRMED_SOFT_BLOCKS', entityCount: 1 },
        { category: 'OPEN_TIME_REQUESTS', entityCount: 2 },
        { category: 'RECOVERY_CONSTRAINTS', entityCount: 1 },
      ],
    });
    expect(first.packet.baseScheduleVersion).toBe(baseScheduleVersion);
    expect(Number.isInteger(first.packet.baseScheduleVersion)).toBe(true);
    expect(first.run.contextManifest).not.toHaveProperty('baseScheduleVersion');
    expect(first.packet).toEqual({
      baseScheduleVersion,
      timeBlocks: [
        { startLocalTime: '09:00', endLocalTime: '10:30', isHard: true },
        { startLocalTime: '18:00', endLocalTime: '19:00', isHard: false },
      ],
      timeRequests: [
        {
          contextRef: 'TIME_REQUEST_1',
          timeRequestId: '00000000-0000-4000-8000-000000000421',
          timeRequestVersion: 3,
          durationMinutes: 90,
          priority: 'HIGH',
          earliestStartLocalTime: '10:30',
          latestEndLocalTime: '17:00',
          isFixed: false,
        },
        {
          contextRef: 'TIME_REQUEST_2',
          timeRequestId: '00000000-0000-4000-8000-000000000422',
          timeRequestVersion: 2,
          durationMinutes: 60,
          priority: 'MEDIUM',
          earliestStartLocalTime: null,
          latestEndLocalTime: null,
          isFixed: true,
        },
      ],
      recoveryLevel: 'READY',
    });
    expect(second.packet).toEqual(first.packet);

    const manifestText = JSON.stringify(first.run.contextManifest);
    expect(manifestText).not.toContain('00000000-0000-4000-8000-000000000411');
    expect(manifestText).not.toContain('00000000-0000-4000-8000-000000000421');
    expect(manifestText).not.toContain('Private hard event title');
    expect(manifestText).not.toContain('Sensitive project title');
    expect(manifestText).not.toContain('72');
    expect(manifestText).not.toContain('apiKey');
    expect(manifestText).not.toContain('DISCOMFORT');
    expect(manifestText).not.toContain('contextRef');
  });

  it('keeps reads owner and date scoped and does not write schedule entities', () => {
    const calendar = createCalendarRepository(database);
    calendar.createEvent({
      id: '00000000-0000-4000-8000-000000000441',
      ownerId,
      calendarRuleId: null,
      title: 'Tomorrow only',
      kind: 'WORK_BLOCK',
      localDate: '2026-08-19',
      startLocalTime: '09:00',
      endLocalTime: '10:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    calendar.createTimeRequest({
      id: '00000000-0000-4000-8000-000000000442',
      ownerId,
      source: 'LEARNING_AGENT',
      title: 'Tomorrow request',
      targetDate: '2026-08-19',
      durationMinutes: 45,
      priority: 'LOW',
      earliestStartLocalTime: null,
      latestEndLocalTime: null,
      isFixed: false,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const repository = createDailyPlanRunRepository(database);
    expect(repository.readContext(otherOwnerId, localDate)).toEqual({
      events: [],
      timeRequests: [],
      latestRecovery: undefined,
    });
    expect(repository.readContext(ownerId, localDate)).toEqual({
      events: [],
      timeRequests: [],
      latestRecovery: undefined,
    });

    const before = database
      .prepare(
        `select
           (select count(*) from events) as events,
           (select count(*) from time_requests) as time_requests,
           (select count(*) from tasks) as tasks,
           (select count(*) from actions) as actions`,
      )
      .get();
    const result = prepare().prepare(ownerId, localDate, 'SCHEDULED_0700', now);
    const baseScheduleVersion = (
      database.prepare('select version from schedule_versions where owner_id = ?').get(ownerId) as {
        version: number;
      }
    ).version;
    const after = database
      .prepare(
        `select
           (select count(*) from events) as events,
           (select count(*) from time_requests) as time_requests,
           (select count(*) from tasks) as tasks,
           (select count(*) from actions) as actions`,
      )
      .get();

    expect(result.packet).toEqual({
      baseScheduleVersion,
      timeBlocks: [],
      timeRequests: [],
      recoveryLevel: 'NONE',
    });
    expect(result.run.contextManifest).not.toHaveProperty('baseScheduleVersion');
    expect(after).toEqual(before);
    expect(
      database.prepare('select status, proposal_id, failure_code, completed_at from daily_plan_runs').all(),
    ).toEqual([
      { status: 'CONTEXT_READY', proposal_id: null, failure_code: null, completed_at: null },
    ]);
  });

  it('captures the base version before context reads so an intervening mutation is conservatively stale', () => {
    const calendar = createCalendarRepository(database);
    const databaseRepository = createDailyPlanRunRepository(database);
    const baseScheduleVersion = databaseRepository.readScheduleVersion(ownerId).version;
    const repository: DailyPlanRunRepository = {
      ...databaseRepository,
      readContext(readOwnerId, readLocalDate) {
        const context = databaseRepository.readContext(readOwnerId, readLocalDate);
        calendar.createEvent({
          id: '00000000-0000-4000-8000-000000000451',
          ownerId,
          calendarRuleId: null,
          title: 'Intervening schedule mutation',
          kind: 'MEETING',
          localDate,
          startLocalTime: '10:00',
          endLocalTime: '11:00',
          isHard: true,
          status: 'CONFIRMED',
          version: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        return context;
      },
    };
    const service = createDailyPlanningContextService(repository, {
      newId: () => '00000000-0000-4000-8000-000000000452',
    });

    const result = service.prepare(ownerId, localDate, 'MANUAL', now);

    expect(result.packet.baseScheduleVersion).toBe(baseScheduleVersion);
    expect(databaseRepository.readScheduleVersion(ownerId).version).toBe(baseScheduleVersion + 1);
    expect(result.packet.timeBlocks).toEqual([]);
    expect(result.run.contextManifest).not.toHaveProperty('baseScheduleVersion');
  });
});
