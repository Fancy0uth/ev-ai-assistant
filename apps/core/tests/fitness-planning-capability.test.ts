import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  type HealthTextProvider,
  healthCapabilitiesResponseSchema,
  healthCapabilityKindSchema,
  healthDisclosureVersionSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/modules/auth/password';
import { createV07HealthLoopRepository } from '../src/modules/health-loop/repository';
import { latestSchemaVersion, runMigrations } from '../src/storage/migrations';

const applications: FastifyInstance[] = [];
const directories: string[] = [];
const ownerId = 'f103c001-0918-4000-8000-000000000029';
const password = 'correct horse battery staple';
const localDate = '2026-09-18';
const timestamp = '2026-09-18T08:00:00.000Z';
const hash = (character: string) => character.repeat(64);

afterEach(async () => {
  while (applications.length > 0) await applications.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

async function createLegacyDatabase(databasePath: string): Promise<void> {
  const database = new Database(databasePath);
  try {
    database.pragma('foreign_keys = ON');
    runMigrations(database, 28);
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'fit03c-owner', await hashPassword(password), timestamp);
    database.prepare(`insert into signals (id, owner_id, local_date, kind, value, source, version, created_at, updated_at)
      values ('fit03c-signal', ?, ?, 'RECOVERY', 80, 'CHECK_IN', 1, ?, ?)`)
      .run(ownerId, localDate, timestamp, timestamp);
    database.prepare(`insert into fitness_check_ins_v2 (
      id, owner_id, local_date, sleep_minutes, energy_level, discomfort_level, has_pain, acute_risk,
      signal_id, recovery_json, safety_json, policy_version, version, created_at
    ) values ('fit03c-check-in', ?, ?, 480, 5, 0, 0, 0, 'fit03c-signal', '{}', '{}', 'WORKOUT_SAFETY_V1', 1, ?)`)
      .run(ownerId, localDate, timestamp);
    database.prepare(`insert into workouts_v2 (
      id, owner_id, check_in_id, signal_id, generation_mode, state, current_revision_id,
      proposal_id, action_id, time_request_id, feedback_id, version, created_at, updated_at
    ) values ('fit03c-workout', ?, 'fit03c-check-in', 'fit03c-signal', 'ASSISTED', 'DRAFT', null,
      null, null, null, null, 1, ?, ?)`)
      .run(ownerId, timestamp, timestamp);
    database.prepare(`insert into v07_capability_runs (
      id, owner_id, capability, operation, resource_id, provider_id, provider_label, adapter_kind,
      evidence_kind, disclosure_json, disclosure_version, state, policy_version, local_date,
      actual_calls, app_version, created_at, updated_at, version
    ) values ('fit03c-legacy-run', ?, 'WORKOUT_TEXT_SELECTION', 'fitness.workout.create', 'fit03c-check-in',
      null, 'Not configured', 'NONE', 'NONE', '{"disclosureVersion":"HEALTH_DISCLOSURE_V1"}',
      'HEALTH_DISCLOSURE_V1', 'SUCCEEDED', 'HEALTH_CAPABILITY_POLICY_V1', ?, 1, '0.7.0', ?, ?, 1)`)
      .run(ownerId, localDate, timestamp, timestamp);
    database.prepare(`insert into workout_revisions_v2 (
      id, owner_id, workout_id, parent_revision_id, revision_no, title, rationale, plan_json,
      catalog_id, catalog_version, catalog_hash, content_hash, created_by, capability_run_id, created_at
    ) values ('fit03c-legacy-revision', ?, 'fit03c-workout', null, 1, 'Legacy workout', 'Synthetic legacy source reference.', '{}',
      'ev-ai-internal-starter', '2026.08.31.1', ?, ?, 'MODEL', 'fit03c-legacy-run', ?)`)
      .run(ownerId, hash('a'), hash('b'), timestamp);
    database.prepare(`update workouts_v2 set current_revision_id = 'fit03c-legacy-revision' where id = 'fit03c-workout'`).run();
  } finally {
    database.close();
  }
}

async function login(application: FastifyInstance): Promise<string> {
  const response = await application.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { username: 'fit03c-owner', password },
  });
  expect(response.statusCode).toBe(200);
  return tokenFrom(response.headers['set-cookie']);
}

it('FIT03c preserves legacy source provenance and enforces one V1/V2 workout budget', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ev-fit03c-capability-'));
  directories.push(directory);
  const databasePath = join(directory, 'app.sqlite');
  await createLegacyDatabase(databasePath);

  const database = new Database(databasePath);
  try {
    database.pragma('foreign_keys = ON');
    runMigrations(database);

    expect(latestSchemaVersion()).toBe(29);
    expect(database.prepare('select version, name from schema_migrations where version = 29').get()).toEqual({
      version: 29,
      name: 'add_v2_workout_capability_runs',
    });
    expect(database.prepare(`select capability, disclosure_version as disclosureVersion, actual_calls as actualCalls
      from v07_capability_runs where id = 'fit03c-legacy-run'`).get()).toEqual({
      capability: 'WORKOUT_TEXT_SELECTION', disclosureVersion: 'HEALTH_DISCLOSURE_V1', actualCalls: 1,
    });
    expect(database.prepare(`select capability_run_id as capabilityRunId from workout_revisions_v2
      where id = 'fit03c-legacy-revision'`).get()).toEqual({ capabilityRunId: 'fit03c-legacy-run' });
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([]);
    expect(database.prepare(`select name from sqlite_master where type = 'index'
      and name = 'v07_capability_runs_owner_date_capability_idx'`).get()).toEqual({ name: 'v07_capability_runs_owner_date_capability_idx' });
    expect(database.prepare(`select name from sqlite_master where type = 'index'
      and name = 'v07_capability_runs_owner_idempotency_idx'`).get()).toEqual({ name: 'v07_capability_runs_owner_idempotency_idx' });
    expect(database.prepare(`select name from sqlite_master where type = 'index'
      and name = 'v07_capability_runs_v21_id_owner_uidx'`).get()).toEqual({ name: 'v07_capability_runs_v21_id_owner_uidx' });
    expect(database.prepare(`select name from sqlite_master where type = 'trigger'
      and name = 'v07_capability_runs_v21_owner_immutable'`).get()).toEqual({ name: 'v07_capability_runs_v21_owner_immutable' });
    expect(database.prepare(`select name from sqlite_master where type = 'trigger'
      and name = 'workout_revisions_v2_v21_owner_insert'`).get()).toEqual({ name: 'workout_revisions_v2_v21_owner_insert' });
    expect(() => database.prepare(`update v07_capability_runs set owner_id = 'other-owner'
      where id = 'fit03c-legacy-run'`).run()).toThrow('v0.7 owner lineage violation');

    expect(healthCapabilityKindSchema.safeParse('WORKOUT_DETAILED_PLANNING').success).toBe(true);
    expect(healthDisclosureVersionSchema.safeParse('HEALTH_DISCLOSURE_V2').success).toBe(true);
    const unavailable = {
      providerId: null,
      providerLabel: 'Not configured',
      adapterKind: 'NONE' as const,
      evidenceKind: 'NONE' as const,
      availability: 'NOT_CONFIGURED' as const,
      disclosureVersion: 'HEALTH_DISCLOSURE_V1' as const,
      policyVersion: 'HEALTH_CAPABILITY_POLICY_V1' as const,
      realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' as const,
    };
    expect(healthCapabilitiesResponseSchema.safeParse({
      data: [
        { ...unavailable, capability: 'WORKOUT_TEXT_SELECTION' },
        { ...unavailable, capability: 'MEAL_CANDIDATE_PARSE' },
        { ...unavailable, capability: 'NUTRITION_DATA_LOOKUP' },
      ],
    }).success).toBe(true);
    expect(healthCapabilitiesResponseSchema.safeParse({
      data: [
        { ...unavailable, capability: 'WORKOUT_TEXT_SELECTION' },
        { ...unavailable, capability: 'MEAL_CANDIDATE_PARSE' },
        { ...unavailable, capability: 'NUTRITION_DATA_LOOKUP' },
        { ...unavailable, capability: 'WORKOUT_DETAILED_PLANNING', disclosureVersion: 'HEALTH_DISCLOSURE_V2' },
      ],
    }).success).toBe(false);

    const repository = createV07HealthLoopRepository(database);
    const disclosure = {
      disclosureVersion: 'HEALTH_DISCLOSURE_V2',
      contextHash: hash('c'),
      allowedFields: ['profile.goal', 'scheduling.durationMinutes'],
    };
    for (const index of [0, 1, 2, 3]) {
      repository.createClaimedCapabilityRun({
        id: `fit03c-v2-run-${index}`,
        ownerId,
        capability: 'WORKOUT_DETAILED_PLANNING',
        operation: 'fitness.workout.create',
        resourceId: `fit03c-v2-workout-${index}`,
        providerId: 'v07-test-fixture',
        providerLabel: 'Synthetic FIT03c provider',
        adapterKind: 'TEST_FIXTURE',
        disclosure,
        disclosureVersion: 'HEALTH_DISCLOSURE_V2',
        localDate,
        appVersion: '0.7.0',
        idempotencyKey: `fit03c-v2-key-${index}`,
        requestHash: hash('d'),
        leaseToken: `fit03c-v2-lease-${index}`,
        leaseExpiresAt: '2026-09-18T08:00:08.000Z',
        deadlineAt: '2026-09-18T08:00:08.000Z',
        createdAt: timestamp,
      });
    }
    const persistedV2Run = database.prepare(`select disclosure_version as disclosureVersion, disclosure_json as disclosureJson,
      idempotency_key as idempotencyKey, request_hash as requestHash, lease_token as leaseToken
      from v07_capability_runs where id = 'fit03c-v2-run-0'`).get() as {
      disclosureVersion: string;
      disclosureJson: string;
      idempotencyKey: string;
      requestHash: string;
      leaseToken: string;
    };
    expect({ ...persistedV2Run, disclosureJson: JSON.parse(persistedV2Run.disclosureJson) }).toEqual({
      disclosureVersion: 'HEALTH_DISCLOSURE_V2',
      disclosureJson: disclosure,
      idempotencyKey: 'fit03c-v2-key-0',
      requestHash: hash('d'),
      leaseToken: 'fit03c-v2-lease-0',
    });
    expect(repository.findCapabilityRun(ownerId, 'fit03c-v2-run-0')).toMatchObject({
      capability: 'WORKOUT_DETAILED_PLANNING',
      disclosureVersion: 'HEALTH_DISCLOSURE_V2',
      reservedCalls: 1,
    });
    expect(repository.countReservedWorkoutCalls(ownerId, localDate)).toBe(5);
  } finally {
    database.close();
  }

  const unavailableApplication = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), logger: false });
  applications.push(unavailableApplication);
  const unavailableSession = await login(unavailableApplication);
  const safeCheckIn = await unavailableApplication.inject({
    method: 'POST',
    url: '/v1/fitness/check-ins',
    cookies: { ev_session: unavailableSession },
    headers: { 'idempotency-key': 'fit03c-safe-check-in' },
    payload: { localDate, sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false },
  });
  expect(safeCheckIn.statusCode).toBe(201);
  const safeCheckInId = safeCheckIn.json().data.checkIn.id as string;
  const unavailableResponse = await unavailableApplication.inject({
    method: 'POST',
    url: '/v1/fitness/workouts',
    cookies: { ev_session: unavailableSession },
    headers: { 'idempotency-key': 'fit03c-unavailable-provider' },
    payload: {
      mode: 'ASSISTED', checkInId: safeCheckInId, expectedCheckInVersion: 1, goal: 'STRENGTH', availableEquipment: [],
      disclosureVersion: 'HEALTH_DISCLOSURE_V1',
      scheduling: { targetDate: localDate, durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
    },
  });
  expect(unavailableResponse.statusCode).toBe(503);
  expect(unavailableResponse.json()).toMatchObject({ error: { code: 'HEALTH_TEXT_PROVIDER_NOT_CONFIGURED' } });
  await unavailableApplication.close();
  applications.splice(applications.indexOf(unavailableApplication), 1);

  let providerCalls = 0;
  const provider: HealthTextProvider = {
    descriptor: {
      providerId: 'v07-test-fixture', providerLabel: 'Synthetic FIT03c provider',
      adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE',
    },
    async selectWorkout() {
      providerCalls += 1;
      throw new Error('the sixth call must be rejected before Provider use');
    },
    async parseMealCandidates() {
      throw new Error('not used');
    },
  };
  const quotaApplication = await buildApp({
    databasePath,
    artifactRoot: join(directory, 'artifacts'),
    logger: false,
    healthTextProvider: provider,
    v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: directory },
  });
  applications.push(quotaApplication);
  const quotaSession = await login(quotaApplication);
  const quotaResponse = await quotaApplication.inject({
    method: 'POST',
    url: '/v1/fitness/workouts',
    cookies: { ev_session: quotaSession },
    headers: { 'idempotency-key': 'fit03c-v1-sixth-call' },
    payload: {
      mode: 'ASSISTED', checkInId: safeCheckInId, expectedCheckInVersion: 1, goal: 'STRENGTH', availableEquipment: [],
      disclosureVersion: 'HEALTH_DISCLOSURE_V1',
      scheduling: { targetDate: localDate, durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
    },
  });
  expect(quotaResponse.statusCode).toBe(429);
  expect(quotaResponse.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  expect(providerCalls).toBe(0);
});
