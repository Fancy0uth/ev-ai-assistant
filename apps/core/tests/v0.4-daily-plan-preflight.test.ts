import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createDailyPlanningContextService } from '../src/modules/daily-planning/context-service';
import {
  createDailyPlanPreflightService,
  DailyPlanPreflightError,
} from '../src/modules/daily-planning/preflight-service';
import { DailyPlanBaseVersionStaleError } from '../src/modules/daily-planning/repository';
import {
  createDailyPlanningService,
  type DailyPlanningCredentialPort,
} from '../src/modules/daily-planning/service';
import type {
  DailyPlanningProvider,
  DailyPlanningProviderInput,
} from '../src/modules/daily-planning/provider';
import { createDailyPlanRunRepository } from '../src/modules/daily-planning/repository';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000004401';
const localDate = '2026-08-23';
const now = new Date('2026-08-23T07:00:00.000Z');

class CountingProvider implements DailyPlanningProvider {
  calls = 0;
  lastInput: DailyPlanningProviderInput | undefined;

  async generate(_apiKey: string, input: DailyPlanningProviderInput): Promise<unknown> {
    this.calls += 1;
    this.lastInput = input;
    return {
      schemaVersion: 'DAILY_PLAN_MODEL_V1',
      summary: 'This output must never be used by a legacy direct generation call.',
      actions: [],
    };
  }
}

function credentials(): DailyPlanningCredentialPort {
  return {
    async withApiKey(_ownerId, callback) {
      await callback('test-only-key');
    },
  };
}

function validModelOutput(contextRef = 'TIME_REQUEST_1') {
  return {
    schemaVersion: 'DAILY_PLAN_MODEL_V1' as const,
    summary: '安排已批准的工作请求。',
    actions: [
      {
        operation: 'SCHEDULE_TIME_REQUEST' as const,
        contextRef,
        startLocalTime: '10:00',
        endLocalTime: '11:00',
        rationale: '该时段满足已批准的可用窗口。',
      },
    ],
  };
}

describe('v0.4 daily plan preflight boundary', () => {
  let database: Database.Database;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v04-preflight-'));
    database = openDatabase(join(directory, 'app.sqlite'));
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'v04-preflight-owner', 'not-used', now.toISOString());
    createCalendarRepository(database).createTimeRequest({
      id: '00000000-0000-4000-8000-000000004411',
      ownerId,
      source: 'PROJECT_AGENT',
      title: 'Private local project task',
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '09:00',
      latestEndLocalTime: '17:00',
      isFixed: false,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('fails closed for legacy direct generation without loading credentials or calling the provider', async () => {
    const repository = createDailyPlanRunRepository(database);
    const provider = new CountingProvider();
    const contextService = createDailyPlanningContextService(repository, {
      newId: () => '00000000-0000-4000-8000-000000004421',
    });
    const service = createDailyPlanningService({
      preflightService: createDailyPlanPreflightService({
        contextService,
        repository,
        newId: () => '00000000-0000-4000-8000-000000004423',
        now: () => now,
      }),
      repository,
      credentialService: credentials(),
      provider,
      newId: () => '00000000-0000-4000-8000-000000004422',
      now: () => now,
    });

    await expect(
      service.generateDailyPlan({ ownerId, localDate, trigger: 'MANUAL' }),
    ).rejects.toMatchObject({ code: 'DAILY_PLAN_PREFLIGHT_REQUIRED' });

    expect(provider.calls).toBe(0);
    expect(database.prepare('select count(*) as count from daily_plan_runs').get()).toEqual({ count: 0 });
    expect(database.prepare('select count(*) as count from daily_plan_preflights').get()).toEqual({ count: 0 });
    expect(database.prepare('select count(*) as count from daily_plan_proposals').get()).toEqual({ count: 0 });
  });

  it('persists public preflight semantics atomically before any provider call', () => {
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004431',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004432',
      now: () => now,
    });

    const preflight = preflightService.prepare(ownerId, localDate);

    expect(preflight).toMatchObject({
      id: '00000000-0000-4000-8000-000000004432',
      status: 'AWAITING_APPROVAL',
      version: 1,
      approvedAt: null,
      claimedAt: null,
      consumedAt: null,
      items: [
        {
          contextRef: 'TIME_REQUEST_1',
          safeTitle: 'Private local project task',
          domain: 'WORK',
          deadlineLocalDate: localDate,
          durationMinutes: 60,
          priority: 'HIGH',
          availability: { earliestStartLocalTime: '09:00', latestEndLocalTime: '17:00' },
          isFixed: false,
          included: true,
        },
      ],
    });
    expect(repository.getRun(ownerId, preflight.runId)).toMatchObject({
      status: 'CONTEXT_READY',
      proposalId: null,
      failureCode: null,
    });
    const stored = database
      .prepare('select items_json from daily_plan_preflights where id = ?')
      .get(preflight.id) as { items_json: string };
    for (const forbidden of [ownerId, '00000000-0000-4000-8000-000000004411', 'test-only-key', 'apiKey']) {
      expect(stored.items_json).not.toContain(forbidden);
    }
  });

  it('requires the exact approval context set and keeps immutable scheduling fields', () => {
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004441',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004442',
      now: () => now,
    });
    const preflight = preflightService.prepare(ownerId, localDate);

    expect(() => preflightService.approve(ownerId, preflight.id, preflight.version, [])).toThrow(
      DailyPlanPreflightError,
    );
    expect(repository.getPreflight(ownerId, preflight.id)).toEqual(preflight);

    const approved = preflightService.approve(ownerId, preflight.id, preflight.version, [
      {
        contextRef: 'TIME_REQUEST_1',
        safeTitle: 'Write the review summary',
        domain: 'STUDY',
        deadlineLocalDate: '2026-08-24',
        included: true,
      },
    ]);
    expect(approved).toMatchObject({ status: 'APPROVED', version: 2 });
    expect(approved.items).toEqual([
      expect.objectContaining({
        safeTitle: 'Write the review summary',
        domain: 'STUDY',
        deadlineLocalDate: '2026-08-24',
        durationMinutes: 60,
        priority: 'HIGH',
        availability: { earliestStartLocalTime: '09:00', latestEndLocalTime: '17:00' },
        isFixed: false,
      }),
    ]);
  });

  it('calls credential and provider outside the claim transaction and consumes a successful approval once', async () => {
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004451',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004452',
      now: () => now,
    });
    const provider = new CountingProvider();
    provider.generate = async (_apiKey, input) => {
      expect(database.inTransaction).toBe(false);
      provider.calls += 1;
      provider.lastInput = input;
      return validModelOutput();
    };
    const credentialPort: DailyPlanningCredentialPort = {
      async withApiKey(_ownerId, callback) {
        expect(database.inTransaction).toBe(false);
        await callback('test-only-key');
      },
    };
    const service = createDailyPlanningService({
      preflightService,
      repository,
      credentialService: credentialPort,
      provider,
      newId: () => '00000000-0000-4000-8000-000000004453',
      now: () => now,
    });
    const prepared = preflightService.prepare(ownerId, localDate);
    const approved = preflightService.approve(ownerId, prepared.id, prepared.version, [
      {
        contextRef: 'TIME_REQUEST_1',
        safeTitle: 'Approved semantic only',
        domain: 'STUDY',
        deadlineLocalDate: '2026-08-24',
        included: true,
      },
    ]);

    const proposal = await service.generateApprovedPreflight({
      ownerId,
      preflightId: approved.id,
      expectedPreflightVersion: approved.version,
    });

    expect(provider.calls).toBe(1);
    expect(provider.lastInput).toEqual({
      localDate,
      fixedBlocks: [],
      softBlocks: [],
      timeRequests: [
        {
          contextRef: 'TIME_REQUEST_1',
          safeTitle: 'Approved semantic only',
          domain: 'STUDY',
          deadlineLocalDate: '2026-08-24',
          durationMinutes: 60,
          priority: 'HIGH',
          availability: { earliestStartLocalTime: '09:00', latestEndLocalTime: '17:00' },
          isFixed: false,
        },
      ],
      recoveryLevel: 'NONE',
    });
    expect(JSON.stringify(provider.lastInput)).not.toContain('00000000-0000-4000-8000-000000004411');
    expect(repository.getRun(ownerId, proposal.runId)).toMatchObject({ status: 'SUCCEEDED' });
    expect(repository.getPreflight(ownerId, approved.id)).toMatchObject({ status: 'CONSUMED', version: 4 });
    await expect(
      service.generateApprovedPreflight({
        ownerId,
        preflightId: approved.id,
        expectedPreflightVersion: 4,
      }),
    ).rejects.toMatchObject({ code: 'DAILY_PLAN_PREFLIGHT_NOT_APPROVED' });
    expect(provider.calls).toBe(1);
  });

  it('rejects cross-owner, stale-version, and already-approved changes without writes', () => {
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004461',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004462',
      now: () => now,
    });
    const preflight = preflightService.prepare(ownerId, localDate);
    const edits = [
      {
        contextRef: 'TIME_REQUEST_1',
        safeTitle: 'Approved task',
        domain: 'WORK' as const,
        deadlineLocalDate: localDate,
        included: true,
      },
    ];

    expect(() => preflightService.approve('00000000-0000-4000-8000-000000004499', preflight.id, 1, edits))
      .toThrow('DAILY_PLAN_PREFLIGHT_NOT_FOUND');
    expect(() => preflightService.approve(ownerId, preflight.id, 9, edits)).toThrow(
      'DAILY_PLAN_PREFLIGHT_VERSION_CONFLICT',
    );
    expect(repository.getPreflight(ownerId, preflight.id)).toEqual(preflight);

    const approved = preflightService.approve(ownerId, preflight.id, 1, edits);
    expect(() => preflightService.approve(ownerId, preflight.id, approved.version, edits)).toThrow(
      'DAILY_PLAN_PREFLIGHT_NOT_APPROVABLE',
    );
    expect(repository.getPreflight(ownerId, preflight.id)).toEqual(approved);
  });

  it('marks schedule drift stale at approval before any external operation', () => {
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004471',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004472',
      now: () => now,
    });
    const preflight = preflightService.prepare(ownerId, localDate);
    createCalendarRepository(database).createEvent({
      id: '00000000-0000-4000-8000-000000004473',
      ownerId,
      calendarRuleId: null,
      title: 'Schedule drift',
      kind: 'MEETING',
      localDate,
      startLocalTime: '12:00',
      endLocalTime: '13:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    expect(() => preflightService.approve(ownerId, preflight.id, preflight.version, [
      {
        contextRef: 'TIME_REQUEST_1',
        safeTitle: 'Approved task',
        domain: 'WORK',
        deadlineLocalDate: localDate,
        included: true,
      },
    ])).toThrow(DailyPlanBaseVersionStaleError);
    expect(repository.getPreflight(ownerId, preflight.id)).toMatchObject({ status: 'STALE' });
    expect(repository.getRun(ownerId, preflight.runId)).toMatchObject({
      status: 'FAILED',
      failureCode: 'DAILY_PLAN_BASE_VERSION_STALE',
    });
  });

  it('excludes unapproved items from provider input and consumes provider failures', async () => {
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004481',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004482',
      now: () => now,
    });
    const provider = new CountingProvider();
    provider.generate = async (_apiKey, input) => {
      provider.calls += 1;
      provider.lastInput = input;
      throw new Error('transport failure');
    };
    const service = createDailyPlanningService({
      preflightService,
      repository,
      credentialService: credentials(),
      provider,
      newId: () => '00000000-0000-4000-8000-000000004483',
      now: () => now,
    });
    const prepared = preflightService.prepare(ownerId, localDate);
    const approved = preflightService.approve(ownerId, prepared.id, prepared.version, [
      {
        contextRef: 'TIME_REQUEST_1',
        safeTitle: 'Do not send this item',
        domain: 'WORK',
        deadlineLocalDate: localDate,
        included: false,
      },
    ]);

    await expect(service.generateApprovedPreflight({
      ownerId,
      preflightId: approved.id,
      expectedPreflightVersion: approved.version,
    })).rejects.toMatchObject({ code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE' });
    expect(provider.lastInput?.timeRequests).toEqual([]);
    expect(repository.getPreflight(ownerId, approved.id)).toMatchObject({ status: 'CONSUMED' });
    expect(repository.getRun(ownerId, prepared.runId)).toMatchObject({
      status: 'FAILED',
      failureCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
    });
  });

  it('rejects an excluded context ref returned by a provider that saw only included items', async () => {
    createCalendarRepository(database).createTimeRequest({
      id: '00000000-0000-4000-8000-000000004484',
      ownerId,
      source: 'PROJECT_AGENT',
      title: 'Excluded private local project task',
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'MEDIUM',
      earliestStartLocalTime: '09:00',
      latestEndLocalTime: '17:00',
      isFixed: false,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004485',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004486',
      now: () => now,
    });
    const provider = new CountingProvider();
    provider.generate = async (_apiKey, input) => {
      provider.calls += 1;
      provider.lastInput = input;
      return validModelOutput('TIME_REQUEST_2');
    };
    const service = createDailyPlanningService({
      preflightService,
      repository,
      credentialService: credentials(),
      provider,
      newId: () => '00000000-0000-4000-8000-000000004487',
      now: () => now,
    });
    const prepared = preflightService.prepare(ownerId, localDate);
    const approved = preflightService.approve(ownerId, prepared.id, prepared.version, [
      {
        contextRef: 'TIME_REQUEST_1',
        safeTitle: 'Included task',
        domain: 'WORK',
        deadlineLocalDate: localDate,
        included: true,
      },
      {
        contextRef: 'TIME_REQUEST_2',
        safeTitle: 'Excluded task',
        domain: 'WORK',
        deadlineLocalDate: localDate,
        included: false,
      },
    ]);

    await expect(service.generateApprovedPreflight({
      ownerId,
      preflightId: approved.id,
      expectedPreflightVersion: approved.version,
    })).rejects.toMatchObject({ code: 'DAILY_PLAN_VALIDATION_FAILED' });

    expect(provider.calls).toBe(1);
    expect(provider.lastInput?.timeRequests.map((request) => request.contextRef)).toEqual([
      'TIME_REQUEST_1',
    ]);
    expect(repository.getPreflight(ownerId, approved.id)).toMatchObject({ status: 'CONSUMED' });
    expect(repository.getRun(ownerId, prepared.runId)).toMatchObject({
      status: 'FAILED',
      failureCode: 'DAILY_PLAN_VALIDATION_FAILED',
    });
    expect(repository.findProposalByRun(ownerId, prepared.runId)).toBeUndefined();
    expect(database.prepare('select count(*) as count from daily_plan_proposals').get()).toEqual({ count: 0 });
  });

  it('stales an approved preflight during claim without calling a provider', async () => {
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004491',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004492',
      now: () => now,
    });
    const provider = new CountingProvider();
    const service = createDailyPlanningService({
      preflightService,
      repository,
      credentialService: credentials(),
      provider,
      newId: () => '00000000-0000-4000-8000-000000004493',
      now: () => now,
    });
    const prepared = preflightService.prepare(ownerId, localDate);
    const approved = preflightService.approve(ownerId, prepared.id, prepared.version, [
      {
        contextRef: 'TIME_REQUEST_1',
        safeTitle: 'Approved task',
        domain: 'WORK',
        deadlineLocalDate: localDate,
        included: true,
      },
    ]);
    createCalendarRepository(database).createEvent({
      id: '00000000-0000-4000-8000-000000004494',
      ownerId,
      calendarRuleId: null,
      title: 'Schedule changed before claim',
      kind: 'MEETING',
      localDate,
      startLocalTime: '13:00',
      endLocalTime: '14:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    await expect(service.generateApprovedPreflight({
      ownerId,
      preflightId: approved.id,
      expectedPreflightVersion: approved.version,
    })).rejects.toBeInstanceOf(DailyPlanBaseVersionStaleError);
    expect(provider.calls).toBe(0);
    expect(repository.getPreflight(ownerId, approved.id)).toMatchObject({ status: 'STALE' });
  });

  it('stales a claimed preflight at completion and writes no proposal', async () => {
    const repository = createDailyPlanRunRepository(database);
    const preflightService = createDailyPlanPreflightService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000004501',
      }),
      repository,
      newId: () => '00000000-0000-4000-8000-000000004502',
      now: () => now,
    });
    const provider = new CountingProvider();
    provider.generate = async () => {
      provider.calls += 1;
      createCalendarRepository(database).createEvent({
        id: '00000000-0000-4000-8000-000000004503',
        ownerId,
        calendarRuleId: null,
        title: 'Schedule changed during provider call',
        kind: 'MEETING',
        localDate,
        startLocalTime: '14:00',
        endLocalTime: '15:00',
        isHard: true,
        status: 'CONFIRMED',
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      return validModelOutput();
    };
    const service = createDailyPlanningService({
      preflightService,
      repository,
      credentialService: credentials(),
      provider,
      newId: () => '00000000-0000-4000-8000-000000004504',
      now: () => now,
    });
    const prepared = preflightService.prepare(ownerId, localDate);
    const approved = preflightService.approve(ownerId, prepared.id, prepared.version, [
      {
        contextRef: 'TIME_REQUEST_1',
        safeTitle: 'Approved task',
        domain: 'WORK',
        deadlineLocalDate: localDate,
        included: true,
      },
    ]);

    await expect(service.generateApprovedPreflight({
      ownerId,
      preflightId: approved.id,
      expectedPreflightVersion: approved.version,
    })).rejects.toBeInstanceOf(DailyPlanBaseVersionStaleError);
    expect(provider.calls).toBe(1);
    expect(repository.getPreflight(ownerId, approved.id)).toMatchObject({ status: 'STALE' });
    expect(repository.getRun(ownerId, prepared.runId)).toMatchObject({
      status: 'FAILED',
      failureCode: 'DAILY_PLAN_BASE_VERSION_STALE',
    });
    expect(repository.findProposalByRun(ownerId, prepared.runId)).toBeUndefined();
  });
});
