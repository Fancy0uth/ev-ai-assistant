import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  apiErrorSchema,
  dailyPlanProposalResponseSchema,
  dailyPlanReviewListResponseSchema,
  dailyPlanReviewResponseSchema,
  dailyPlanReviewSchema,
  type DailyPlanModelOutput,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import type {
  DailyPlanningProvider,
  DailyPlanningProviderInput,
} from '../src/modules/daily-planning/provider';
import { SecretStoreUnavailableError, type SecretStorePort } from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: 'daily-plan-review-route-owner',
  password: 'correct horse battery staple',
};
const localDate = '2026-08-18';
const testApiKey = 'test-only-daily-plan-review-api-key';
const timeRequestId = '00000000-0000-4000-8000-000000000702';
const otherOwnerId = '00000000-0000-4000-8000-000000000703';

class FakeSecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();

  async protect(plaintext: string): Promise<string> {
    this.values.set('daily-plan-review-route-credential', plaintext);
    return 'daily-plan-review-route-credential';
  }

  async unprotect(protectedValue: string): Promise<string> {
    const plaintext = this.values.get(protectedValue);
    if (plaintext === undefined) throw new SecretStoreUnavailableError();
    return plaintext;
  }
}

class FakeDailyPlanningProvider implements DailyPlanningProvider {
  readonly inputs: DailyPlanningProviderInput[] = [];

  async generate(_apiKey: string, input: DailyPlanningProviderInput): Promise<unknown> {
    this.inputs.push(input);
    return validModelOutput();
  }
}

function validModelOutput(): DailyPlanModelOutput {
  return {
    schemaVersion: 'DAILY_PLAN_MODEL_V1',
    summary: '为今天生成了待审阅安排。',
    actions: [
      {
        operation: 'SCHEDULE_TIME_REQUEST',
        contextRef: 'TIME_REQUEST_1',
        startLocalTime: '10:00',
        endLocalTime: '11:00',
        rationale: '该时段满足请求窗口且未与固定日程冲突。',
      },
    ],
  };
}

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('daily plan review routes', () => {
  let app: FastifyInstance | undefined;
  let controlDatabase: Database.Database | undefined;
  let databasePath: string;
  let directory: string;
  let provider: FakeDailyPlanningProvider;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-daily-plan-review-routes-'));
    databasePath = join(directory, 'app.sqlite');
    provider = new FakeDailyPlanningProvider();
  });

  afterEach(async () => {
    controlDatabase?.close();
    controlDatabase = undefined;
    if (app) await app.close();
    app = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  function calendar() {
    if (!controlDatabase) controlDatabase = openDatabase(databasePath);
    return createCalendarRepository(controlDatabase);
  }

  async function createAuthenticatedApp(): Promise<{ token: string; ownerId: string }> {
    app = await buildApp({
      databasePath,
      dailyPlanningProvider: provider,
      logger: false,
      secretStore: new FakeSecretStore(),
    });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    expect(setup.statusCode).toBe(201);
    return {
      token: readSessionToken(setup.headers['set-cookie']),
      ownerId: setup.json().data.owner.id as string,
    };
  }

  async function createProposal(token: string, ownerId: string) {
    calendar().createTimeRequest({
      id: timeRequestId,
      ownerId,
      source: 'PROJECT_AGENT',
      title: 'owner review request',
      targetDate: localDate,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '10:00',
      latestEndLocalTime: '17:00',
      isFixed: false,
      version: 1,
      createdAt: '2026-08-18T07:00:00.000Z',
      updatedAt: '2026-08-18T07:00:00.000Z',
    });
    const credential = await app!.inject({
      method: 'PUT',
      url: '/v1/providers/deepseek/credential',
      cookies: { ev_session: token },
      payload: { apiKey: testApiKey },
    });
    expect(credential.statusCode).toBe(200);
    const response = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      payload: { localDate },
    });
    expect(response.statusCode).toBe(201);
    return dailyPlanProposalResponseSchema.parse(response.json()).data;
  }

  function createScheduleChange(ownerId: string): void {
    calendar().createEvent({
      id: '00000000-0000-4000-8000-000000000704',
      ownerId,
      calendarRuleId: null,
      title: 'intervening schedule mutation',
      kind: 'MEETING',
      localDate,
      startLocalTime: '12:00',
      endLocalTime: '13:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: '2026-08-18T07:00:00.000Z',
      updatedAt: '2026-08-18T07:00:00.000Z',
    });
  }

  function moveProposalToOtherOwner(proposalId: string, runId: string): void {
    const database = controlDatabase!;
    database.pragma('foreign_keys = OFF');
    try {
      database.prepare('update daily_plan_runs set owner_id = ? where id = ?').run(otherOwnerId, runId);
      database
        .prepare('update daily_plan_proposals set owner_id = ? where id = ?')
        .run(otherOwnerId, proposalId);
    } finally {
      database.pragma('foreign_keys = ON');
    }
  }

  function expectConflict(
    response: Awaited<ReturnType<FastifyInstance['inject']>>,
    code: 'DAILY_PLAN_PROPOSAL_VERSION_CONFLICT' | 'DAILY_PLAN_BASE_VERSION_STALE',
  ) {
    expect(response.statusCode).toBe(409);
    const raw = response.json();
    expect(Object.keys(raw)).toEqual(['error']);
    expect(Object.keys(raw.error).sort()).toEqual(['code', 'details', 'message']);
    expect(raw.error.code).toBe(code);
    expect(typeof raw.error.message).toBe('string');
    expect(Object.keys(raw.error.details)).toEqual(['currentReview']);
    return dailyPlanReviewSchema.parse(raw.error.details.currentReview);
  }

  it('authenticates every review endpoint before parsing malformed input', async () => {
    app = await buildApp({
      databasePath,
      dailyPlanningProvider: provider,
      logger: false,
      secretStore: new FakeSecretStore(),
    });

    const responses = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/v1/daily-plans/proposals?page=0&unknown=value',
      }),
      app.inject({
        method: 'GET',
        url: '/v1/daily-plans/proposals/not-a-uuid',
      }),
      app.inject({
        method: 'POST',
        url: '/v1/daily-plans/proposals/not-a-uuid/decisions',
        payload: { unexpected: true },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('lists, reads, and applies an owned proposal through contract-shaped responses', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    const proposal = await createProposal(token, ownerId);

    const list = await app!.inject({
      method: 'GET',
      url: `/v1/daily-plans/proposals?localDate=${localDate}&page=1&pageSize=20`,
      cookies: { ev_session: token },
    });
    expect(list.statusCode).toBe(200);
    expect(dailyPlanReviewListResponseSchema.parse(list.json()).data).toMatchObject({
      items: [{ proposal: { id: proposal.id, status: 'PENDING_REVIEW' } }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    const read = await app!.inject({
      method: 'GET',
      url: `/v1/daily-plans/proposals/${proposal.id}`,
      cookies: { ev_session: token },
    });
    expect(read.statusCode).toBe(200);
    expect(dailyPlanReviewResponseSchema.parse(read.json()).data.proposal.id).toBe(proposal.id);

    const decision = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/proposals/${proposal.id}/decisions`,
      cookies: { ev_session: token },
      payload: {
        expectedProposalVersion: proposal.version,
        decisions: [{ itemId: proposal.items[0]!.id, decision: 'APPLY' }],
      },
    });
    expect(decision.statusCode).toBe(200);
    expect(dailyPlanReviewResponseSchema.parse(decision.json()).data.proposal.status).toBe('APPLIED');
  });

  it('does not disclose another owner\'s proposal', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    const proposal = await createProposal(token, ownerId);
    moveProposalToOtherOwner(proposal.id, proposal.runId);

    for (const request of [
      { method: 'GET' as const, url: `/v1/daily-plans/proposals/${proposal.id}` },
      {
        method: 'POST' as const,
        url: `/v1/daily-plans/proposals/${proposal.id}/decisions`,
        payload: {
          expectedProposalVersion: proposal.version,
          decisions: [{ itemId: proposal.items[0]!.id, decision: 'APPLY' }],
        },
      },
    ]) {
      const response = await app!.inject({ ...request, cookies: { ev_session: token } });
      expect(response.statusCode).toBe(404);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('DAILY_PLAN_PROPOSAL_NOT_FOUND');
    }
  });

  it('returns a safe local-validation error for an invalid time override', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    const proposal = await createProposal(token, ownerId);

    const response = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/proposals/${proposal.id}/decisions`,
      cookies: { ev_session: token },
      payload: {
        expectedProposalVersion: proposal.version,
        decisions: [
          {
            itemId: proposal.items[0]!.id,
            decision: 'APPLY',
            startLocalTime: '10:00',
            endLocalTime: '10:30',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        code: 'DAILY_PLAN_VALIDATION_FAILED',
        message: '每日计划决策未通过本地校验',
      },
    });
  });

  it('returns the current review when the expected proposal version is stale', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    const proposal = await createProposal(token, ownerId);

    const response = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/proposals/${proposal.id}/decisions`,
      cookies: { ev_session: token },
      payload: {
        expectedProposalVersion: proposal.version + 1,
        decisions: [{ itemId: proposal.items[0]!.id, decision: 'APPLY' }],
      },
    });

    expect(expectConflict(response, 'DAILY_PLAN_PROPOSAL_VERSION_CONFLICT').proposal).toMatchObject({
      id: proposal.id,
      status: 'PENDING_REVIEW',
      version: proposal.version,
    });
  });

  it('returns the final stale review after schedule-version drift', async () => {
    const { token, ownerId } = await createAuthenticatedApp();
    const proposal = await createProposal(token, ownerId);
    createScheduleChange(ownerId);

    const response = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/proposals/${proposal.id}/decisions`,
      cookies: { ev_session: token },
      payload: {
        expectedProposalVersion: proposal.version,
        decisions: [{ itemId: proposal.items[0]!.id, decision: 'APPLY' }],
      },
    });

    expect(expectConflict(response, 'DAILY_PLAN_BASE_VERSION_STALE').proposal).toMatchObject({
      id: proposal.id,
      status: 'STALE',
      version: proposal.version + 1,
    });
  });
});
