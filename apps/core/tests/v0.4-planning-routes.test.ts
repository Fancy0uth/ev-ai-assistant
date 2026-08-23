import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiErrorSchema } from '@ev/contracts';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import type { DailyPlanningProvider } from '../src/modules/daily-planning/provider';
import type { SecretStorePort } from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: 'v4-05-route-owner',
  password: 'correct horse battery staple',
};
const localDate = '2026-08-24';
const otherOwnerId = '00000000-0000-4000-8000-000000005501';

class CountingSecretStore implements SecretStorePort {
  readonly values = new Map<string, string>();
  unprotectCalls = 0;

  async protect(plaintext: string): Promise<string> {
    const protectedValue = `v4-05-route-key-${this.values.size + 1}`;
    this.values.set(protectedValue, plaintext);
    return protectedValue;
  }

  async unprotect(protectedValue: string): Promise<string> {
    this.unprotectCalls += 1;
    const value = this.values.get(protectedValue);
    if (value === undefined) throw new Error('missing test credential');
    return value;
  }
}

class CountingProvider implements DailyPlanningProvider {
  calls = 0;

  async generate(): Promise<unknown> {
    this.calls += 1;
    return {
      schemaVersion: 'DAILY_PLAN_MODEL_V1',
      summary: 'A route test provider response.',
      actions: [],
    };
  }
}

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('v0.4 approved scheduling and manual Event routes', () => {
  let app: FastifyInstance | undefined;
  let controlDatabase: Database.Database | undefined;
  let directory: string;
  let databasePath: string;
  let provider: CountingProvider;
  let secretStore: CountingSecretStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v04-planning-routes-'));
    databasePath = join(directory, 'app.sqlite');
    provider = new CountingProvider();
    secretStore = new CountingSecretStore();
  });

  afterEach(async () => {
    controlDatabase?.close();
    controlDatabase = undefined;
    if (app) await app.close();
    app = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  function currentApp(): FastifyInstance {
    if (!app) throw new Error('app is not initialized');
    return app;
  }

  function database(): Database.Database {
    if (!controlDatabase) controlDatabase = openDatabase(databasePath);
    return controlDatabase;
  }

  function eventCount(ownerId: string): number {
    return Number(
      database().prepare('select count(*) from events where owner_id = ?').pluck().get(ownerId),
    );
  }

  function proposalAuditCount(proposalId: string): number {
    return Number(
      database()
        .prepare('select count(*) from proposal_audits where proposal_id = ?')
        .pluck()
        .get(proposalId),
    );
  }

  function createOtherOwner(): void {
    database().pragma('ignore_check_constraints = ON');
    try {
      database()
        .prepare(
          'insert into owners (singleton_key, id, username, password_hash, created_at) values (?, ?, ?, ?, ?)',
        )
        .run(2, otherOwnerId, 'v4-05-other-owner', 'not-used', '2026-08-24T00:00:00.000Z');
    } finally {
      database().pragma('ignore_check_constraints = OFF');
    }
  }

  async function authenticatedOwner(): Promise<{ token: string; ownerId: string }> {
    app = await buildApp({
      databasePath,
      dailyPlanningProvider: provider,
      logger: false,
      secretStore,
    });
    const setup = await currentApp().inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: credentials,
    });
    expect(setup.statusCode).toBe(201);
    return {
      token: readSessionToken(setup.headers['set-cookie']),
      ownerId: setup.json().data.owner.id,
    };
  }

  async function prepare(token: string): Promise<{ id: string; version: number }> {
    const response = await currentApp().inject({
      method: 'POST',
      url: '/v1/daily-plans/preflights',
      cookies: { ev_session: token },
      payload: { localDate },
    });
    expect(response.statusCode).toBe(201);
    const preflight = response.json().data;
    return { id: preflight.id, version: preflight.version };
  }

  async function approve(token: string, preflightId: string, expectedPreflightVersion: number): Promise<number> {
    const response = await currentApp().inject({
      method: 'POST',
      url: `/v1/daily-plans/preflights/${preflightId}/approve`,
      cookies: { ev_session: token },
      payload: { expectedPreflightVersion, items: [] },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.version;
  }

  async function createEventProposal(
    token: string,
    title: string,
  ): Promise<{ proposalId: string; eventId: string }> {
    const response = await currentApp().inject({
      method: 'POST',
      url: '/v1/event-proposals',
      cookies: { ev_session: token },
      payload: {
        title,
        kind: 'MEETING',
        localDate,
        startLocalTime: '14:00',
        endLocalTime: '15:00',
        isHard: true,
      },
    });
    expect(response.statusCode).toBe(201);
    const proposal = response.json().data;
    return { proposalId: proposal.id, eventId: proposal.changes[0].event.id };
  }

  it('authenticates every scheduling mutation and resource path before parsing malformed input', async () => {
    app = await buildApp({ databasePath, dailyPlanningProvider: provider, logger: false, secretStore });

    for (const request of [
      { method: 'POST' as const, url: '/v1/daily-plans/preflights', payload: { localDate: 'invalid' } },
      {
        method: 'POST' as const,
        url: '/v1/daily-plans/preflights/not-a-uuid/approve',
        payload: { expectedPreflightVersion: 0, items: 'invalid' },
      },
      { method: 'POST' as const, url: '/v1/daily-plans/generate', payload: { localDate } },
      { method: 'POST' as const, url: '/v1/event-proposals', payload: { ownerId: otherOwnerId } },
      { method: 'GET' as const, url: '/v1/events/not-a-uuid' },
      {
        method: 'POST' as const,
        url: '/v1/proposals/not-a-uuid/decision',
        payload: { version: 0, decision: 'INVALID' },
      },
    ]) {
      const response = await currentApp().inject(request);
      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('prepares and approves context without provider access, while fail-closing old generation bodies', async () => {
    const { token } = await authenticatedOwner();

    for (const payload of [
      { localDate },
      {
        preflightId: '00000000-0000-4000-8000-000000005502',
        expectedPreflightVersion: 1,
        localDate,
      },
      {},
    ]) {
      const response = await currentApp().inject({
        method: 'POST',
        url: '/v1/daily-plans/generate',
        cookies: { ev_session: token },
        payload,
      });
      expect(response.statusCode).toBe(422);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(provider.calls).toBe(0);
    expect(secretStore.unprotectCalls).toBe(0);
    expect(Number(database().prepare('select count(*) from daily_plan_runs').pluck().get())).toBe(0);
    expect(Number(database().prepare('select count(*) from daily_plan_preflights').pluck().get())).toBe(0);

    const preflight = await prepare(token);
    expect(provider.calls).toBe(0);
    expect(secretStore.unprotectCalls).toBe(0);

    const awaiting = await currentApp().inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      payload: { preflightId: preflight.id, expectedPreflightVersion: preflight.version },
    });
    expect(awaiting.statusCode).toBe(409);
    expect(apiErrorSchema.parse(awaiting.json()).error.code).toBe('DAILY_PLAN_PREFLIGHT_NOT_APPROVED');
    expect(provider.calls).toBe(0);
    expect(secretStore.unprotectCalls).toBe(0);

    const approvedVersion = await approve(token, preflight.id, preflight.version);
    const repeatedApproval = await currentApp().inject({
      method: 'POST',
      url: `/v1/daily-plans/preflights/${preflight.id}/approve`,
      cookies: { ev_session: token },
      payload: { expectedPreflightVersion: approvedVersion, items: [] },
    });
    expect(repeatedApproval.statusCode).toBe(409);
    expect(apiErrorSchema.parse(repeatedApproval.json()).error.code).toBe(
      'DAILY_PLAN_PREFLIGHT_NOT_APPROVABLE',
    );
  });

  it('strictly accepts only safe manual Event semantics', async () => {
    const { token } = await authenticatedOwner();
    const safeInput = {
      title: 'Team review',
      kind: 'MEETING',
      localDate,
      startLocalTime: '14:00',
      endLocalTime: '15:00',
      isHard: true,
    };

    for (const invalidInput of [
      { ...safeInput, endLocalTime: '14:00' },
      { ...safeInput, ownerId: otherOwnerId },
      { ...safeInput, source: 'DAILY_SCHEDULER' },
      { ...safeInput, provider: 'deepseek' },
      { ...safeInput, id: otherOwnerId },
      { ...safeInput, calendarRuleId: otherOwnerId },
      { ...safeInput, status: 'CONFIRMED' },
      { ...safeInput, version: 1 },
      { ...safeInput, createdAt: '2026-08-24T00:00:00.000Z' },
      { ...safeInput, updatedAt: '2026-08-24T00:00:00.000Z' },
      { ...safeInput, expiresAt: null },
      { ...safeInput, changes: [] },
      { ...safeInput, event: {} },
    ]) {
      const response = await currentApp().inject({
        method: 'POST',
        url: '/v1/event-proposals',
        cookies: { ev_session: token },
        payload: invalidInput,
      });
      expect(response.statusCode).toBe(422);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('materializes a manual Event only through the existing accept decision transaction', async () => {
    const { token, ownerId } = await authenticatedOwner();
    const pending = await createEventProposal(token, 'Pending Event');

    expect(eventCount(ownerId)).toBe(0);
    const beforeDecision = await currentApp().inject({
      method: 'GET',
      url: `/v1/events/${pending.eventId}`,
      cookies: { ev_session: token },
    });
    expect(beforeDecision.statusCode).toBe(404);
    expect(apiErrorSchema.parse(beforeDecision.json()).error.code).toBe('EVENT_NOT_FOUND');

    const rejected = await createEventProposal(token, 'Rejected Event');
    const rejection = await currentApp().inject({
      method: 'POST',
      url: `/v1/proposals/${rejected.proposalId}/decision`,
      cookies: { ev_session: token },
      payload: { version: 1, decision: 'REJECT' },
    });
    expect(rejection.statusCode).toBe(200);
    expect(rejection.json().data).toMatchObject({ status: 'REJECTED', version: 2 });
    expect(eventCount(ownerId)).toBe(0);

    const accepted = await createEventProposal(token, 'Accepted Event');
    const acceptance = await currentApp().inject({
      method: 'POST',
      url: `/v1/proposals/${accepted.proposalId}/decision`,
      cookies: { ev_session: token },
      payload: { version: 1, decision: 'ACCEPT' },
    });
    expect(acceptance.statusCode).toBe(200);
    expect(acceptance.json().data).toMatchObject({ status: 'ACCEPTED', version: 2 });
    expect(eventCount(ownerId)).toBe(1);

    const detail = await currentApp().inject({
      method: 'GET',
      url: `/v1/events/${accepted.eventId}`,
      cookies: { ev_session: token },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      id: accepted.eventId,
      title: 'Accepted Event',
      kind: 'MEETING',
      localDate,
      startLocalTime: '14:00',
      endLocalTime: '15:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
    });
  });

  it('returns the same not-found response for an Event belonging to another owner', async () => {
    const { token } = await authenticatedOwner();
    createOtherOwner();
    const otherEvent = createCalendarRepository(database()).createEvent({
      id: '00000000-0000-4000-8000-000000005503',
      ownerId: otherOwnerId,
      calendarRuleId: null,
      title: 'Other owner private event',
      kind: 'MEETING',
      localDate,
      startLocalTime: '10:00',
      endLocalTime: '11:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    });

    const response = await currentApp().inject({
      method: 'GET',
      url: `/v1/events/${otherEvent.id}`,
      cookies: { ev_session: token },
    });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error).toEqual({
      code: 'EVENT_NOT_FOUND',
      message: '日程不存在',
    });
  });

  it('rolls back Event, proposal decision, and audit when Event materialization fails', async () => {
    const { token, ownerId } = await authenticatedOwner();
    const proposal = await createEventProposal(token, 'Conflicting Event');
    createOtherOwner();
    createCalendarRepository(database()).createEvent({
      id: proposal.eventId,
      ownerId: otherOwnerId,
      calendarRuleId: null,
      title: 'Conflicting other owner Event',
      kind: 'MEETING',
      localDate,
      startLocalTime: '08:00',
      endLocalTime: '09:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    });

    const response = await currentApp().inject({
      method: 'POST',
      url: `/v1/proposals/${proposal.proposalId}/decision`,
      cookies: { ev_session: token },
      payload: { version: 1, decision: 'ACCEPT' },
    });
    expect(response.statusCode).toBe(500);
    expect(eventCount(ownerId)).toBe(0);
    expect(proposalAuditCount(proposal.proposalId)).toBe(0);
    const storedProposal = database()
      .prepare('select status, version from proposals where id = ? and owner_id = ?')
      .get(proposal.proposalId, ownerId);
    expect(storedProposal).toEqual({ status: 'PENDING', version: 1 });
  });
});
