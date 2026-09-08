import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createProjectScopeService } from '../src/modules/projects/scope-service';

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

describe('explicit read-only project scopes', () => {
  let app: FastifyInstance | undefined;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-project-scopes-'));
    writeFileSync(join(directory, 'PRD.md'), '# Project plan\n\nBuild an assistant.');
    writeFileSync(join(directory, 'TASKS.md'), '# Tasks\n\n- [ ] Read the plan');
    writeFileSync(join(directory, '.env'), 'SECRET_MUST_NEVER_BE_EXPOSED=true');
  });
  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('registers an explicit local root and only snapshots allowlisted planning files', async () => {
    app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: { username: '项目主人', password: 'correct horse battery staple' } });
    const token = tokenFrom(setup.headers['set-cookie']);

    const created = await app.inject({
      method: 'POST', url: '/v1/projects', cookies: { ev_session: token },
      payload: { label: '我的本地助手', rootPath: directory },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ label: '我的本地助手' });

    const snapshot = await app.inject({
      method: 'GET', url: `/v1/projects/${created.json().data.id}/snapshot`, cookies: { ev_session: token },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().data.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'PRD.md' }),
      expect.objectContaining({ relativePath: 'TASKS.md' }),
    ]));
    expect(JSON.stringify(snapshot.json())).not.toContain('SECRET_MUST_NEVER_BE_EXPOSED');
  });

  it('does not disguise an unexpected storage failure as a duplicate scope', () => {
    const database = new Database(':memory:');
    const service = createProjectScopeService(database);

    expect(() => service.create('owner-1', { label: '缺失表项目', rootPath: directory })).toThrow('no such table');

    database.close();
  });
});
