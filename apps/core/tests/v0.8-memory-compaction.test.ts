import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { runMigrations } from '../src/storage/migrations';

const ownerId = '00000000-0000-4000-8000-000000000841';
const token = 'v8-memory-compaction-synthetic-session';
const timestamp = '2026-09-08T00:00:00.000Z';
const legacyContent = '保留段\n\n重复段\n\n重复段\n\n独有段';
const compactedContent = '保留段\n\n重复段\n\n独有段';
const thresholdContent = new Array(2500).fill('重复段落').join('\n\n');

describe('V8-04 LOCAL_RULES memory compaction', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;
  let projectionRoot: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v8-memory-compaction-'));
    databasePath = join(directory, 'app.sqlite');
    projectionRoot = join(directory, 'memory');
    const database = new Database(databasePath);
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database, 24);
      database.prepare(
        'insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)',
      ).run(ownerId, 'v8-compaction-owner', 'synthetic-password-hash', timestamp);
      database.prepare(
        'insert into sessions (id, owner_id, token_hash, expires_at, created_at) values (?, ?, ?, ?, ?)',
      ).run(
        '00000000-0000-4000-8000-000000000842',
        ownerId,
        createHash('sha256').update(token).digest('hex'),
        '2030-01-01T00:00:00.000Z',
        timestamp,
      );
    } finally {
      database.close();
    }
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps current memory unchanged until a LOCAL_RULES draft is accepted, then appends restore history and invalidates deleted drafts', async () => {
    app = await buildApp({ databasePath, memoryProjectionRoot: projectionRoot, logger: false });
    const cookies = { ev_session: token };
    const legacyProjection = join(projectionRoot, 'GENERAL', 'MEMORY.md');

    const initial = await app.inject({
      method: 'PUT', url: '/v1/memory/GENERAL', cookies,
      payload: { content: legacyContent, expectedVersion: null },
    });
    expect(initial.statusCode).toBe(201);
    expect(readFileSync(legacyProjection, 'utf8')).toContain(legacyContent);

    const manual = await app.inject({
      method: 'POST', url: '/v1/memory/compactions', cookies,
      payload: { scopeType: 'DOMAIN', scopeId: 'GENERAL', mode: 'LOCAL_RULES', expectedVersion: 1 },
    });
    expect(manual.statusCode).toBe(201);
    const firstDraft = manual.json().data.draft;
    expect(firstDraft).toMatchObject({
      scopeType: 'DOMAIN', scopeId: 'GENERAL', mode: 'LOCAL_RULES', trigger: 'MANUAL', status: 'PENDING',
      baseVersion: 1, content: compactedContent, inputBytes: Buffer.byteLength(legacyContent, 'utf8'),
      outputBytes: Buffer.byteLength(compactedContent, 'utf8'), byteBudget: 16_384,
    });
    expect(firstDraft.diff).toMatchObject({ kept: expect.any(Array), merged: expect.any(Array) });

    const repeated = await app.inject({
      method: 'POST', url: '/v1/memory/compactions', cookies,
      payload: { scopeType: 'DOMAIN', scopeId: 'GENERAL', mode: 'LOCAL_RULES', expectedVersion: 1 },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data).toMatchObject({ reused: true, draft: { id: firstDraft.id } });
    const unchangedBeforeDecision = await app.inject({ method: 'GET', url: '/v1/memory/entities/DOMAIN/GENERAL', cookies });
    expect(unchangedBeforeDecision.json().data).toMatchObject({ content: legacyContent, version: 1 });
    expect(readFileSync(legacyProjection, 'utf8')).toContain(legacyContent);

    const rejected = await app.inject({
      method: 'POST', url: `/v1/memory/compactions/drafts/${firstDraft.id}/reject`, cookies,
      payload: { expectedDraftVersion: firstDraft.version },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.draft).toMatchObject({ id: firstDraft.id, status: 'REJECTED' });
    expect(readFileSync(legacyProjection, 'utf8')).toContain(legacyContent);

    const reissued = await app.inject({
      method: 'POST', url: '/v1/memory/compactions', cookies,
      payload: { scopeType: 'DOMAIN', scopeId: 'GENERAL', mode: 'LOCAL_RULES', expectedVersion: 1 },
    });
    expect(reissued.statusCode).toBe(201);
    const acceptedDraft = reissued.json().data.draft;

    const confirmed = await app.inject({
      method: 'POST', url: `/v1/memory/compactions/drafts/${acceptedDraft.id}/confirm`, cookies,
      payload: { expectedVersion: 1, expectedDraftVersion: acceptedDraft.version },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data).toMatchObject({
      draft: { id: acceptedDraft.id, status: 'ACCEPTED', resultRevisionVersion: 2 },
      document: { scopeType: 'DOMAIN', scopeId: 'GENERAL', content: compactedContent, version: 2 },
    });
    expect(readFileSync(legacyProjection, 'utf8')).toContain(compactedContent);

    const restored = await app.inject({
      method: 'POST', url: `/v1/memory/compactions/drafts/${acceptedDraft.id}/restore`, cookies,
      payload: { expectedVersion: 2, revisionVersion: 1 },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.document).toMatchObject({ content: legacyContent, version: 3 });
    expect(readFileSync(legacyProjection, 'utf8')).toContain(legacyContent);

    expect(Buffer.byteLength(thresholdContent, 'utf8')).toBeGreaterThanOrEqual(32_768);
    const thresholdWrite = await app.inject({
      method: 'PUT', url: `/v1/memory/entities/FITNESS/${ownerId}`, cookies,
      payload: { content: thresholdContent, expectedVersion: null },
    });
    expect(thresholdWrite.statusCode).toBe(201);
    const thresholdDrafts = await app.inject({
      method: 'GET', url: `/v1/memory/compactions/FITNESS/${ownerId}`, cookies,
    });
    expect(thresholdDrafts.statusCode).toBe(200);
    const thresholdDraft = thresholdDrafts.json().data.items.find((draft: { trigger: string }) => draft.trigger === 'THRESHOLD');
    expect(thresholdDraft).toMatchObject({
      scopeType: 'FITNESS', scopeId: ownerId, mode: 'LOCAL_RULES', trigger: 'THRESHOLD', status: 'PENDING',
      content: '重复段落', byteBudget: 16_384,
    });
    expect(thresholdDraft.inputBytes).toBeGreaterThanOrEqual(32_768);
    expect(thresholdDraft.outputBytes).toBeLessThanOrEqual(thresholdDraft.inputBytes);
    expect(thresholdDraft.outputBytes).toBeLessThanOrEqual(16_384);
    const thresholdCurrent = await app.inject({ method: 'GET', url: `/v1/memory/entities/FITNESS/${ownerId}`, cookies });
    expect(thresholdCurrent.json().data).toMatchObject({ content: thresholdContent, version: 1 });

    const pendingBeforeDelete = await app.inject({
      method: 'POST', url: '/v1/memory/compactions', cookies,
      payload: { scopeType: 'DOMAIN', scopeId: 'GENERAL', mode: 'LOCAL_RULES', expectedVersion: 3 },
    });
    expect(pendingBeforeDelete.statusCode).toBe(201);
    const deletedDraft = pendingBeforeDelete.json().data.draft;
    const removed = await app.inject({
      method: 'DELETE', url: '/v1/memory/GENERAL', cookies,
      payload: { expectedVersion: 3 },
    });
    expect(removed.statusCode).toBe(204);
    expect(existsSync(legacyProjection)).toBe(false);

    const invalidated = await app.inject({
      method: 'GET', url: `/v1/memory/compactions/drafts/${deletedDraft.id}`, cookies,
    });
    expect(invalidated.statusCode).toBe(200);
    expect(invalidated.json().data.draft).toMatchObject({
      status: 'INVALIDATED', content: null, diff: null, sourceRevisions: [], failureCode: 'MEMORY_DELETED',
    });
    const blockedConfirm = await app.inject({
      method: 'POST', url: `/v1/memory/compactions/drafts/${deletedDraft.id}/confirm`, cookies,
      payload: { expectedVersion: 3, expectedDraftVersion: deletedDraft.version },
    });
    expect(blockedConfirm.statusCode).toBe(409);
    expect(blockedConfirm.json()).toMatchObject({ error: { code: 'MEMORY_COMPACTION_DRAFT_UNAVAILABLE' } });
    const blockedRestore = await app.inject({
      method: 'POST', url: `/v1/memory/compactions/drafts/${deletedDraft.id}/restore`, cookies,
      payload: { expectedVersion: 3, revisionVersion: 1 },
    });
    expect(blockedRestore.statusCode).toBe(409);
    expect(blockedRestore.json()).toMatchObject({ error: { code: 'MEMORY_COMPACTION_DRAFT_UNAVAILABLE' } });

    await app.close();
    app = undefined;
    const inspection = new Database(databasePath, { readonly: true });
    try {
      expect(inspection.prepare('select max(version) as version from schema_migrations').get()).toEqual({ version: 26 });
      expect(inspection.prepare('select count(*) as count from memory_compaction_revision_links where draft_id = ?').get(acceptedDraft.id)).toEqual({ count: 2 });
    } finally {
      inspection.close();
    }
  });
});
