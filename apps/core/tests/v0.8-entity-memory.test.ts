import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { runMigrations } from '../src/storage/migrations';

const ownerId = '00000000-0000-4000-8000-000000000803';
const foreignOwnerId = '00000000-0000-4000-8000-000000000804';
const projectScopeId = '00000000-0000-4000-8000-000000000805';
const courseId = '00000000-0000-4000-8000-000000000806';
const token = 'v8-entity-memory-synthetic-session';
const timestamp = '2026-09-08T00:00:00.000Z';
const legacyScopes = ['GENERAL', 'FITNESS', 'LEARNING', 'PROJECT'] as const;

describe('V8-03 entity memory compatibility', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;
  let projectionRoot: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v8-entity-memory-'));
    databasePath = join(directory, 'app.sqlite');
    projectionRoot = join(directory, 'memory');

    const database = new Database(databasePath);
    try {
      database.pragma('foreign_keys = ON');
      runMigrations(database, 22);
      database.prepare(
        'insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)',
      ).run(ownerId, 'v8-entity-owner', 'synthetic-password-hash', timestamp);
      database.prepare(
        'insert into sessions (id, owner_id, token_hash, expires_at, created_at) values (?, ?, ?, ?, ?)',
      ).run(
        '00000000-0000-4000-8000-000000000807',
        ownerId,
        createHash('sha256').update(token).digest('hex'),
        '2030-01-01T00:00:00.000Z',
        timestamp,
      );
      database.prepare(
        'insert into project_scopes (id, owner_id, label, root_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      ).run(projectScopeId, ownerId, 'Synthetic v22 project', 'C:/synthetic/entity-memory-project', timestamp, timestamp);
      database.prepare(
        'insert into terms (id, owner_id, title, timezone, week_one_monday, version, created_at, updated_at) values (?, ?, ?, ?, ?, 1, ?, ?)',
      ).run('00000000-0000-4000-8000-000000000808', ownerId, 'Synthetic term', 'Asia/Shanghai', '2026-09-07', timestamp, timestamp);
      database.prepare(
        'insert into courses (id, owner_id, term_id, title, course_code, official_url, version, created_at, updated_at) values (?, ?, ?, ?, null, null, 1, ?, ?)',
      ).run(courseId, ownerId, '00000000-0000-4000-8000-000000000808', 'Synthetic course', timestamp, timestamp);
      const insertDocument = database.prepare(
        'insert into memory_documents (owner_id, scope, content, version, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
      );
      const insertRevision = database.prepare(
        'insert into memory_revisions (id, owner_id, scope, content, version, created_at) values (?, ?, ?, ?, 1, ?)',
      );
      for (const scope of legacyScopes) {
        const content = `v22 ${scope} memory`;
        insertDocument.run(ownerId, scope, content, timestamp, timestamp);
        insertRevision.run(`00000000-0000-4000-8000-0000000008${legacyScopes.indexOf(scope) + 9}`, ownerId, scope, content, timestamp);
      }
    } finally {
      database.close();
    }
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('upgrades a v22 four-domain database while appending isolated entity revisions and refusing a cross-owner identity', async () => {
    app = await buildApp({ databasePath, memoryProjectionRoot: projectionRoot, logger: false });
    const cookies = { ev_session: token };

    const legacyDocuments = await app.inject({ method: 'GET', url: '/v1/memory', cookies });
    expect(legacyDocuments.statusCode).toBe(200);
    expect(legacyDocuments.json().data).toEqual(expect.arrayContaining(
      legacyScopes.map((scope) => expect.objectContaining({ scope, content: `v22 ${scope} memory`, version: 1 })),
    ));
    for (const scope of legacyScopes) {
      const revisions = await app.inject({ method: 'GET', url: `/v1/memory/${scope}/revisions`, cookies });
      expect(revisions.statusCode, revisions.body).toBe(200);
      expect(revisions.json().data).toEqual([expect.objectContaining({ scope, content: `v22 ${scope} memory`, version: 1 })]);
    }

    const domainAdapter = await app.inject({ method: 'GET', url: '/v1/memory/entities/DOMAIN/FITNESS', cookies });
    expect(domainAdapter.statusCode).toBe(200);
    expect(domainAdapter.json().data).toMatchObject({
      scopeType: 'DOMAIN', scopeId: 'FITNESS', content: 'v22 FITNESS memory', version: 1,
    });

    const initial = await app.inject({
      method: 'PUT', url: `/v1/memory/entities/PROJECT/${projectScopeId}`, cookies,
      payload: { content: '项目实体的第一版记忆。', expectedVersion: null },
    });
    expect(initial.statusCode).toBe(201);
    expect(initial.json().data).toMatchObject({
      scopeType: 'PROJECT', scopeId: projectScopeId, content: '项目实体的第一版记忆。', version: 1,
    });

    const course = await app.inject({
      method: 'PUT', url: `/v1/memory/entities/COURSE/${courseId}`, cookies,
      payload: { content: '课程实体记忆。', expectedVersion: null },
    });
    expect(course.statusCode).toBe(201);
    const fitness = await app.inject({
      method: 'PUT', url: `/v1/memory/entities/FITNESS/${ownerId}`, cookies,
      payload: { content: '训练实体记忆。', expectedVersion: null },
    });
    expect(fitness.statusCode).toBe(201);
    const nutrition = await app.inject({
      method: 'PUT', url: `/v1/memory/entities/NUTRITION/${ownerId}`, cookies,
      payload: { content: '饮食实体记忆。', expectedVersion: null },
    });
    expect(nutrition.statusCode).toBe(201);
    const daily = await app.inject({
      method: 'PUT', url: '/v1/memory/entities/DAILY/2026-09-08', cookies,
      payload: { content: '每日实体记忆。', expectedVersion: null },
    });
    expect(daily.statusCode).toBe(201);

    const firstRevisions = await app.inject({
      method: 'GET', url: `/v1/memory/entities/PROJECT/${projectScopeId}/revisions`, cookies,
    });
    expect(firstRevisions.statusCode).toBe(200);
    const firstRevision = firstRevisions.json().data[0];
    expect(firstRevision).toMatchObject({
      version: 1, source: 'WRITE', parentRevisionId: null, sourceRevisionId: null,
      expectedVersion: null, contentBytes: Buffer.byteLength('项目实体的第一版记忆。', 'utf8'),
    });

    const edited = await app.inject({
      method: 'PUT', url: `/v1/memory/entities/PROJECT/${projectScopeId}`, cookies,
      payload: { content: '项目实体的第二版记忆。', expectedVersion: 1 },
    });
    expect(edited.statusCode).toBe(200);
    const revisionsAfterEdit = await app.inject({
      method: 'GET', url: `/v1/memory/entities/PROJECT/${projectScopeId}/revisions`, cookies,
    });
    const secondRevision = revisionsAfterEdit.json().data.find((revision: { version: number }) => revision.version === 2);
    expect(secondRevision).toMatchObject({
      version: 2, source: 'WRITE', parentRevisionId: firstRevision.id, sourceRevisionId: firstRevision.id,
      expectedVersion: 1, contentBytes: Buffer.byteLength('项目实体的第二版记忆。', 'utf8'),
    });

    const restored = await app.inject({
      method: 'POST', url: `/v1/memory/entities/PROJECT/${projectScopeId}/restore`, cookies,
      payload: { expectedVersion: 2, revisionVersion: 1 },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data).toMatchObject({ content: '项目实体的第一版记忆。', version: 3 });
    const revisionsAfterRestore = await app.inject({
      method: 'GET', url: `/v1/memory/entities/PROJECT/${projectScopeId}/revisions`, cookies,
    });
    const restoredRevision = revisionsAfterRestore.json().data.find((revision: { version: number }) => revision.version === 3);
    expect(restoredRevision).toMatchObject({
      version: 3, source: 'RESTORE', parentRevisionId: secondRevision.id, sourceRevisionId: firstRevision.id,
      expectedVersion: 2,
    });

    const projection = join(
      projectionRoot,
      'entities',
      createHash('sha256').update(ownerId).digest('hex'),
      'PROJECT',
      createHash('sha256').update(projectScopeId).digest('hex'),
      'MEMORY.md',
    );
    expect(readFileSync(projection, 'utf8')).toContain('项目实体的第一版记忆。');
    expect(existsSync(join(projectionRoot, 'entities', ownerId))).toBe(false);

    const crossOwner = await app.inject({
      method: 'PUT', url: `/v1/memory/entities/FITNESS/${foreignOwnerId}`, cookies,
      payload: { content: '不得写入其他 Owner 的实体。', expectedVersion: null },
    });
    expect(crossOwner.statusCode).toBe(404);
    expect(crossOwner.json()).toMatchObject({ error: { code: 'MEMORY_ENTITY_SCOPE_NOT_FOUND' } });

    const deleted = await app.inject({
      method: 'DELETE', url: `/v1/memory/entities/PROJECT/${projectScopeId}`, cookies,
      payload: { expectedVersion: 3 },
    });
    expect(deleted.statusCode).toBe(204);
    expect(existsSync(projection)).toBe(false);
    const deletedRevisions = await app.inject({
      method: 'GET', url: `/v1/memory/entities/PROJECT/${projectScopeId}/revisions`, cookies,
    });
    expect(deletedRevisions.json().data).toEqual([]);
    const forbiddenRestore = await app.inject({
      method: 'POST', url: `/v1/memory/entities/PROJECT/${projectScopeId}/restore`, cookies,
      payload: { expectedVersion: 3, revisionVersion: 1 },
    });
    expect(forbiddenRestore.statusCode).toBe(404);
    expect(forbiddenRestore.json()).toMatchObject({ error: { code: 'MEMORY_REVISION_NOT_FOUND' } });

    await app.close();
    app = undefined;
    const inspection = new Database(databasePath, { readonly: true });
    try {
      expect(inspection.prepare('select version from schema_migrations where version = 24').get()).toEqual({ version: 24 });
      expect(inspection.prepare('select max(version) as version from schema_migrations').get()).toEqual({ version: 26 });
      expect(inspection.prepare('select count(*) as count from entity_memory_documents where scope_type = ? and scope_id = ?').get('PROJECT', projectScopeId)).toEqual({ count: 0 });
      expect(inspection.prepare('select count(*) as count from entity_memory_revisions where scope_type = ? and scope_id = ?').get('PROJECT', projectScopeId)).toEqual({ count: 0 });
    } finally {
      inspection.close();
    }
  });
});
