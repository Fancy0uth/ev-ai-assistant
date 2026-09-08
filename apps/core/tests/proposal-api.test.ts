import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import {
  createProposalRepository,
  type NewProposal,
} from '../src/modules/proposals/repository';
import { createProposalService } from '../src/modules/proposals/service';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};
const termId = '00000000-0000-4000-8000-000000000201';
const ruleId = '00000000-0000-4000-8000-000000000202';
const firstProposalId = '00000000-0000-4000-8000-000000000203';
const rejectedProposalId = '00000000-0000-4000-8000-000000000204';
const now = '2026-08-17T00:00:00.000Z';

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('versioned schedule proposal API', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-proposal-api-'));
    databasePath = join(directory, 'app.sqlite');
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function seedScheduleProposal(id: string, title: string): Promise<string> {
    const database = openDatabase(databasePath);
    try {
      const owner = database.prepare('select id from owners').get() as { id: string };
      const calendar = createCalendarRepository(database);
      if (!calendar.findTerm(owner.id, termId)) {
        calendar.createTerm({
          id: termId,
          ownerId: owner.id,
          title: '2026 秋季学期',
          timezone: 'Asia/Shanghai',
          weekOneMonday: '2026-09-07',
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      const proposal: NewProposal = {
        id,
        ownerId: owner.id,
        kind: 'SCHEDULE',
        status: 'PENDING',
        source: 'COURSE_IMPORT',
        title,
        changes: [
          {
            operation: 'CREATE_CALENDAR_RULE',
            rule: {
              id: id === firstProposalId ? ruleId : '00000000-0000-4000-8000-000000000205',
              termId,
              title,
              weekday: 1,
              startLocalTime: '08:00',
              endLocalTime: '09:40',
              weekStart: 1,
              weekEnd: 16,
              weekPattern: 'EVERY_WEEK',
              isHard: true,
              version: 1,
            },
          },
        ],
        version: 1,
        createdAt: now,
        expiresAt: null,
      };
      createProposalRepository(database).create(proposal);
      return owner.id;
    } finally {
      database.close();
    }
  }

  it('applies an accepted proposal once, exposes the generated event in Day View, and returns latest state for stale approval', async () => {
    app = await buildApp({ databasePath, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    await seedScheduleProposal(firstProposalId, '数据库系统');

    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/proposals/${firstProposalId}/decision`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-proposal-accept-first-01' },
      payload: { version: 1, decision: 'ACCEPT' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data).toMatchObject({
      id: firstProposalId,
      status: 'ACCEPTED',
      version: 2,
    });
    expect(JSON.stringify(accepted.json())).not.toMatch(/ownerId|password|token|session/i);

    const replay = await app.inject({
      method: 'POST',
      url: `/v1/proposals/${firstProposalId}/decision`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-proposal-accept-first-01' },
      payload: { version: 1, decision: 'ACCEPT' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toEqual(accepted.json());

    const day = await app.inject({
      method: 'GET',
      url: '/v1/days/2026-09-07',
      cookies: { ev_session: token },
    });
    expect(day.statusCode).toBe(200);
    expect(day.json().data).toMatchObject({
      date: '2026-09-07',
      events: [
        {
          calendarRuleId: ruleId,
          title: '数据库系统',
          kind: 'COURSE',
          startLocalTime: '08:00',
          endLocalTime: '09:40',
        },
      ],
      pendingProposals: [],
    });

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/proposals/${firstProposalId}/decision`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-proposal-stale-second-01' },
      payload: { version: 1, decision: 'ACCEPT' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(stale.json().error.details.currentProposal).toMatchObject({
      id: firstProposalId,
      status: 'ACCEPTED',
      version: 2,
    });
  });

  it('marks a rejected proposal without materializing its calendar rule or Event', async () => {
    app = await buildApp({ databasePath, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const ownerId = await seedScheduleProposal(rejectedProposalId, '不应进入日程的课程');
    const database = openDatabase(databasePath);
    try {
      database.pragma('ignore_check_constraints = ON');
      database.pragma('foreign_keys = OFF');
      database.prepare(`insert into course_imports_v2 (id, owner_id, term_id, artifact_id, capability_run_id, status, current_revision_id, schedule_proposal_id, confirm_idempotency_key, confirm_request_hash, failure_code, created_at, updated_at, version) values (?, ?, ?, ?, ?, 'SCHEDULE_PROPOSAL_PENDING', null, ?, null, null, null, ?, ?, 1)`)
        .run('00000000-0000-4000-8000-000000000206', ownerId, termId, '00000000-0000-4000-8000-000000000207', '00000000-0000-4000-8000-000000000208', rejectedProposalId, now, now);
    } finally { database.close(); }

    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/proposals/${rejectedProposalId}/decision`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v05-proposal-reject-first-01' },
      payload: { version: 1, decision: 'REJECT' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data).toMatchObject({ status: 'REJECTED', version: 2 });

    const importDatabase = openDatabase(databasePath);
    try { expect(importDatabase.prepare('select status from course_imports_v2 where id = ?').get('00000000-0000-4000-8000-000000000206')).toEqual({ status: 'SCHEDULE_REJECTED' }); } finally { importDatabase.close(); }

    const day = await app.inject({
      method: 'GET',
      url: '/v1/days/2026-09-07',
      cookies: { ev_session: token },
    });
    expect(day.statusCode).toBe(200);
    expect(day.json().data.events).toEqual([]);

    const today = await app.inject({
      method: 'GET',
      url: '/v1/today?date=2026-09-07',
      cookies: { ev_session: token },
    });
    expect(today.statusCode).toBe(200);
    expect(today.json().data.events).toEqual([]);
  });

  it('rejects a mismatched expansion Rule atomically without creating partial Events', async () => {
    app = await buildApp({ databasePath, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const ownerId = await seedScheduleProposal('00000000-0000-4000-8000-000000000209', '先建立学期');
    const database = openDatabase(databasePath);
    try {
      createProposalRepository(database).create({ id: '00000000-0000-4000-8000-000000000210', ownerId, kind: 'SCHEDULE', status: 'PENDING', source: 'COURSE_IMPORT', title: '规则已变化', changes: [{ operation: 'EXPAND_CALENDAR_RULE', calendarRuleId: '00000000-0000-4000-8000-000000000211', expectedRuleVersion: 1 }], version: 1, createdAt: now, expiresAt: null });
    } finally { database.close(); }
    const response = await app.inject({ method: 'POST', url: '/v1/proposals/00000000-0000-4000-8000-000000000210/decision', cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-mismatched-rule-01' }, payload: { version: 1, decision: 'ACCEPT' } });
    expect(response.statusCode).toBe(422); expect(response.json().error.code).toBe('PROPOSAL_CANNOT_APPLY');
    const unchanged = await app.inject({ method: 'GET', url: '/v1/proposals/00000000-0000-4000-8000-000000000210', cookies: { ev_session: token } });
    expect(unchanged.statusCode).toBe(200); expect(unchanged.json().data).toMatchObject({ status: 'PENDING', version: 1 });
    const day = await app.inject({ method: 'GET', url: '/v1/days/2026-09-07', cookies: { ev_session: token } });
    expect(day.json().data.events).toEqual([]);
  });

  it('keeps a Workout Proposal pending when the generic service has no injected Workout applier', async () => {
    app = await buildApp({ databasePath, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    expect(setup.statusCode).toBe(201);
    const database = openDatabase(databasePath);
    try {
      const ownerId = (database.prepare('select id from owners').get() as { id: string }).id;
      const proposalId = '00000000-0000-4000-8000-000000000212';
      const proposalRepository = createProposalRepository(database);
      proposalRepository.create({
        id: proposalId, ownerId, kind: 'WORKOUT', status: 'PENDING', source: 'FITNESS_AGENT', title: '等待训练确认',
        changes: [{
          operation: 'CREATE_WORKOUT_ACTION',
          workout: { workoutId: '00000000-0000-4000-8000-000000000213', revisionId: '00000000-0000-4000-8000-000000000214', expectedWorkoutVersion: 2, contentHash: 'a'.repeat(64) },
          action: { id: '00000000-0000-4000-8000-000000000215', title: '等待训练确认', targetDate: '2026-09-07', status: 'OPEN', kind: 'FITNESS', version: 1, createdAt: now, updatedAt: now },
          scheduling: { timeRequestId: '00000000-0000-4000-8000-000000000216', durationMinutes: 30, priority: 'LOW', earliestStartLocalTime: null, latestEndLocalTime: null, isFixed: false },
          citationIds: ['b'.repeat(64)],
        }],
        version: 1, createdAt: now, expiresAt: null,
      });
      const service = createProposalService(proposalRepository, createCalendarRepository(database));
      expect(() => service.decide(ownerId, proposalId, { version: 1, decision: 'ACCEPT' })).toThrow(/训练提案不可应用/);
      expect(proposalRepository.findById(ownerId, proposalId)).toMatchObject({ status: 'PENDING', version: 1 });
    } finally {
      database.close();
    }
  });
});
