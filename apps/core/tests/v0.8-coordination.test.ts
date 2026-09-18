import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { openDatabase } from '../src/storage/database';

const localDate = '2026-09-09';
const timestamp = '2026-09-08T00:00:00.000Z';
const projectRequestId = '00000000-0000-4000-8000-000000000901';
const learningRequestId = '00000000-0000-4000-8000-000000000902';
const fitnessRequestId = '00000000-0000-4000-8000-000000000903';
const lifeRequestId = '00000000-0000-4000-8000-000000000904';

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const token = value?.match(/(?:^|;\s*)ev_session=([^;]+)/)?.[1];
  if (!token) throw new Error('missing synthetic owner session');
  return token;
}

function eventCount(databasePath: string): number {
  const database = openDatabase(databasePath);
  try {
    return (database.prepare('select count(*) as count from events').get() as { count: number }).count;
  } finally {
    database.close();
  }
}

describe('V8-05 LOCAL_RULES coordination', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;
  let ownerId: string;
  let token: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v8-coordination-'));
    databasePath = join(directory, 'app.sqlite');
    app = await buildApp({ databasePath, logger: false });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: 'v8-coordination-owner', password: 'synthetic-coordination-password' },
    });
    ownerId = setup.json().data.owner.id;
    token = tokenFrom(setup.headers['set-cookie']);

    const database = openDatabase(databasePath);
    try {
      const calendar = createCalendarRepository(database);
      calendar.createEvent({
        id: '00000000-0000-4000-8000-000000000900',
        ownerId,
        calendarRuleId: null,
        courseId: null,
        title: 'already confirmed personal block',
        kind: 'PERSONAL',
        localDate,
        startLocalTime: '09:00',
        endLocalTime: '10:00',
        isHard: false,
        status: 'CONFIRMED',
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const requests = [
        {
          id: projectRequestId,
          source: 'PROJECT_AGENT' as const,
          title: 'project priority',
          priority: 'HIGH' as const,
          earliestStartLocalTime: '08:00',
          latestEndLocalTime: '10:00',
        },
        {
          id: learningRequestId,
          source: 'LEARNING_AGENT' as const,
          title: 'learning priority',
          priority: 'HIGH' as const,
          earliestStartLocalTime: '08:00',
          latestEndLocalTime: '10:00',
        },
        {
          id: fitnessRequestId,
          source: 'FITNESS_AGENT' as const,
          title: 'fitness request',
          priority: 'MEDIUM' as const,
          earliestStartLocalTime: '10:00',
          latestEndLocalTime: '12:00',
        },
        {
          id: lifeRequestId,
          source: 'SCHEDULE_COORDINATOR' as const,
          title: 'life request',
          priority: 'LOW' as const,
          earliestStartLocalTime: '10:00',
          latestEndLocalTime: '12:00',
        },
      ];
      for (const request of requests) {
        calendar.createActiveTimeRequest({
          ...request,
          ownerId,
          targetDate: localDate,
          durationMinutes: 60,
          isFixed: false,
          origin: {
            kind: 'ACTION',
            entityId: request.id,
            entityVersion: 1,
          },
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    } finally {
      database.close();
    }
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('orders multi-source requests around every confirmed block, retains one active proposal, and never duplicates an Event after a stale or replayed confirmation', async () => {
    const log = vi.spyOn(app!.log, 'info');
    const first = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/coordinate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v8-coordination-create-000000000001' },
      payload: { localDate, mode: 'LOCAL_RULES' },
    });
    expect(first.statusCode).toBe(201);
    const firstProposal = first.json().data;
    const structured = log.mock.calls.find(([entry]) => typeof entry === 'object' && entry !== null && 'module' in entry && entry.module === 'daily-planning')?.[0];
    expect(structured).toMatchObject({
      requestId: expect.any(String), runId: firstProposal.runId, proposalId: firstProposal.id,
      mode: 'LOCAL_RULES', status: 'PENDING_REVIEW', elapsedMs: expect.any(Number), skippedCount: 1,
    });
    expect(Object.keys(structured as object).sort()).toEqual(['elapsedMs', 'mode', 'module', 'proposalId', 'requestId', 'runId', 'skippedCount', 'status']);
    const serialized = JSON.stringify(structured);
    for (const privateValue of ['project priority', 'learning priority', 'fitness request', 'life request', 'synthetic-coordination-password', token]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(firstProposal).toMatchObject({
      mode: 'LOCAL_RULES',
      status: 'PENDING_REVIEW',
      items: expect.arrayContaining([
        expect.objectContaining({ timeRequestId: projectRequestId, operation: 'SCHEDULE_TIME_REQUEST', startLocalTime: '08:00', endLocalTime: '09:00' }),
        expect.objectContaining({ timeRequestId: learningRequestId, operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE' }),
        expect.objectContaining({ timeRequestId: fitnessRequestId, operation: 'SCHEDULE_TIME_REQUEST', startLocalTime: '10:00', endLocalTime: '11:00' }),
        expect.objectContaining({ timeRequestId: lifeRequestId, operation: 'SCHEDULE_TIME_REQUEST', startLocalTime: '11:00', endLocalTime: '12:00' }),
      ]),
    });
    expect(eventCount(databasePath)).toBe(1);

    const replayedCreation = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/coordinate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v8-coordination-create-000000000001' },
      payload: { localDate, mode: 'LOCAL_RULES' },
    });
    expect(replayedCreation.statusCode).toBe(201);
    expect(replayedCreation.headers['idempotency-replayed']).toBe('true');
    expect(replayedCreation.json().data.id).toBe(firstProposal.id);

    const projectItem = firstProposal.items.find((item: { timeRequestId: string }) => item.timeRequestId === projectRequestId);
    if (!projectItem) throw new Error('missing project coordination item');
    const accepted = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/proposals/${firstProposal.id}/decisions`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v8-coordination-decision-00000000001' },
      payload: {
        expectedProposalVersion: firstProposal.version,
        decisions: [{ itemId: projectItem.id, decision: 'APPLY' }],
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(eventCount(databasePath)).toBe(2);

    const replayedDecision = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/proposals/${firstProposal.id}/decisions`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v8-coordination-decision-00000000001' },
      payload: {
        expectedProposalVersion: firstProposal.version,
        decisions: [{ itemId: projectItem.id, decision: 'APPLY' }],
      },
    });
    expect(replayedDecision.statusCode).toBe(200);
    expect(replayedDecision.headers['idempotency-replayed']).toBe('true');
    expect(eventCount(databasePath)).toBe(2);

    const replacement = await app!.inject({
      method: 'POST',
      url: '/v1/daily-plans/coordinate',
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v8-coordination-create-000000000002' },
      payload: { localDate, mode: 'LOCAL_RULES' },
    });
    expect(replacement.statusCode).toBe(201);
    const replacementProposal = replacement.json().data;
    expect(replacementProposal.id).not.toBe(firstProposal.id);

    const inspection = openDatabase(databasePath);
    try {
      expect(inspection.prepare(`select count(*) as count from daily_plan_proposals
        where owner_id = ? and local_date = ? and status in ('PENDING_REVIEW', 'PARTIALLY_APPLIED')`).get(ownerId, localDate)).toEqual({ count: 1 });
      expect(inspection.prepare('select status from daily_plan_proposals where id = ?').get(firstProposal.id)).toEqual({ status: 'STALE' });
    } finally {
      inspection.close();
    }

    const stale = await app!.inject({
      method: 'POST',
      url: `/v1/daily-plans/proposals/${firstProposal.id}/decisions`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v8-coordination-stale-000000000001' },
      payload: {
        expectedProposalVersion: accepted.json().data.proposal.version,
        decisions: [{ itemId: projectItem.id, decision: 'APPLY' }],
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(eventCount(databasePath)).toBe(2);
  });
});
