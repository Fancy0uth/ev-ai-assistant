import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyPlanModelOutput } from '@ev/contracts';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createDailyPlanningContextService } from '../src/modules/daily-planning/context-service';
import {
  createDailyPlanningService,
  DailyPlanGenerationError,
  type DailyPlanningCredentialPort,
} from '../src/modules/daily-planning/service';
import {
  DailyPlanBaseVersionStaleError,
  createDailyPlanRunRepository,
  type DailyPlanRunRepository,
} from '../src/modules/daily-planning/repository';
import type {
  DailyPlanningProvider,
  DailyPlanningProviderInput,
} from '../src/modules/daily-planning/provider';
import { CredentialNotConfiguredError } from '../src/modules/providers/credential-service';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000601';
const localDate = '2026-08-18';
const timestamp = new Date('2026-08-18T07:00:00.000Z');
const testApiKey = 'test-only-api-key-that-must-not-leak';
const eventId = '00000000-0000-4000-8000-000000000611';
const timeRequestId = '00000000-0000-4000-8000-000000000621';

class FakeProvider implements DailyPlanningProvider {
  readonly inputs: DailyPlanningProviderInput[] = [];
  readonly apiKeys: string[] = [];
  response: unknown = validModelOutput();
  error: Error | undefined;

  async generate(apiKey: string, input: DailyPlanningProviderInput): Promise<unknown> {
    this.apiKeys.push(apiKey);
    this.inputs.push(input);
    if (this.error) throw this.error;
    return this.response;
  }
}

function validModelOutput(): DailyPlanModelOutput {
  return {
    schemaVersion: 'DAILY_PLAN_MODEL_V1',
    summary: '将高优先级请求安排在上午的可用窗口内。',
    actions: [
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_1',
        startLocalTime: '10:30',
        endLocalTime: '11:30',
        rationale: '该时段在请求的可用窗口内且不会与硬固定块冲突。',
      },
    ],
  };
}

function credentials(error?: Error): DailyPlanningCredentialPort {
  return {
    async withApiKey(_ownerId, callback) {
      if (error) throw error;
      await callback(testApiKey);
    },
  };
}

function expectRepositoryCompletionTimestamp(completedAt: string | null): void {
  if (typeof completedAt !== 'string') throw new Error('Expected the failed run to persist a completion timestamp');
  expect(new Date(completedAt).toISOString()).toBe(completedAt);
  expect(completedAt >= timestamp.toISOString()).toBe(true);
}

describe('daily planning generation service', () => {
  let database: Database.Database;
  let directory: string;
  let repository: DailyPlanRunRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-daily-planning-service-'));
    database = openDatabase(join(directory, 'app.sqlite'));
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'daily-plan-service-owner', 'not-used', timestamp.toISOString());
    repository = createDailyPlanRunRepository(database);

    const calendar = createCalendarRepository(database);
    calendar.createEvent({
      id: eventId,
      ownerId,
      calendarRuleId: null,
      title: 'Private hard event title',
      kind: 'MEETING',
      localDate,
      startLocalTime: '09:00',
      endLocalTime: '10:30',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    });
    calendar.createEvent({
      id: '00000000-0000-4000-8000-000000000612',
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
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    });
    calendar.createTimeRequest({
      id: timeRequestId,
      ownerId,
      source: 'PROJECT_AGENT',
      title: 'Sensitive project title',
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '10:30',
      latestEndLocalTime: '17:00',
      isFixed: false,
      version: 3,
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    });
    calendar.createSignal({
      id: '00000000-0000-4000-8000-000000000631',
      ownerId,
      localDate,
      kind: 'RECOVERY',
      value: 72,
      source: 'CHECK_IN',
      version: 1,
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    });
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function service(
    provider: DailyPlanningProvider,
    credentialPort = credentials(),
    generationRepository = repository,
  ) {
    return createDailyPlanningService({
      contextService: createDailyPlanningContextService(repository, {
        newId: () => '00000000-0000-4000-8000-000000000641',
      }),
      repository: generationRepository,
      credentialService: credentialPort,
      provider,
      newId: () => '00000000-0000-4000-8000-000000000651',
      now: () => timestamp,
    });
  }

  async function expectFailed(
    provider: FakeProvider,
    expectedCode: DailyPlanGenerationError['code'],
    credentialPort?: DailyPlanningCredentialPort,
  ): Promise<void> {
    await expect(
      service(provider, credentialPort).generateDailyPlan({ ownerId, localDate, trigger: 'MANUAL' }),
    ).rejects.toMatchObject({ code: expectedCode });
    const run = repository.getRun(ownerId, '00000000-0000-4000-8000-000000000641');
    expect(run).toMatchObject({
      status: 'FAILED',
      failureCode: expectedCode,
      proposalId: null,
    });
    expectRepositoryCompletionTimestamp(run?.completedAt ?? null);
    expect(
      repository.findProposalByRun(ownerId, '00000000-0000-4000-8000-000000000641'),
    ).toBeUndefined();
  }

  it('projects only safe context fields and persists a pending proposal from a valid fake result', async () => {
    const provider = new FakeProvider();

    const proposal = await service(provider).generateDailyPlan({ ownerId, localDate, trigger: 'MANUAL' });

    expect(proposal).toMatchObject({
      id: '00000000-0000-4000-8000-000000000651',
      runId: '00000000-0000-4000-8000-000000000641',
      localDate,
      status: 'PENDING_REVIEW',
      items: [
        {
          operation: 'SCHEDULE_TIME_REQUEST',
          timeRequestId,
          timeRequestVersion: 3,
          startLocalTime: '10:30',
          endLocalTime: '11:30',
        },
      ],
    });
    expect(proposal.baseScheduleVersion).toBe(repository.readScheduleVersion(ownerId).version);
    expect(repository.getRun(ownerId, proposal.runId)).toMatchObject({
      status: 'SUCCEEDED',
      proposalId: proposal.id,
      failureCode: null,
    });
    expect(provider.apiKeys).toEqual([testApiKey]);
    expect(provider.inputs).toEqual([
      {
        localDate,
        fixedBlocks: [{ startLocalTime: '09:00', endLocalTime: '10:30' }],
        softBlocks: [{ startLocalTime: '18:00', endLocalTime: '19:00' }],
        timeRequests: [
          {
            contextRef: 'TIME_REQUEST_1',
            durationMinutes: 60,
            priority: 'HIGH',
            availability: { earliestStartLocalTime: '10:30', latestEndLocalTime: '17:00' },
          },
        ],
        recoveryLevel: 'READY',
      },
    ]);

    const providerInputText = JSON.stringify(provider.inputs[0]);
    for (const prohibitedValue of [
      ownerId,
      eventId,
      timeRequestId,
      'Private hard event title',
      'Private soft event title',
      'Sensitive project title',
      '72',
      'raw recovery note',
      testApiKey,
      'raw provider response body',
    ]) {
      expect(providerInputText).not.toContain(prohibitedValue);
    }
  });

  it('fails the run when no DeepSeek credential is configured', async () => {
    await expectFailed(
      new FakeProvider(),
      'DAILY_PLAN_PROVIDER_NOT_CONFIGURED',
      credentials(new CredentialNotConfiguredError()),
    );
  });

  it('fails the run when the provider transport rejects', async () => {
    const provider = new FakeProvider();
    provider.error = new Error('network disconnected');

    await expectFailed(provider, 'DAILY_PLAN_PROVIDER_UNAVAILABLE');
  });

  it('fails a prepared run instead of leaving Today stuck when the generating transition fails', async () => {
    const transitionFailureRepository: DailyPlanRunRepository = {
      ...repository,
      markRunGenerating() {
        throw new Error('storage transition failed');
      },
    };

    await expect(
      service(new FakeProvider(), credentials(), transitionFailureRepository).generateDailyPlan({
        ownerId,
        localDate,
        trigger: 'MANUAL',
      }),
    ).rejects.toMatchObject({ code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE' });
    expect(repository.getRun(ownerId, '00000000-0000-4000-8000-000000000641')).toMatchObject({
      status: 'FAILED',
      failureCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
      proposalId: null,
    });
  });

  it('fails the run when the provider result is not valid model JSON', async () => {
    const provider = new FakeProvider();
    provider.response = '{raw provider response body}';

    await expectFailed(provider, 'DAILY_PLAN_MODEL_OUTPUT_INVALID');
    expect(
      database
        .prepare('select count(*) as count from daily_plan_proposals where summary like ?')
        .get('%raw provider response body%'),
    ).toEqual({ count: 0 });
  });

  it('fails the run when the locally validated proposal overlaps a hard fixed block', async () => {
    const provider = new FakeProvider();
    provider.response = {
      ...validModelOutput(),
      actions: [
        {
          operation: 'SCHEDULE_TIME_REQUEST',
          contextRef: 'TIME_REQUEST_1',
          startLocalTime: '09:30',
          endLocalTime: '10:30',
          rationale: 'This overlaps a hard fixed block.',
        },
      ],
    };

    await expectFailed(provider, 'DAILY_PLAN_VALIDATION_FAILED');
  });

  it('preserves the repository stale failure without attempting to fail the terminal run again', async () => {
    const provider = new FakeProvider();
    const staleRepository: DailyPlanRunRepository = {
      ...repository,
      completeWithProposal(...args) {
        createCalendarRepository(database).createEvent({
          id: '00000000-0000-4000-8000-000000000661',
          ownerId,
          calendarRuleId: null,
          title: 'Intervening schedule mutation',
          kind: 'MEETING',
          localDate,
          startLocalTime: '12:00',
          endLocalTime: '13:00',
          isHard: true,
          status: 'CONFIRMED',
          version: 1,
          createdAt: timestamp.toISOString(),
          updatedAt: timestamp.toISOString(),
        });
        return repository.completeWithProposal(...args);
      },
    };

    await expect(
      service(provider, credentials(), staleRepository).generateDailyPlan({
        ownerId,
        localDate,
        trigger: 'MANUAL',
      }),
    ).rejects.toBeInstanceOf(DailyPlanBaseVersionStaleError);
    const run = repository.getRun(ownerId, '00000000-0000-4000-8000-000000000641');
    expect(run).toMatchObject({
      status: 'FAILED',
      failureCode: 'DAILY_PLAN_BASE_VERSION_STALE',
      proposalId: null,
    });
    expectRepositoryCompletionTimestamp(run?.completedAt ?? null);
    expect(
      repository.findProposalByRun(ownerId, '00000000-0000-4000-8000-000000000641'),
    ).toBeUndefined();
  });
});
