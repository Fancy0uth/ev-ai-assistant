import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { dailyPlanPreflightResponseSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type {
  DailyPlanningProvider,
  DailyPlanningProviderInput,
  DailyPlanningProviderResult,
} from '../src/modules/daily-planning/provider';
import { createDailyPlanRunRepository } from '../src/modules/daily-planning/repository';
import {
  hashIdempotencyRequest,
  type IdempotencyClaimInput,
} from '../src/modules/providers/idempotency-service';
import { PROVIDER_POLICY, providerUsageLocalDate } from '../src/modules/providers/provider-policy';
import { createProviderReliabilityRepository } from '../src/modules/providers/reliability-repository';
import { SecretStoreUnavailableError, type SecretStorePort } from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: 'recovery-sweeper-owner',
  password: 'correct horse battery staple',
};
const t0 = new Date('2026-08-24T10:00:00.000Z');

class CountingProvider implements DailyPlanningProvider {
  calls = 0;

  async generate(_apiKey: string, _input: DailyPlanningProviderInput): Promise<DailyPlanningProviderResult> {
    this.calls += 1;
    throw new Error('startup and expiry finalization must not invoke Provider');
  }
}

class CountingSecretStore implements SecretStorePort {
  unprotectCalls = 0;

  async protect(_plaintext: string): Promise<string> {
    return 'not-used';
  }

  async unprotect(_protectedValue: string): Promise<string> {
    this.unprotectCalls += 1;
    throw new SecretStoreUnavailableError();
  }
}

function sessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('v0.5 expired Provider execution convergence', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;
  let current: Date;
  let provider: CountingProvider;
  let secretStore: CountingSecretStore;
  const databases: Database.Database[] = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v05-recovery-sweeper-'));
    databasePath = join(directory, 'app.sqlite');
    current = t0;
    provider = new CountingProvider();
    secretStore = new CountingSecretStore();
  });

  afterEach(async () => {
    while (databases.length > 0) databases.pop()?.close();
    if (app) await app.close();
    app = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  async function openApp(): Promise<FastifyInstance> {
    app = await buildApp({
      databasePath,
      logger: false,
      dailyPlanningProvider: provider,
      secretStore,
      providerReliabilityNow: () => current,
    });
    return app;
  }

  async function setupOwner(): Promise<{ ownerId: string; token: string }> {
    const response = await app!.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    expect(response.statusCode).toBe(201);
    return {
      ownerId: response.json().data.owner.id as string,
      token: sessionToken(response.headers['set-cookie']),
    };
  }

  async function approvedPreflight(token: string) {
    const prepared = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/preflights',
      cookies: { ev_session: token },
      payload: { localDate: '2026-08-25' },
    });
    const preflight = dailyPlanPreflightResponseSchema.parse(prepared.json()).data;
    const approved = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/preflights/${preflight.id}/approve`,
      cookies: { ev_session: token },
      payload: { expectedPreflightVersion: preflight.version, items: [] },
    });
    return dailyPlanPreflightResponseSchema.parse(approved.json()).data;
  }

  function seedExecution(input: {
    ownerId: string;
    preflightId: string;
    expectedPreflightVersion: number;
    idempotencyKey: string;
    attemptCount: 1 | 2;
  }) {
    const database = openDatabase(databasePath);
    databases.push(database);
    const reliability = createProviderReliabilityRepository(database);
    const payload = {
      preflightId: input.preflightId,
      expectedPreflightVersion: input.expectedPreflightVersion,
    };
    const request: IdempotencyClaimInput = {
      ownerId: input.ownerId,
      key: input.idempotencyKey,
      operation: 'daily_plan.generate',
      resourceId: input.preflightId,
      body: payload,
    };
    const recordId = `00000000-0000-4000-8000-00000000580${input.attemptCount}`;
    const leaseToken = `expired-lease-${input.attemptCount}`;
    reliability.createInProgress({
      id: recordId,
      ownerId: input.ownerId,
      key: input.idempotencyKey,
      operation: request.operation,
      resourceId: request.resourceId,
      requestHash: hashIdempotencyRequest(request),
      leaseToken,
      leaseExpiresAt: new Date(t0.getTime() + PROVIDER_POLICY.leaseMs).toISOString(),
      attemptCount: input.attemptCount,
      createdAt: t0.toISOString(),
    });
    const dailyPlans = createDailyPlanRunRepository(database);
    const claimed = dailyPlans.claimApprovedPreflight({
      ownerId: input.ownerId,
      preflightId: input.preflightId,
      expectedVersion: input.expectedPreflightVersion,
      claimedAt: t0.toISOString(),
      execution: {
        leaseToken,
        leaseExpiresAt: new Date(t0.getTime() + PROVIDER_POLICY.leaseMs).toISOString(),
        deadlineAt: new Date(t0.getTime() + PROVIDER_POLICY.totalTimeoutMs).toISOString(),
        attemptCount: input.attemptCount,
        idempotencyRecordId: recordId,
      },
    });
    if (claimed.kind !== 'claimed') throw new Error('expected seeded execution claim');
    const providerCallId = `00000000-0000-4000-8000-00000000590${input.attemptCount}`;
    expect(
      reliability.reserveProviderCall({
        id: providerCallId,
        ownerId: input.ownerId,
        runId: claimed.run.id,
        idempotencyRecordId: recordId,
        provider: 'DEEPSEEK',
        operation: 'daily_plan.generate',
        model: 'deepseek-v4-flash',
        attemptNo: input.attemptCount,
        inputChars: 100,
        localDate: providerUsageLocalDate(t0),
        startedAt: t0.toISOString(),
        reservedTokens: 2_100,
        maxAttemptsPerDay: PROVIDER_POLICY.maxCallsPerOwnerDay,
        maxTokensPerDay: PROVIDER_POLICY.maxTokensPerOwnerDay,
      }),
    ).toBe(true);
    return { database, request, payload, claimed, recordId, providerCallId };
  }

  function expectTerminalBundle(database: Database.Database, ids: {
    recordId: string;
    runId: string;
    preflightId: string;
    providerCallId: string;
  }) {
    const record = database
      .prepare('select state, response_status, response_json, failure_code from idempotency_records where id = ?')
      .get(ids.recordId) as Record<string, unknown>;
    expect(record).toMatchObject({
      state: 'FAILED',
      response_status: 503,
      failure_code: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
    });
    expect(JSON.parse(String(record.response_json))).toMatchObject({
      error: { code: 'DAILY_PLAN_PROVIDER_INTERRUPTED' },
    });
    expect(
      database.prepare('select status, failure_code, terminal_reason from daily_plan_runs where id = ?').get(ids.runId),
    ).toEqual({
      status: 'FAILED',
      failure_code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
      terminal_reason: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
    });
    expect(
      database.prepare('select status from daily_plan_preflights where id = ?').get(ids.preflightId),
    ).toEqual({ status: 'CONSUMED' });
    expect(
      database.prepare('select status, failure_code, total_tokens from provider_call_logs where id = ?').get(ids.providerCallId),
    ).toEqual({
      status: 'FAILED',
      failure_code: 'DAILY_PLAN_PROVIDER_INTERRUPTED',
      total_tokens: 2_100,
    });
  }

  it('sweeps an expired file-backed execution before startup accepts requests and is restart-idempotent', async () => {
    await openApp();
    const { ownerId, token } = await setupOwner();
    const preflight = await approvedPreflight(token);
    await app!.close();
    app = undefined;

    const seeded = seedExecution({
      ownerId,
      preflightId: preflight.id,
      expectedPreflightVersion: preflight.version,
      idempotencyKey: 'v05-startup-sweeper-expired-01',
      attemptCount: 1,
    });
    seeded.database.close();
    databases.splice(databases.indexOf(seeded.database), 1);
    current = new Date(t0.getTime() + PROVIDER_POLICY.leaseMs + 1_000);

    await openApp();
    const control = openDatabase(databasePath);
    databases.push(control);
    expectTerminalBundle(control, {
      recordId: seeded.recordId,
      runId: seeded.claimed.run.id,
      preflightId: preflight.id,
      providerCallId: seeded.providerCallId,
    });
    const firstTerminal = control
      .prepare('select updated_at from idempotency_records where id = ?')
      .get(seeded.recordId);
    expect(provider.calls).toBe(0);
    expect(secretStore.unprotectCalls).toBe(0);

    control.close();
    databases.splice(databases.indexOf(control), 1);
    await app!.close();
    app = undefined;
    current = new Date(current.getTime() + 1_000);
    await openApp();
    const reopened = openDatabase(databasePath);
    databases.push(reopened);
    expect(
      reopened.prepare('select updated_at from idempotency_records where id = ?').get(seeded.recordId),
    ).toEqual(firstTerminal);
    expect(provider.calls).toBe(0);
    expect(secretStore.unprotectCalls).toBe(0);
  });

  it('uses the same terminal unit for an attempt-two request-path expiry and replays it', async () => {
    await openApp();
    const { ownerId, token } = await setupOwner();
    const preflight = await approvedPreflight(token);
    const seeded = seedExecution({
      ownerId,
      preflightId: preflight.id,
      expectedPreflightVersion: preflight.version,
      idempotencyKey: 'v05-attempt-two-expired-01',
      attemptCount: 2,
    });
    current = new Date(t0.getTime() + PROVIDER_POLICY.leaseMs + 1_000);

    const first = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-attempt-two-expired-01' },
      payload: seeded.payload,
    });
    expect(first.statusCode).toBe(503);
    expectTerminalBundle(seeded.database, {
      recordId: seeded.recordId,
      runId: seeded.claimed.run.id,
      preflightId: preflight.id,
      providerCallId: seeded.providerCallId,
    });

    const replay = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/generate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-attempt-two-expired-01' },
      payload: seeded.payload,
    });
    expect(replay.statusCode).toBe(503);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(provider.calls).toBe(0);
    expect(secretStore.unprotectCalls).toBe(0);
  });
});
