import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { VisionCapability } from '../src/modules/providers/capabilities';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

describe('v0.6 local course artifacts', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;

  const validPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v06-course-artifact-'));
    databasePath = join(directory, 'app.sqlite');
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('persists a verified raw PNG locally and creates a blocked local-only import disclosure', async () => {
    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const term = await app.inject({
      method: 'POST',
      url: '/v1/terms',
      cookies: { ev_session: token },
      payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' },
    });

    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/course-artifacts',
      cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' },
      payload: validPng,
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().data.artifact).toMatchObject({
      mediaType: 'image/png', byteSize: validPng.byteLength, width: 1, height: 1,
    });
    const imported = await app.inject({
      method: 'POST',
      url: '/v1/course-imports',
      cookies: { ev_session: token },
      payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data).toMatchObject({
      import: { status: 'BLOCKED_PROVIDER' },
      disclosure: { purpose: '提取课表候选', adapterKind: 'NONE', evidenceKind: 'NONE' },
    });
    expect(JSON.stringify(imported.json())).not.toMatch(/ownerId|storageKey|base64|password|token|session/i);
  });

  it('rejects a declared PNG whose magic bytes are JPEG before persisting metadata', async () => {
    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/course-artifacts',
      cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });

    expect(uploaded.statusCode).toBe(422);
    expect(uploaded.json().error).toMatchObject({ code: 'IMAGE_SIGNATURE_MISMATCH' });
    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select count(*) as count from local_artifacts').get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('keeps a 100% confidence Vision result in REVIEW_REQUIRED until the Owner confirms a saved revision', async () => {
    const priorRunDirectory = process.env.EV_E2E_RUN_DIR;
    const priorFlag = process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS;
    process.env.EV_E2E_RUN_DIR = directory;
    process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS = '1';
    let invalidVisionOutput = false;
    const vision: VisionCapability = {
      descriptor: { providerId: 'production-vision', providerLabel: '受控生产 Vision 测试适配器', adapterKind: 'PRODUCTION_ADAPTER' },
      async extractCourseSchedule() {
        if (invalidVisionOutput) return { candidates: [{ title: 'strict schema must reject this provider output' }] };
        return {
          candidates: [{
            title: '数据库系统', location: null, weekday: 1, startLocalTime: '08:00', endLocalTime: '09:40',
            weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK',
            confidence: { overall: 1, fields: { title: 1, location: 1, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } },
          }],
        };
      },
    };
    const externalTransactionStates: boolean[] = [];
    try {
      app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), visionCapability: vision, courseImportExternalOperationObserver: (inTransaction) => externalTransactionStates.push(inTransaction), logger: false });
      const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
      const token = readSessionToken(setup.headers['set-cookie']);
      const term = await app.inject({ method: 'POST', url: '/v1/terms', cookies: { ev_session: token }, payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' } });
      const uploaded = await app.inject({ method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token }, headers: { 'content-type': 'image/png' }, payload: validPng });
      const imported = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      expect(imported.statusCode).toBe(201);
      expect(imported.json().data).toMatchObject({ disclosure: { adapterKind: 'PRODUCTION_ADAPTER', evidenceKind: 'NONE' } });

      const extracted = await app.inject({
        method: 'POST', url: `/v1/course-imports/${imported.json().data.import.id}/extract`, cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v06-review-high-confidence-01' },
        payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' },
      });

      expect(extracted.statusCode).toBe(202);
      expect(extracted.json().data.import).toMatchObject({ status: 'REVIEW_REQUIRED', currentRevisionId: expect.any(String) });
      expect(extracted.json().data.revision.candidates[0]).toMatchObject({ included: true, confidence: { overall: 1 }, provenance: [{ kind: 'VISION_OUTPUT', capabilityRunId: expect.any(String) }] });
      expect(externalTransactionStates).toEqual([false]);
      const database = openDatabase(databasePath);
      try {
        expect(database.prepare('select count(*) as count from courses').get()).toEqual({ count: 0 });
        expect(database.prepare('select count(*) as count from proposals').get()).toEqual({ count: 0 });
        expect(database.prepare('select evidence_kind, actual_calls from external_capability_runs where id = ?').get(imported.json().data.import.capabilityRunId))
          .toEqual({ evidence_kind: 'REAL_PROVIDER', actual_calls: 1 });
      } finally {
        database.close();
      }

      invalidVisionOutput = true;
      const failedImport = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      const failedExtraction = await app.inject({
        method: 'POST', url: `/v1/course-imports/${failedImport.json().data.import.id}/extract`, cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v06-review-invalid-output-01' },
        payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' },
      });
      expect(failedExtraction.statusCode).toBe(422);
      expect(failedExtraction.json().error.code).toBe('VISION_RESPONSE_INVALID');
      const failedDatabase = openDatabase(databasePath);
      try {
        expect(failedDatabase.prepare('select status, evidence_kind, actual_calls, failure_code from external_capability_runs where id = ?').get(failedImport.json().data.import.capabilityRunId))
          .toEqual({ status: 'FAILED', evidence_kind: 'NONE', actual_calls: 1, failure_code: 'VISION_RESPONSE_INVALID' });
        const storedArtifact = failedDatabase.prepare('select storage_key from local_artifacts where id = ?').get(uploaded.json().data.artifact.id) as { storage_key: string };
        rmSync(join(directory, 'artifacts', storedArtifact.storage_key), { force: true });
      } finally {
        failedDatabase.close();
      }

      const unreadableImport = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      const unreadableExtraction = await app.inject({
        method: 'POST', url: `/v1/course-imports/${unreadableImport.json().data.import.id}/extract`, cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v06-review-artifact-read-01' },
        payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' },
      });
      expect(unreadableExtraction.statusCode).toBe(422);
      expect(unreadableExtraction.json().error.code).toBe('VISION_RESPONSE_INVALID');
      const unreadableDatabase = openDatabase(databasePath);
      try {
        expect(unreadableDatabase.prepare('select status, evidence_kind, actual_calls, failure_code from external_capability_runs where id = ?').get(unreadableImport.json().data.import.capabilityRunId))
          .toEqual({ status: 'FAILED', evidence_kind: 'NONE', actual_calls: 0, failure_code: 'VISION_RESPONSE_INVALID' });
      } finally {
        unreadableDatabase.close();
      }
      expect(externalTransactionStates).toEqual([false, false, false]);
    } finally {
      if (priorRunDirectory === undefined) delete process.env.EV_E2E_RUN_DIR; else process.env.EV_E2E_RUN_DIR = priorRunDirectory;
      if (priorFlag === undefined) delete process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS; else process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS = priorFlag;
    }
  });

  it('persists an excluded Owner revision and replays an identical confirmation without duplicate Course facts', async () => {
    const priorRunDirectory = process.env.EV_E2E_RUN_DIR; const priorFlag = process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS;
    process.env.EV_E2E_RUN_DIR = directory; process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS = '1';
    const vision: VisionCapability = { descriptor: { providerId: 'test-vision', providerLabel: '自动测试 Fake Vision', adapterKind: 'TEST_FAKE' }, async extractCourseSchedule() { return { candidates: [{ title: '数据库系统', location: 'A101', weekday: 1, startLocalTime: '08:00', endLocalTime: '09:40', weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK', confidence: { overall: 1, fields: { title: 1, location: 1, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } } }, { title: '离散数学', location: null, weekday: 2, startLocalTime: '10:00', endLocalTime: '11:40', weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK', confidence: { overall: .9, fields: { title: 1, location: 1, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } } }] }; } };
    try {
      app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), visionCapability: vision, logger: false });
      const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials }); const token = readSessionToken(setup.headers['set-cookie']);
      const term = await app.inject({ method: 'POST', url: '/v1/terms', cookies: { ev_session: token }, payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' } });
      const uploaded = await app.inject({ method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token }, headers: { 'content-type': 'image/png' }, payload: validPng });
      const created = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      const extracted = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/extract`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-extract-01' }, payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' } });
      const reviewed = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/revisions`, cookies: { ev_session: token }, payload: { expectedVersion: 3, parentRevisionId: extracted.json().data.revision.id, candidates: extracted.json().data.revision.candidates.map((candidate: { candidateId: string; title: string; location: string | null; weekday: number; startLocalTime: string; endLocalTime: string; weekStart: number; weekEnd: number; weekPattern: string }, index: number) => ({ candidateId: candidate.candidateId, included: index === 0, title: candidate.title, location: candidate.location, weekday: candidate.weekday, startLocalTime: candidate.startLocalTime, endLocalTime: candidate.endLocalTime, weekStart: candidate.weekStart, weekEnd: candidate.weekEnd, weekPattern: candidate.weekPattern })) } });
      expect(reviewed.statusCode).toBe(201); expect(reviewed.json().data.revision.candidates[1]).toMatchObject({ included: false, provenance: [{ kind: 'VISION_OUTPUT' }, { kind: 'OWNER_EDIT', editedFields: ['included'] }] });
      const body = { expectedVersion: reviewed.json().data.import.version, revisionId: reviewed.json().data.revision.id };
      const first = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/confirm`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-replay-01' }, payload: body });
      const replay = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/confirm`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-replay-01' }, payload: body });
      expect(first.statusCode).toBe(201); expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json());
      const reused = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/confirm`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-replay-01' }, payload: { ...body, expectedVersion: body.expectedVersion + 1 } });
      const duplicate = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/confirm`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-second-01' }, payload: body });
      expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED'); expect(duplicate.json().error.code).toBe('IMPORT_ALREADY_CONFIRMED');
      const proposalId = first.json().data.import.scheduleProposalId as string;
      const accepted = await app.inject({ method: 'POST', url: `/v1/proposals/${proposalId}/decision`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-course-expand-01' }, payload: { version: 1, decision: 'ACCEPT' } });
      const acceptedReplay = await app.inject({ method: 'POST', url: `/v1/proposals/${proposalId}/decision`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-course-expand-01' }, payload: { version: 1, decision: 'ACCEPT' } });
      const today = await app.inject({ method: 'GET', url: '/v1/today?date=2026-09-07', cookies: { ev_session: token } });
      expect(accepted.statusCode).toBe(200); expect(acceptedReplay.json()).toEqual(accepted.json()); expect(today.json().data.events).toMatchObject([{ kind: 'COURSE', courseId: expect.any(String) }]);
      const afterAccept = await app.inject({ method: 'GET', url: `/v1/course-imports/${created.json().data.import.id}`, cookies: { ev_session: token } });
      expect(afterAccept.json().data.import.status).toBe('CONFIRMED');
      const otherToken = 'other-owner-v06-import-token';
      const database = openDatabase(databasePath); try {
        database.pragma('ignore_check_constraints = ON');
        database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('00000000-0000-4000-8000-000000000998', '其他主人', 'unused', '2026-08-17T03:00:00.000Z');
        database.prepare('insert into sessions (id, owner_id, token_hash, expires_at, created_at) values (?, ?, ?, ?, ?)').run('00000000-0000-4000-8000-000000000997', '00000000-0000-4000-8000-000000000998', createHash('sha256').update(otherToken).digest('hex'), '2099-01-01T00:00:00.000Z', '2026-08-17T03:00:00.000Z');
      } finally { database.close(); }
      for (const request of [
        { method: 'GET' as const, url: `/v1/course-imports/${created.json().data.import.id}` },
        { method: 'POST' as const, url: `/v1/course-imports/${created.json().data.import.id}/extract`, headers: { 'idempotency-key': 'v06-other-owner-extract-01' }, payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' } },
        { method: 'POST' as const, url: `/v1/course-imports/${created.json().data.import.id}/revisions`, payload: { expectedVersion: 1, parentRevisionId: reviewed.json().data.revision.id, candidates: [{ candidateId: reviewed.json().data.revision.candidates[0].candidateId, included: true, title: '数据库系统', location: 'A101', weekday: 1, startLocalTime: '08:00', endLocalTime: '09:40', weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK' }] } },
        { method: 'POST' as const, url: `/v1/course-imports/${created.json().data.import.id}/confirm`, headers: { 'idempotency-key': 'v06-other-owner-confirm-01' }, payload: body },
      ]) expect((await app.inject({ ...request, cookies: { ev_session: otherToken } })).statusCode).toBe(404);
      const staleRevision = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/revisions`, cookies: { ev_session: token }, payload: { expectedVersion: 4, parentRevisionId: extracted.json().data.revision.id, candidates: reviewed.json().data.revision.candidates.map((candidate: { candidateId: string; included: boolean; title: string; location: string | null; weekday: number; startLocalTime: string; endLocalTime: string; weekStart: number; weekEnd: number; weekPattern: string }) => ({ candidateId: candidate.candidateId, included: candidate.included, title: candidate.title, location: candidate.location, weekday: candidate.weekday, startLocalTime: candidate.startLocalTime, endLocalTime: candidate.endLocalTime, weekStart: candidate.weekStart, weekEnd: candidate.weekEnd, weekPattern: candidate.weekPattern })) } });
      expect(staleRevision.json().error.code).toBe('VERSION_CONFLICT');
      const finalDatabase = openDatabase(databasePath); try { expect(finalDatabase.prepare('select count(*) as count from courses').get()).toEqual({ count: 1 }); expect(finalDatabase.prepare('select count(*) as count from course_import_entities').get()).toEqual({ count: 1 }); expect(() => finalDatabase.prepare('update course_import_revisions set revision_no = 99 where id = ?').run(extracted.json().data.revision.id)).toThrow(/immutable/); } finally { finalDatabase.close(); }
    } finally { if (priorRunDirectory === undefined) delete process.env.EV_E2E_RUN_DIR; else process.env.EV_E2E_RUN_DIR = priorRunDirectory; if (priorFlag === undefined) delete process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS; else process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS = priorFlag; }
  });
});
