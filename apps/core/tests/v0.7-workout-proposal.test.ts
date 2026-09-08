import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

describe('v0.7 Workout Proposal and feedback loop', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let session: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v07-workout-proposal-'));
    app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: { username: 'proposal-owner', password: 'correct horse battery staple' } });
    session = tokenFrom(setup.headers['set-cookie']);
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('materializes one accepted Fitness Action and records exactly one completed feedback outcome', async () => {
    const checkIn = await app!.inject({
      method: 'POST', url: '/v1/fitness/check-ins', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-proposal-checkin-00001' },
      payload: { localDate: '2026-09-04', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false },
    });
    const checkInId = checkIn.json().data.checkIn.id as string;
    const exercises = await app!.inject({ method: 'GET', url: `/v1/fitness/exercises?checkInId=${checkInId}&goal=STRENGTH`, cookies: { ev_session: session } });
    const citationId = exercises.json().data.items[0].citation.citationId as string;
    const created = await app!.inject({
      method: 'POST', url: '/v1/fitness/workouts', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-proposal-workout-00001' },
      payload: {
        mode: 'MANUAL', checkInId, expectedCheckInVersion: 1, goal: 'STRENGTH', availableEquipment: [],
        citationIds: [citationId],
        scheduling: { targetDate: '2026-09-04', durationMinutes: 30, priority: 'MEDIUM', earliestStartLocalTime: null, latestEndLocalTime: null },
      },
    });
    const workout = created.json().data.workout;
    const revision = created.json().data.revision;
    const proposed = await app!.inject({
      method: 'POST', url: `/v1/fitness/workouts/${workout.id}/proposal`, cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-proposal-create-workout01' },
      payload: { expectedVersion: workout.version, revisionId: revision.id },
    });
    expect(proposed.statusCode).toBe(201);
    const proposal = proposed.json().data.proposal;
    expect(proposed.json().data.workout).toMatchObject({ state: 'PROPOSAL_PENDING', proposalId: proposal.id });
    const decided = await app!.inject({
      method: 'POST', url: `/v1/proposals/${proposal.id}/decision`, cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-proposal-decision-accept01' },
      payload: { version: proposal.version, decision: 'ACCEPT' },
    });
    expect(decided.statusCode).toBe(200);
    const accepted = await app!.inject({ method: 'GET', url: `/v1/fitness/workouts/${workout.id}`, cookies: { ev_session: session } });
    expect(accepted.json().data).toMatchObject({ workout: { state: 'ACCEPTED' }, proposal: { id: proposal.id, status: 'ACCEPTED' }, action: { kind: 'FITNESS', status: 'OPEN' }, timeRequest: { lifecycleStatus: 'ACTIVE' } });
    const feedback = await app!.inject({
      method: 'POST', url: `/v1/fitness/workouts/${workout.id}/feedback`, cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-proposal-feedback-complete1' },
      payload: { expectedVersion: accepted.json().data.workout.version, outcome: 'COMPLETED', perceivedEffort: 5, hadPain: false, note: null, startedAt: '2026-09-04T10:00:00.000Z', endedAt: '2026-09-04T10:25:00.000Z' },
    });
    expect(feedback.statusCode).toBe(201);
    expect(feedback.json().data).toMatchObject({ workout: { state: 'COMPLETED' }, activitySession: { kind: 'WORKOUT' }, safetyNotice: null });
    const completed = await app!.inject({ method: 'GET', url: `/v1/fitness/workouts/${workout.id}`, cookies: { ev_session: session } });
    expect(completed.json().data).toMatchObject({ workout: { state: 'COMPLETED' }, action: { status: 'DONE' }, timeRequest: { lifecycleStatus: 'CLOSED', closedReason: 'COMPLETED' }, feedback: { outcome: 'COMPLETED' } });
    const replayed = await app!.inject({
      method: 'POST', url: `/v1/fitness/workouts/${workout.id}/feedback`, cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-proposal-feedback-complete1' },
      payload: { expectedVersion: accepted.json().data.workout.version, outcome: 'COMPLETED', perceivedEffort: 5, hadPain: false, note: null, startedAt: '2026-09-04T10:00:00.000Z', endedAt: '2026-09-04T10:25:00.000Z' },
    });
    expect(replayed.json()).toEqual(feedback.json());

    const skippedDraft = await app!.inject({
      method: 'POST', url: '/v1/fitness/workouts', cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-proposal-workout-skip-01' },
      payload: { mode: 'MANUAL', checkInId, expectedCheckInVersion: 1, goal: 'RECOVERY', availableEquipment: [], citationIds: [citationId], scheduling: { targetDate: '2026-09-04', durationMinutes: 30, priority: 'LOW', earliestStartLocalTime: null, latestEndLocalTime: null } },
    });
    const skippedWorkout = skippedDraft.json().data.workout;
    const skippedRevision = skippedDraft.json().data.revision;
    const skippedProposal = await app!.inject({ method: 'POST', url: `/v1/fitness/workouts/${skippedWorkout.id}/proposal`, cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-proposal-create-skip-001' }, payload: { expectedVersion: skippedWorkout.version, revisionId: skippedRevision.id } });
    await app!.inject({ method: 'POST', url: `/v1/proposals/${skippedProposal.json().data.proposal.id}/decision`, cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-proposal-decision-skip01' }, payload: { version: 1, decision: 'ACCEPT' } });
    const acceptedSkipped = await app!.inject({ method: 'GET', url: `/v1/fitness/workouts/${skippedWorkout.id}`, cookies: { ev_session: session } });
    const skipped = await app!.inject({
      method: 'POST', url: `/v1/fitness/workouts/${skippedWorkout.id}/feedback`, cookies: { ev_session: session },
      headers: { 'idempotency-key': 'v07-proposal-feedback-skipped01' },
      payload: { expectedVersion: acceptedSkipped.json().data.workout.version, outcome: 'SKIPPED', perceivedEffort: null, hadPain: true, note: '今天状态不适合继续。', startedAt: null, endedAt: null },
    });
    expect(skipped.statusCode).toBe(201);
    expect(skipped.json().data).toMatchObject({ workout: { state: 'SKIPPED' }, action: { status: 'CANCELLED' }, activitySession: null, safetyNotice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP' });
  });

  it('rejects a pending Workout Proposal without materializing an Action or TimeRequest', async () => {
    const checkIn = await app!.inject({ method: 'POST', url: '/v1/fitness/check-ins', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-reject-checkin-0000001' }, payload: { localDate: '2026-09-05', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false } });
    const checkInId = checkIn.json().data.checkIn.id as string;
    const exercises = await app!.inject({ method: 'GET', url: `/v1/fitness/exercises?checkInId=${checkInId}`, cookies: { ev_session: session } });
    const draft = await app!.inject({ method: 'POST', url: '/v1/fitness/workouts', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-reject-workout-000001' }, payload: { mode: 'MANUAL', checkInId, expectedCheckInVersion: 1, goal: 'RECOVERY', availableEquipment: [], citationIds: [exercises.json().data.items[0].citation.citationId], scheduling: { targetDate: '2026-09-05', durationMinutes: 30, priority: 'LOW', earliestStartLocalTime: null, latestEndLocalTime: null } } });
    const proposal = await app!.inject({ method: 'POST', url: `/v1/fitness/workouts/${draft.json().data.workout.id}/proposal`, cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-reject-proposal-000001' }, payload: { expectedVersion: 1, revisionId: draft.json().data.revision.id } });
    const rejected = await app!.inject({ method: 'POST', url: `/v1/proposals/${proposal.json().data.proposal.id}/decision`, cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-reject-decision-000001' }, payload: { version: 1, decision: 'REJECT' } });
    expect(rejected.statusCode).toBe(200);
    const detail = await app!.inject({ method: 'GET', url: `/v1/fitness/workouts/${draft.json().data.workout.id}`, cookies: { ev_session: session } });
    expect(detail.json().data).toMatchObject({ workout: { state: 'REJECTED' }, proposal: { status: 'REJECTED' }, action: null, timeRequest: null, feedback: null });
  });
});
