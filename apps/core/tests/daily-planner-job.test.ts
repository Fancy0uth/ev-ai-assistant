import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDailyPlannerJobService } from '../src/modules/jobs/service';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createProposalRepository } from '../src/modules/proposals/repository';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000301';
const now = '2026-08-17T00:00:00.000Z';

describe('07:00 local daily planner Job', () => {
  let database: Database.Database;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-daily-planner-job-'));
    database = openDatabase(join(directory, 'app.sqlite'));
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, '排程主人', 'not-used', now);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('catches up after 07:00 once, turning an existing TimeRequest into a pending Event Proposal', () => {
    const calendar = createCalendarRepository(database);
    calendar.createTimeRequest({
      id: '00000000-0000-4000-8000-000000000302',
      ownerId,
      source: 'PROJECT_AGENT',
      title: '完成 PRD 评审',
      targetDate: '2026-08-17',
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '09:00',
      latestEndLocalTime: '11:00',
      isFixed: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const jobs = createDailyPlannerJobService(
      database,
      calendar,
      createProposalRepository(database),
      () => ownerId,
      { now: () => new Date(2026, 7, 17, 7, 5, 0) },
    );

    const first = jobs.runStartupCatchUp();
    const second = jobs.runStartupCatchUp();

    expect(first).toMatchObject({
      status: 'PENDING_CONFIRMATION',
      proposal: {
        kind: 'SCHEDULE',
        source: 'DAILY_SCHEDULER',
        status: 'PENDING',
        changes: [
          {
            operation: 'CREATE_EVENT',
            event: {
              title: '完成 PRD 评审',
              kind: 'WORK_BLOCK',
              localDate: '2026-08-17',
              startLocalTime: '09:00',
              endLocalTime: '10:00',
              isHard: false,
            },
          },
        ],
      },
    });
    expect(second).toEqual(first);
    expect(database.prepare('select count(*) as count from daily_plan_jobs').get()).toEqual({ count: 1 });
  });

  it('does not make up a proposal before 07:00 or where no TimeRequest exists', () => {
    const jobs = createDailyPlannerJobService(
      database,
      createCalendarRepository(database),
      createProposalRepository(database),
      () => ownerId,
      { now: () => new Date(2026, 7, 17, 6, 59, 0) },
    );
    expect(jobs.runStartupCatchUp()).toBeNull();
    expect(database.prepare('select count(*) as count from daily_plan_jobs').get()).toEqual({ count: 0 });
  });
});
