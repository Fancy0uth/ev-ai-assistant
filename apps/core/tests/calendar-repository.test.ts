import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCalendarRepository,
  type NewEvent,
} from '../src/modules/calendar/repository';
import {
  createProposalRepository,
  type NewProposal,
} from '../src/modules/proposals/repository';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000101';
const otherOwnerId = '00000000-0000-4000-8000-000000000102';
const termId = '00000000-0000-4000-8000-000000000103';
const ruleId = '00000000-0000-4000-8000-000000000104';
const now = '2026-08-17T00:00:00.000Z';

describe('owner-scoped calendar and proposal repositories', () => {
  let database: Database.Database;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-calendar-repository-'));
    database = openDatabase(join(directory, 'app.sqlite'));
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, '日程主人', 'not-used', now);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('persists a term, recurring rule and concrete event without leaking another owner data', () => {
    const calendar = createCalendarRepository(database);
    calendar.createTerm({
      id: termId,
      ownerId,
      title: '2026 秋季学期',
      timezone: 'Asia/Shanghai',
      weekOneMonday: '2026-09-07',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    calendar.createRule({
      id: ruleId,
      ownerId,
      termId,
      title: '数据库系统',
      weekday: 1,
      startLocalTime: '08:00',
      endLocalTime: '09:40',
      weekStart: 1,
      weekEnd: 16,
      weekPattern: 'EVERY_WEEK',
      isHard: true,
      version: 1,
    });
    const event: NewEvent = {
      id: '00000000-0000-4000-8000-000000000105',
      ownerId,
      calendarRuleId: ruleId,
      title: '数据库系统',
      kind: 'COURSE',
      localDate: '2026-09-07',
      startLocalTime: '08:00',
      endLocalTime: '09:40',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const savedEvent = calendar.createEvent(event);

    expect(calendar.listEventsForDate(ownerId, '2026-09-07')).toEqual([savedEvent]);
    expect(calendar.listEventsForDate(otherOwnerId, '2026-09-07')).toEqual([]);
  });

  it('round-trips pending proposal JSON while scoping reads to its owner', () => {
    const proposals = createProposalRepository(database);
    const proposal: NewProposal = {
      id: '00000000-0000-4000-8000-000000000106',
      ownerId,
      kind: 'SCHEDULE',
      status: 'PENDING',
      source: 'COURSE_IMPORT',
      title: '导入课程',
      changes: [
        {
          operation: 'CREATE_CALENDAR_RULE',
          rule: {
            id: ruleId,
            termId,
            title: '数据库系统',
            weekday: 1,
            startLocalTime: '08:00',
            endLocalTime: '09:40',
            weekStart: 1,
            weekEnd: 16,
            weekPattern: 'EVERY_WEEK',
            isHard: true,
            version: 1,
          },
        },
      ],
      version: 1,
      createdAt: now,
      expiresAt: null,
    };

    const savedProposal = proposals.create(proposal);
    expect(savedProposal).toMatchObject({ id: proposal.id, title: proposal.title });
    expect(proposals.findById(ownerId, proposal.id)).toEqual(savedProposal);
    expect(proposals.findById(otherOwnerId, proposal.id)).toBeUndefined();
    expect(proposals.listPending(otherOwnerId)).toEqual([]);
  });
});
