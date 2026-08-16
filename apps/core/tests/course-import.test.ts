import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { CourseScheduleVisionProvider } from '../src/modules/agents/provider';
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

const validVisionProvider: CourseScheduleVisionProvider = {
  async extract() {
    return {
      candidates: [
        {
          title: '数据库系统',
          weekday: 1,
          startLocalTime: '08:00',
          endLocalTime: '09:40',
          weekStart: 1,
          weekEnd: 16,
          weekPattern: 'ODD_WEEKS',
          confidence: 0.92,
        },
      ],
    };
  },
};

describe('course screenshot import runs', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-course-import-'));
    databasePath = join(directory, 'app.sqlite');
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function setupAndCreateTerm(provider?: CourseScheduleVisionProvider): Promise<string> {
    app = await buildApp({
      databasePath,
      logger: false,
      ...(provider ? { courseScheduleVisionProvider: provider } : {}),
    });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const term = await app.inject({
      method: 'POST',
      url: '/v1/terms',
      cookies: { ev_session: token },
      payload: {
        title: '2026 秋季学期',
        timezone: 'Asia/Shanghai',
        weekOneMonday: '2026-09-07',
      },
    });
    expect(term.statusCode).toBe(201);
    return token;
  }

  it('turns a validated high-confidence screenshot candidate into a pending schedule Proposal', async () => {
    const token = await setupAndCreateTerm(validVisionProvider);
    const terms = await app!.inject({ method: 'GET', url: '/v1/terms', cookies: { ev_session: token } });
    const termId = terms.json().data[0].id as string;

    const imported = await app!.inject({
      method: 'POST',
      url: '/v1/course-imports',
      cookies: { ev_session: token },
      payload: {
        termId,
        image: { mimeType: 'image/png', base64: 'aGVsbG8=' },
      },
    });

    expect(imported.statusCode).toBe(202);
    expect(imported.json().data).toMatchObject({
      run: { status: 'PROPOSED', candidateCount: 1, imageByteSize: 5 },
      proposal: {
        kind: 'SCHEDULE',
        status: 'PENDING',
        source: 'COURSE_IMPORT',
        changes: [
          {
            operation: 'CREATE_CALENDAR_RULE',
            rule: { title: '数据库系统', weekPattern: 'ODD_WEEKS' },
          },
        ],
      },
    });
    expect(JSON.stringify(imported.json())).not.toMatch(/aGVsbG8=|ownerId|password|token|session/i);
  });

  it('returns a low-confidence run for review and never silently creates a Proposal', async () => {
    const lowConfidenceProvider: CourseScheduleVisionProvider = {
      async extract() {
        return {
          candidates: [
            {
              title: '无法确定的课程',
              weekday: 3,
              startLocalTime: '10:00',
              endLocalTime: '11:40',
              weekStart: 1,
              weekEnd: 16,
              weekPattern: 'EVERY_WEEK',
              confidence: 0.55,
            },
          ],
        };
      },
    };
    const token = await setupAndCreateTerm(lowConfidenceProvider);
    const termId = (await app!.inject({ method: 'GET', url: '/v1/terms', cookies: { ev_session: token } }))
      .json().data[0].id as string;

    const imported = await app!.inject({
      method: 'POST',
      url: '/v1/course-imports',
      cookies: { ev_session: token },
      payload: { termId, image: { mimeType: 'image/png', base64: 'aGVsbG8=' } },
    });

    expect(imported.statusCode).toBe(202);
    expect(imported.json().data).toMatchObject({
      run: { status: 'REVIEW_REQUIRED', candidateCount: 1 },
      proposal: null,
    });
  });

  it('records a blocked import and returns a clear 503 when no vision Provider is configured', async () => {
    const token = await setupAndCreateTerm();
    const termId = (await app!.inject({ method: 'GET', url: '/v1/terms', cookies: { ev_session: token } }))
      .json().data[0].id as string;
    const imported = await app!.inject({
      method: 'POST',
      url: '/v1/course-imports',
      cookies: { ev_session: token },
      payload: { termId, image: { mimeType: 'image/png', base64: 'aGVsbG8=' } },
    });

    expect(imported.statusCode).toBe(503);
    expect(imported.json().error).toMatchObject({ code: 'COURSE_IMPORT_PROVIDER_NOT_CONFIGURED' });
    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select status from course_import_runs').all()).toEqual([
        { status: 'BLOCKED' },
      ]);
    } finally {
      database.close();
    }
  });
});
