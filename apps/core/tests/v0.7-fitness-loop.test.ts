import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadInternalExerciseCatalog } from '../src/modules/fitness/catalog';
import { buildApp } from '../src/app';

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

describe('v0.7 Fitness review loop', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let session: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v07-fitness-'));
    app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: 'v07-owner', password: 'correct horse battery staple' },
    });
    session = tokenFrom(setup.headers['set-cookie']);
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads eight verified internal catalog records with stable citations', () => {
    const catalog = loadInternalExerciseCatalog();
    expect(catalog.manifest).toMatchObject({
      catalogId: 'ev-ai-internal-starter',
      catalogVersion: '2026.08.31.1',
      itemCount: 8,
      source: { kind: 'FIRST_PARTY_INTERNAL', redistribution: false, medicalClaims: false },
    });
    expect(catalog.items.map((item) => item.exerciseId)).toEqual([
      'bird-dog', 'chair-sit-to-stand', 'dead-bug', 'easy-walk', 'glute-bridge',
      'hip-hinge-practice', 'standing-calf-raise', 'wall-push-up',
    ]);
    expect(catalog.items.every((item) => /^[a-f0-9]{64}$/.test(item.citation.citationId))).toBe(true);
  });

  it('persists safe manual Workout drafts and blocks pain before catalog or provider work', async () => {
    const checkIn = await app!.inject({
      method: 'POST', url: '/v1/fitness/check-ins', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-fitness-checkin-safe-0001' },
      payload: { localDate: '2026-09-01', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false },
    });
    expect(checkIn.statusCode).toBe(201);
    const checkInId = checkIn.json().data.checkIn.id as string;
    const exercises = await app!.inject({ method: 'GET', url: `/v1/fitness/exercises?checkInId=${checkInId}&goal=STRENGTH`, cookies: { ev_session: session } });
    expect(exercises.statusCode).toBe(200);
    const exercise = exercises.json().data.items[0];
    const created = await app!.inject({
      method: 'POST', url: '/v1/fitness/workouts', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-fitness-workout-manual-0001' },
      payload: {
        mode: 'MANUAL', checkInId, expectedCheckInVersion: 1, goal: 'STRENGTH', availableEquipment: [],
        citationIds: [exercise.citation.citationId],
        scheduling: { targetDate: '2026-09-01', durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ workout: { state: 'DRAFT', generationMode: 'MANUAL' }, revision: { items: [{ citation: exercise.citation }] } });
    const replayed = await app!.inject({
      method: 'POST', url: '/v1/fitness/workouts', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-fitness-workout-manual-0001' },
      payload: {
        mode: 'MANUAL', checkInId, expectedCheckInVersion: 1, goal: 'STRENGTH', availableEquipment: [],
        citationIds: [exercise.citation.citationId],
        scheduling: { targetDate: '2026-09-01', durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
      },
    });
    expect(replayed.json()).toEqual(created.json());
    expect(replayed.headers['idempotency-replayed']).toBe('true');

    const blocked = await app!.inject({
      method: 'POST', url: '/v1/fitness/check-ins', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-fitness-checkin-blocked-01' },
      payload: { localDate: '2026-09-02', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: true, acuteRisk: true },
    });
    expect(blocked.statusCode).toBe(201);
    const blockedId = blocked.json().data.checkIn.id as string;
    const blockedExercises = await app!.inject({ method: 'GET', url: `/v1/fitness/exercises?checkInId=${blockedId}`, cookies: { ev_session: session } });
    expect(blockedExercises.json().data).toMatchObject({ safety: { eligibility: 'BLOCKED', notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP' }, items: [] });
    const blockedWorkout = await app!.inject({
      method: 'POST', url: '/v1/fitness/workouts', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-fitness-workout-blocked001' },
      payload: {
        mode: 'ASSISTED', checkInId: blockedId, expectedCheckInVersion: 1, goal: 'STRENGTH', availableEquipment: [], disclosureVersion: 'HEALTH_DISCLOSURE_V1',
        scheduling: { targetDate: '2026-09-02', durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
      },
    });
    expect(blockedWorkout.statusCode).toBe(422);
    expect(blockedWorkout.json()).toMatchObject({ error: { code: 'WORKOUT_BLOCKED_BY_SAFETY' } });
  });

  it('keeps assisted creation fail-closed while no HealthTextProvider is configured', async () => {
    const checkIn = await app!.inject({
      method: 'POST', url: '/v1/fitness/check-ins', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-fitness-checkin-assisted01' },
      payload: { localDate: '2026-09-03', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false },
    });
    const result = await app!.inject({
      method: 'POST', url: '/v1/fitness/workouts', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-fitness-workout-assisted01' },
      payload: {
        mode: 'ASSISTED', checkInId: checkIn.json().data.checkIn.id, expectedCheckInVersion: 1, goal: 'STRENGTH', availableEquipment: [], disclosureVersion: 'HEALTH_DISCLOSURE_V1',
        scheduling: { targetDate: '2026-09-03', durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
      },
    });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toMatchObject({ error: { code: 'HEALTH_TEXT_PROVIDER_NOT_CONFIGURED' } });
  });
});
