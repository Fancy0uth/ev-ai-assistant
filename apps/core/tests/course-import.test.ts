import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
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
});
