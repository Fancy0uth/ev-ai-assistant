import { publicGuidanceFixture } from './public-guidance-fixture';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { expect, it, vi } from 'vitest';
import * as z from 'zod';
import {
  workoutPlanningProfileV2Schema, workoutPlanningCandidateV2Schema, workoutContextPreviewV2Schema,
  workoutDetailedPlanningCapabilityDescriptorSchema, workoutSchema, workoutRevisionV2Schema,
  type PreviewWorkoutContextV2,
} from '@ev/contracts';
import type { WorkoutPlanningProvider } from '@ev/domain';
import { buildApp, type AppOptions } from '../src/app';

it('FIT03e routes enforce Owner and fixture gates and expose strict planning wrappers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fit03e-'));
  let app: FastifyInstance | undefined;
  let calls = 0;
  let secretCalls = 0;
  let ownerId = '';
  const network = vi.fn(async () => { throw new Error('No network permitted'); });
  vi.stubGlobal('fetch', network);
  const provider: WorkoutPlanningProvider = {
    descriptor: { providerId: 'v07-test-fixture', providerLabel: 'Synthetic FIT03e', adapterKind: 'TEST_FIXTURE', evidenceKind: 'AUTOMATED_TEST_FIXTURE' },
    async generateWorkout(owner, input, signal) {
      expect(owner).toBe(ownerId);
      expect(signal.aborted).toBe(false);
      calls++;
      return publicGuidanceFixture(input);
    },
  };
  const options: AppOptions = {
    databasePath: join(root, 'app.sqlite'), artifactRoot: join(root, 'artifacts'), memoryProjectionRoot: join(root, 'memory'), logger: false,
    secretStore: {
      async protect() { secretCalls++; throw new Error('No secrets permitted'); },
      async unprotect() { secretCalls++; throw new Error('No secrets permitted'); },
    },
  };
  const envelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema }).strict();
  const prefix = '/v1/fitness/planning';
  const credentials = { username: 'fit03e-synthetic', password: 'synthetic password for local test only' };
  try {
    app = await buildApp(options);
    for (const [method, path] of [
      ['GET', '/profile'], ['PUT', '/profile'], ['GET', '/capability'], ['GET', '/candidates'], ['GET', '/memory'],
      ['POST', '/context/preview'], ['POST', '/workouts'], ['GET', '/workouts'], ['GET', `/workouts/${randomUUID()}`],
      ['POST', `/workouts/${randomUUID()}/revisions`], ['POST', `/workouts/${randomUUID()}/proposal`], ['POST', `/workouts/${randomUUID()}/feedback`],
    ] as const) {
      expect((await app.inject({ method, url: prefix + path })).statusCode).toBe(401);
    }
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    expect(setup.statusCode).toBe(201);
    ownerId = setup.json().data.owner.id;
    const cookie = String(setup.headers['set-cookie']).split(';')[0]!;
    const headers = { cookie, 'x-owner-id': randomUUID() };
    expect((await app.inject({ method: 'GET', url: prefix + '/profile', cookies: { ev_session: randomUUID() } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: prefix + '/profile', headers })).json()).toEqual({ data: { profile: null } });
    const capability = await app.inject({ method: 'GET', url: prefix + '/capability', headers });
    expect(envelope(workoutDetailedPlanningCapabilityDescriptorSchema).parse(capability.json()).data.availability).toBe('NOT_CONFIGURED');
    const profile = await app.inject({ method: 'PUT', url: prefix + '/profile', headers, payload: {
      expectedVersion: null, profile: { goals: ['STRENGTH'], experience: 'BEGINNER', weeklyTrainingDays: 3,
        availableEquipment: ['MAT', 'CHAIR', 'WALL'], bodyMeasurements: { weight: null, height: null }, fitnessDescription: null, limitations: [], limitationsComplete: true, generalExerciseScope: 'GENERAL_ADULT_19_64_V1' },
    } });
    expect(profile.statusCode).toBe(200);
    expect(envelope(z.object({ profile: workoutPlanningProfileV2Schema.nullable() }).strict()).parse(profile.json()).data.profile?.version).toBe(1);
    const day = new Date().toISOString().slice(0, 10);
    const check = await app.inject({ method: 'POST', url: '/v1/fitness/check-ins', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {
      localDate: day, sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false,
    } });
    expect(check.statusCode).toBe(201);
    const checkInId = check.json().data.checkIn.id as string;
    const candidates = await app.inject({ method: 'GET', url: prefix + `/candidates?checkInId=${checkInId}&goal=STRENGTH`, headers });
    expect(candidates.statusCode).toBe(200);
    const items = envelope(z.object({ items: z.array(workoutPlanningCandidateV2Schema).max(5) }).strict()).parse(candidates.json()).data.items;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect((await app.inject({ method: 'GET', url: prefix + '/memory', headers })).json()).toEqual({ data: { items: [] } });
    const previewInput: PreviewWorkoutContextV2 = { schemaVersion: 'WORKOUT_PLANNING_V2', goal: 'STRENGTH', checkInId,
      expectedCheckInVersion: 1, expectedProfileVersion: 1,
      scheduling: { targetDate: day, durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
      candidateCitationIds: items.slice(0, 3).map(c => c.citationId), authorization: { disclosureVersion: 'HEALTH_DISCLOSURE_V2',
        allowedFields: ['PROFILE_GOALS', 'PROFILE_EQUIPMENT', 'PROFILE_LIMITATIONS', 'CHECK_IN', 'CANDIDATES', 'SCHEDULING'], selectedFitnessMemoryIds: [] } };
    const previewResponse = await app.inject({ method: 'POST', url: prefix + '/context/preview', headers, payload: previewInput });
    expect(previewResponse.statusCode).toBe(200);
    const preview = envelope(workoutContextPreviewV2Schema).parse(previewResponse.json()).data;
    const command = { schemaVersion: previewInput.schemaVersion, goal: previewInput.goal, checkInId, expectedCheckInVersion: 1, expectedProfileVersion: 1,
      scheduling: previewInput.scheduling, disclosureVersion: 'HEALTH_DISCLOSURE_V2', contextHash: preview.contextHash,
      allowedFields: previewInput.authorization.allowedFields, consentedAt: new Date().toISOString() };
    const unavailable = await app.inject({ method: 'POST', url: prefix + '/workouts', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: command });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe('HEALTH_TEXT_PROVIDER_NOT_CONFIGURED');
    expect(calls).toBe(0); expect(secretCalls).toBe(0); expect(network).not.toHaveBeenCalled();
    await app.close(); app = undefined;

    const injection: AppOptions & { workoutPlanningProvider: WorkoutPlanningProvider } = { ...options, workoutPlanningProvider: provider };
    await expect(buildApp(injection)).rejects.toThrow('V07_TEST_FIXTURE_GATE_REJECTED');
    const gated = { ...injection, v07TestAdapterGate: { nodeEnv: 'test' as const, enabled: true as const, runnerDataRoot: root } };
    const invalidDescriptor = { ...provider.descriptor, evidenceKind: 'REAL_PROVIDER' } as unknown as WorkoutPlanningProvider['descriptor'];
    await expect(buildApp({ ...gated, workoutPlanningProvider: { ...provider, descriptor: invalidDescriptor } })).rejects.toThrow('V07_PROVIDER_DESCRIPTOR_REJECTED');
    app = await buildApp(gated);
    // Reopen the same isolated database: login, never create a second Owner.
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: credentials });
    expect(login.statusCode).toBe(200);
    const authenticated = { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-owner-id': randomUUID() };
    expect((await app.inject({ method: 'GET', url: prefix + '/capability', headers: authenticated })).json().data).toMatchObject({ availability: 'READY', adapterKind: 'TEST_FIXTURE', realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' });
    expect((await app.inject({ method: 'POST', url: prefix + '/workouts', headers: authenticated, payload: command })).statusCode).toBe(400);
    const createHeaders = { ...authenticated, 'idempotency-key': randomUUID() };
    const created = await app.inject({ method: 'POST', url: prefix + '/workouts', headers: createHeaders, payload: command });
    expect(created.statusCode).toBe(201);
    const result = envelope(z.object({ workout: workoutSchema, revision: workoutRevisionV2Schema, totalDurationSeconds: z.number().int().positive(), capabilityRunId: z.uuid().nullable() }).strict()).parse(created.json()).data;
    expect(result.totalDurationSeconds).toBe(705);
    const replay = await app.inject({ method: 'POST', url: prefix + '/workouts', headers: createHeaders, payload: command });
    expect(replay.headers['idempotency-replayed']).toBe('true'); expect(replay.json()).toEqual(created.json());
    const detail = await app.inject({ method: 'GET', url: prefix + `/workouts/${result.workout.id}`, headers: authenticated });
    expect(detail.statusCode).toBe(200);
    expect(Object.keys(detail.json().data).sort()).toEqual(['workout', 'revision', 'citations', 'proposal', 'action', 'timeRequest', 'feedback'].sort());
    expect(detail.json().data.citations[0].name).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: prefix + `/workouts/${randomUUID()}`, headers: authenticated })).statusCode).toBe(404);
    const listed = await app.inject({ method: 'GET', url: prefix + '/workouts?page=1&pageSize=20', headers: authenticated });
    expect(listed.json().data).toMatchObject({ items: [{ workout: { id: result.workout.id }, revisionSchema: 'WORKOUT_PLAN_V2' }], pagination: { total: 1, totalPages: 1 } });
    expect((await app.inject({ method: 'GET', url: prefix + '/workouts?pageSize=51', headers: authenticated })).statusCode).toBe(422);
    expect(calls).toBe(1); expect(secretCalls).toBe(0); expect(network).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  }
});
