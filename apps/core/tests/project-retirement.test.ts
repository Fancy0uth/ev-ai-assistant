import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createProposalRepository } from '../src/modules/proposals/repository';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};
const proposalId = '00000000-0000-4000-8000-000000001101';
const now = '2026-09-16T00:00:00.000Z';

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

function projectMutationState(databasePath: string, ownerId: string) {
  const database = openDatabase(databasePath);
  try {
    return {
      proposal: database.prepare(
        'select status, version, decided_at from proposals where id = ? and owner_id = ?',
      ).get(proposalId, ownerId),
      audits: database.prepare(
        'select count(*) as count from proposal_audits where proposal_id = ? and owner_id = ?',
      ).get(proposalId, ownerId),
      actions: database.prepare('select count(*) as count from actions where owner_id = ?').get(ownerId),
      timeRequests: database.prepare('select count(*) as count from time_requests where owner_id = ?').get(ownerId),
    };
  } finally {
    database.close();
  }
}

describe('project-analysis retirement composition', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-project-retirement-'));
    databasePath = join(directory, 'app.sqlite');
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('removes project routes, blocks legacy PROJECT acceptance without writes, and keeps ordinary tasks available', async () => {
    app = await buildApp({ databasePath, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const database = openDatabase(databasePath);
    let ownerId: string;
    try {
      ownerId = (database.prepare('select id from owners').get() as { id: string }).id;
      createProposalRepository(database).create({
        id: proposalId,
        ownerId,
        kind: 'PROJECT',
        status: 'PENDING',
        source: 'PROJECT_AGENT',
        title: '历史项目行动',
        changes: [{
          operation: 'CREATE_PROJECT_ACTION',
          brief: {
            id: '00000000-0000-4000-8000-000000001102',
            projectScopeId: '00000000-0000-4000-8000-000000001103',
            expectedBriefVersion: 1,
            snapshotHash: 'a'.repeat(64),
          },
          action: {
            id: '00000000-0000-4000-8000-000000001104',
            title: '不应创建的历史项目行动',
            targetDate: '2026-09-17',
            status: 'OPEN',
            kind: 'WORK',
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
          scheduling: {
            timeRequestId: '00000000-0000-4000-8000-000000001105',
            durationMinutes: 60,
            priority: 'HIGH',
            earliestStartLocalTime: null,
            latestEndLocalTime: null,
            isFixed: false,
          },
        }],
        version: 1,
        createdAt: now,
        expiresAt: null,
      });
    } finally {
      database.close();
    }

    const projectRoutes = await app.inject({ method: 'GET', url: '/v1/projects', cookies: { ev_session: token } });
    expect(projectRoutes.statusCode).toBe(404);

    const beforeAcceptance = projectMutationState(databasePath, ownerId!);
    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/proposals/${proposalId}/decision`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'remove-01-legacy-project-accept' },
      payload: { version: 1, decision: 'ACCEPT' },
    });
    expect(accepted.statusCode).toBe(409);
    expect(accepted.json()).toMatchObject({ error: { code: 'PROJECT_PROPOSAL_RETIRED' } });
    expect(projectMutationState(databasePath, ownerId!)).toEqual(beforeAcceptance);

    const task = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      cookies: { ev_session: token },
      payload: { title: '保留的普通工作任务', area: 'WORK', priority: 'MEDIUM' },
    });
    expect(task.statusCode).toBe(201);
    expect(task.json().data).toMatchObject({ title: '保留的普通工作任务', area: 'WORK' });
  });
});
