import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createV07HealthTestAdapters } from '../e2e/v0.7-health-test-adapters';
import { buildApp } from '../src/app';
import { openDatabase } from '../src/storage/database';

const apps: FastifyInstance[] = [];
const directories: string[] = [];
const retryAfterSeconds = '86400';

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

async function createHarness(): Promise<{
  app: FastifyInstance;
  databasePath: string;
  ownerId: string;
  session: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), 'ev-v07-quota-replay-'));
  directories.push(directory);
  const databasePath = join(directory, 'app.sqlite');
  const app = await buildApp({
    databasePath,
    artifactRoot: join(directory, 'artifacts'),
    logger: false,
    ...createV07HealthTestAdapters(),
    v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: directory },
  });
  apps.push(app);
  const setup = await app.inject({
    method: 'POST',
    url: '/v1/auth/setup',
    payload: { username: 'quota-owner', password: 'correct horse battery staple' },
  });
  const database = openDatabase(databasePath);
  try {
    const owner = database.prepare('select id from owners').get() as { id: string };
    return { app, databasePath, ownerId: owner.id, session: tokenFrom(setup.headers['set-cookie']) };
  } finally {
    database.close();
  }
}

function seedConsumedQuota(
  databasePath: string,
  ownerId: string,
  capability: 'WORKOUT_TEXT_SELECTION' | 'MEAL_CANDIDATE_PARSE' | 'NUTRITION_DATA_LOOKUP',
  localDate: string,
): void {
  const database = openDatabase(databasePath);
  try {
    const insert = database.prepare(`insert into v07_capability_runs (
      id, owner_id, capability, operation, resource_id, provider_id, provider_label,
      adapter_kind, evidence_kind, disclosure_json, disclosure_version, state,
      policy_version, local_date, actual_calls, app_version, created_at, updated_at, version
    ) values (?, ?, ?, 'quota-fixture', ?, 'v07-test-fixture', 'Synthetic quota fixture',
      'TEST_FIXTURE', 'AUTOMATED_TEST_FIXTURE', '{}', 'HEALTH_DISCLOSURE_V1', 'SUCCEEDED',
      'HEALTH_CAPABILITY_POLICY_V1', ?, 1, '0.7.0', ?, ?, 1)`);
    for (let index = 0; index < 5; index += 1) {
      insert.run(
        `quota-${capability}-${index}`,
        ownerId,
        capability,
        `quota-resource-${index}`,
        localDate,
        `2026-09-20T00:00:0${index}.000Z`,
        `2026-09-20T00:00:0${index}.000Z`,
      );
    }
  } finally {
    database.close();
  }
}

async function expectStableQuotaReplay(input: {
  app: FastifyInstance;
  session: string;
  url: string;
  key: string;
  payload: object;
}): Promise<void> {
  const request = {
    method: 'POST' as const,
    url: input.url,
    cookies: { ev_session: input.session },
    headers: { 'idempotency-key': input.key },
    payload: input.payload,
  };
  const first = await input.app.inject(request);
  const replay = await input.app.inject(request);

  expect(first.statusCode).toBe(429);
  expect(first.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  expect(first.headers['retry-after']).toBe(retryAfterSeconds);
  expect(first.headers['idempotency-replayed']).toBeUndefined();
  expect(replay.statusCode).toBe(429);
  expect(replay.json()).toEqual(first.json());
  expect(replay.headers['retry-after']).toBe(retryAfterSeconds);
  expect(replay.headers['idempotency-replayed']).toBe('true');
}

describe('v0.7 daily capability quota replay', () => {
  it('preserves Retry-After for first and replayed assisted workout quota responses', async () => {
    const harness = await createHarness();
    const localDate = '2026-09-20';
    const checkIn = await harness.app.inject({
      method: 'POST',
      url: '/v1/fitness/check-ins',
      cookies: { ev_session: harness.session },
      headers: { 'idempotency-key': 'v07-quota-workout-checkin01' },
      payload: { localDate, sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false },
    });
    expect(checkIn.statusCode).toBe(201);
    seedConsumedQuota(harness.databasePath, harness.ownerId, 'WORKOUT_TEXT_SELECTION', localDate);

    await expectStableQuotaReplay({
      app: harness.app,
      session: harness.session,
      url: '/v1/fitness/workouts',
      key: 'v07-quota-workout-replay01',
      payload: {
        mode: 'ASSISTED',
        checkInId: checkIn.json().data.checkIn.id,
        expectedCheckInVersion: 1,
        goal: 'STRENGTH',
        availableEquipment: [],
        disclosureVersion: 'HEALTH_DISCLOSURE_V1',
        scheduling: {
          targetDate: localDate,
          durationMinutes: 30,
          priority: 'MEDIUM',
          earliestStartLocalTime: null,
          latestEndLocalTime: null,
        },
      },
    });
  });

  it('preserves Retry-After for first and replayed meal parse quota responses', async () => {
    const harness = await createHarness();
    const localDate = '2026-09-21';
    seedConsumedQuota(harness.databasePath, harness.ownerId, 'MEAL_CANDIDATE_PARSE', localDate);

    await expectStableQuotaReplay({
      app: harness.app,
      session: harness.session,
      url: '/v1/nutrition/meal-drafts',
      key: 'v07-quota-meal-parse-replay1',
      payload: {
        mode: 'PARSE_TEXT',
        localDate,
        mealText: 'Fixture Food Alpha 150 g',
        disclosureVersion: 'HEALTH_DISCLOSURE_V1',
      },
    });
  });

  it('preserves Retry-After for first and replayed nutrition lookup quota responses', async () => {
    const harness = await createHarness();
    const localDate = '2026-09-22';
    const draft = await harness.app.inject({
      method: 'POST',
      url: '/v1/nutrition/meal-drafts',
      cookies: { ev_session: harness.session },
      headers: { 'idempotency-key': 'v07-quota-match-draft-key01' },
      payload: {
        mode: 'MANUAL',
        localDate,
        candidates: [{ displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM' }],
      },
    });
    expect(draft.statusCode).toBe(201);
    seedConsumedQuota(harness.databasePath, harness.ownerId, 'NUTRITION_DATA_LOOKUP', localDate);

    await expectStableQuotaReplay({
      app: harness.app,
      session: harness.session,
      url: `/v1/nutrition/meal-drafts/${draft.json().data.draft.id}/matches`,
      key: 'v07-quota-match-replay-key1',
      payload: { expectedVersion: 1, revisionId: draft.json().data.revision.id },
    });
  });
});
