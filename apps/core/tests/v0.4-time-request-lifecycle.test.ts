import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createDailyPlanningContextService } from '../src/modules/daily-planning/context-service';
import { createDailyPlanRunRepository } from '../src/modules/daily-planning/repository';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000901';
const otherOwnerId = '00000000-0000-4000-8000-000000000902';
const localDate = '2026-08-23';
const createdAt = '2026-08-23T00:00:00.000Z';

function origin(entityVersion = 1) {
  return {
    kind: 'TASK' as const,
    entityId: '00000000-0000-4000-8000-000000000911',
    entityVersion,
  };
}

describe('v0.4 TimeRequest lifecycle repository', () => {
  let database: Database.Database;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-time-request-lifecycle-'));
    database = openDatabase(join(directory, 'app.sqlite'));
    const insertOwner = database.prepare(
      'insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)',
    );
    insertOwner.run(ownerId, 'time-request-owner', 'not-used', createdAt);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function createLegacyRequest(id: string) {
    return createCalendarRepository(database).createTimeRequest({
      id,
      ownerId,
      source: 'PROJECT_AGENT',
      title: 'Legacy request',
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '09:00',
      latestEndLocalTime: '18:00',
      isFixed: false,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    });
  }

  function createActiveRequest(id: string, entityVersion = 1, timestamp = createdAt) {
    return createCalendarRepository(database).createActiveTimeRequest({
      id,
      ownerId,
      source: 'PROJECT_AGENT',
      title: 'Project implementation block',
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '09:00',
      latestEndLocalTime: '18:00',
      isFixed: false,
      origin: origin(entityVersion),
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  it('normalizes legacy creation to explicit active lifecycle fields', () => {
    expect(createLegacyRequest('00000000-0000-4000-8000-000000000921')).toMatchObject({
      origin: null,
      lifecycleStatus: 'ACTIVE',
      closedAt: null,
      closedReason: null,
    });
  });

  it('creates, updates, closes, replaces, and audits one origin without reopening history', () => {
    const calendar = createCalendarRepository(database);
    const originalId = '00000000-0000-4000-8000-000000000922';
    const replacementId = '00000000-0000-4000-8000-000000000923';
    const closedAt = '2026-08-23T01:00:00.000Z';

    expect(createActiveRequest(originalId)).toMatchObject({
      origin: origin(),
      lifecycleStatus: 'ACTIVE',
      closedAt: null,
      closedReason: null,
      version: 1,
    });
    expect(calendar.findActiveTimeRequestByOrigin(ownerId, origin())).toMatchObject({ id: originalId });

    expect(
      calendar.updateActiveTimeRequest(ownerId, originalId, {
        expectedVersion: 1,
        title: 'Updated project implementation block',
        targetDate: localDate,
        durationMinutes: 90,
        priority: 'MEDIUM',
        earliestStartLocalTime: '10:00',
        latestEndLocalTime: '18:00',
        isFixed: true,
        origin: origin(2),
        updatedAt: '2026-08-23T00:30:00.000Z',
      }),
    ).toMatchObject({
      id: originalId,
      title: 'Updated project implementation block',
      durationMinutes: 90,
      origin: origin(2),
      lifecycleStatus: 'ACTIVE',
      version: 2,
    });

    const closed = calendar.closeActiveTimeRequest(ownerId, originalId, {
      expectedVersion: 2,
      closedAt,
      closedReason: 'COMPLETED',
    });
    expect(closed).toMatchObject({
      id: originalId,
      title: 'Updated project implementation block',
      origin: origin(2),
      lifecycleStatus: 'CLOSED',
      closedAt,
      closedReason: 'COMPLETED',
      version: 3,
    });
    expect(calendar.findActiveTimeRequestByOrigin(ownerId, origin())).toBeUndefined();
    expect(
      calendar.updateActiveTimeRequest(ownerId, originalId, {
        expectedVersion: 3,
        title: 'Must not reopen',
        targetDate: localDate,
        durationMinutes: 30,
        priority: 'LOW',
        earliestStartLocalTime: null,
        latestEndLocalTime: null,
        isFixed: false,
        origin: origin(3),
        updatedAt: '2026-08-23T01:01:00.000Z',
      }),
    ).toBeUndefined();
    expect(
      calendar.closeActiveTimeRequest(ownerId, originalId, {
        expectedVersion: 3,
        closedAt: '2026-08-23T01:01:00.000Z',
        closedReason: 'CANCELLED',
      }),
    ).toBeUndefined();

    expect(createActiveRequest(replacementId, 3, '2026-08-23T02:00:00.000Z')).toMatchObject({
      id: replacementId,
      lifecycleStatus: 'ACTIVE',
      origin: origin(3),
    });
    expect(calendar.findActiveTimeRequestByOrigin(ownerId, origin())).toMatchObject({
      id: replacementId,
      origin: origin(3),
    });
    expect(calendar.listTimeRequestHistoryForOrigin(ownerId, origin())).toMatchObject([
      { id: originalId, lifecycleStatus: 'CLOSED', origin: origin(2) },
      { id: replacementId, lifecycleStatus: 'ACTIVE', origin: origin(3) },
    ]);
    expect(() => createActiveRequest('00000000-0000-4000-8000-000000000924', 4)).toThrow();
  });

  it('keeps active mutations and lookup owner- and version-scoped', () => {
    const calendar = createCalendarRepository(database);
    const id = '00000000-0000-4000-8000-000000000925';
    createActiveRequest(id);

    expect(calendar.findActiveTimeRequestByOrigin(otherOwnerId, origin())).toBeUndefined();
    expect(
      calendar.updateActiveTimeRequest(otherOwnerId, id, {
        expectedVersion: 1,
        title: 'Other owner cannot change this',
        targetDate: localDate,
        durationMinutes: 30,
        priority: 'LOW',
        earliestStartLocalTime: null,
        latestEndLocalTime: null,
        isFixed: false,
        origin: origin(2),
        updatedAt: '2026-08-23T00:30:00.000Z',
      }),
    ).toBeUndefined();
    expect(
      calendar.closeActiveTimeRequest(ownerId, id, {
        expectedVersion: 2,
        closedAt: '2026-08-23T00:30:00.000Z',
        closedReason: 'CANCELLED',
      }),
    ).toBeUndefined();
    expect(calendar.findActiveTimeRequestByOrigin(ownerId, origin())).toMatchObject({
      id,
      version: 1,
      title: 'Project implementation block',
    });
  });

  it('excludes closed requests from new daily context while retaining audit review context', () => {
    const calendar = createCalendarRepository(database);
    const requestId = '00000000-0000-4000-8000-000000000926';
    const runId = '00000000-0000-4000-8000-000000000927';
    const proposalId = '00000000-0000-4000-8000-000000000928';
    createActiveRequest(requestId);

    const repository = createDailyPlanRunRepository(database);
    const service = createDailyPlanningContextService(repository, { newId: () => runId });
    const prepared = service.prepare(ownerId, localDate, 'MANUAL', new Date(createdAt));
    repository.completeWithProposal(ownerId, runId, prepared.packet.baseScheduleVersion, {
      id: proposalId,
      contractVersion: 'DAILY_PLAN_V1',
      runId,
      localDate,
      status: 'PENDING_REVIEW',
      baseScheduleVersion: prepared.packet.baseScheduleVersion,
      summary: 'A stored audit proposal.',
      items: [],
      version: 1,
      createdAt,
      updatedAt: createdAt,
    });
    calendar.closeActiveTimeRequest(ownerId, requestId, {
      expectedVersion: 1,
      closedAt: '2026-08-23T01:00:00.000Z',
      closedReason: 'CANCELLED',
    });

    expect(repository.readContext(ownerId, localDate).timeRequests).toEqual([]);
    expect(repository.getReviewExecutionContext(ownerId, proposalId)?.timeRequests).toEqual([
      expect.objectContaining({ id: requestId, lifecycleStatus: 'CLOSED' }),
    ]);

    const closedInjectedRepository = {
      ...repository,
      readContext() {
        return {
          events: [],
          timeRequests: [
            {
              id: requestId,
              version: 2,
              source: 'PROJECT_AGENT' as const,
              targetDate: localDate,
              durationMinutes: 60,
              priority: 'HIGH' as const,
              earliestStartLocalTime: '09:00',
              latestEndLocalTime: '18:00',
              isFixed: false,
              lifecycleStatus: 'CLOSED' as const,
            },
          ],
          latestRecovery: undefined,
        };
      },
    };
    const guardedService = createDailyPlanningContextService(closedInjectedRepository, {
      newId: () => '00000000-0000-4000-8000-000000000929',
    });

    expect(() => guardedService.prepare(ownerId, localDate, 'MANUAL', new Date(createdAt))).toThrow(
      'DAILY_PLAN_CLOSED_TIME_REQUEST_CONTEXT',
    );
  });
});
