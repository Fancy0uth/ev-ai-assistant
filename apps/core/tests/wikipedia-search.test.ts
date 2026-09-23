import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createPublicResourceFetcher } from '../src/modules/learning/public-resource-fetcher';
import { createWikipediaPublicSearchCapability } from '../src/modules/learning/wikipedia-search';
import { openDatabase } from '../src/storage/database';

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

describe('Wikipedia public search capability', () => {
  let app: FastifyInstance | undefined;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-wikipedia-search-'));
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('waits for confirmed execution before searching and stores a safe Wikipedia citation', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const capability = createWikipediaPublicSearchCapability({
      fetch: async (url, init) => {
        requests.push({ url: url.toString(), init });
        return new Response(JSON.stringify({
          query: { search: [{ pageid: 736, title: '线性代数' }] },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const resourceTransportUrls: string[] = [];
    const publicResourceFetcher = createPublicResourceFetcher({
      resolveAll: async () => [{ address: '93.184.216.34', family: 4 as const }],
      transport: async ({ url }) => {
        resourceTransportUrls.push(url.toString());
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: (async function* () { yield Buffer.from('<article>公开百科资料</article>'); })(),
        };
      },
    });

    expect(requests).toEqual([]);
    app = await buildApp({
      databasePath: join(directory, 'app.sqlite'),
      logger: false,
      publicSearchCapability: capability,
      publicResourceFetcher,
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      payload: { username: '检索主人', password: 'correct horse battery staple' },
    });
    const token = tokenFrom(setup.headers['set-cookie']);
    const term = await app.inject({
      method: 'POST',
      url: '/v1/terms',
      cookies: { ev_session: token },
      payload: { title: '2026 秋季', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' },
    });
    const course = await app.inject({
      method: 'POST',
      url: '/v1/courses',
      cookies: { ev_session: token },
      payload: { termId: term.json().data.id, title: '线性代数' },
    });
    const created = await app.inject({
      method: 'POST',
      url: `/v1/courses/${course.json().data.id as string}/resource-searches`,
      cookies: { ev_session: token },
      payload: { query: '线性代数' },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().data.run.status).toBe('AWAITING_DISCLOSURE');
    expect(requests).toEqual([]);

    const executed = await app.inject({
      method: 'POST',
      url: `/v1/resource-searches/${created.json().data.run.id as string}/execute`,
      cookies: { ev_session: token },
      headers: { 'idempotency-key': 'wikipedia-search-confirmed-01' },
      payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' },
    });

    expect(executed.statusCode).toBe(202);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (!request) throw new Error('expected Wikipedia request');
    const requestUrl = new URL(request.url);
    expect(requestUrl.origin).toBe('https://zh.wikipedia.org');
    expect(requestUrl.pathname).toBe('/w/api.php');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      action: 'query',
      list: 'search',
      srsearch: '线性代数',
      srlimit: '5',
      srprop: '',
      format: 'json',
      formatversion: '2',
    });
    expect(request.init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      headers: expect.objectContaining({
        'user-agent': expect.stringContaining('https://github.com/Fancy0uth/ev-ai-assistant'),
      }),
    });
    expect(resourceTransportUrls).toEqual(['https://zh.wikipedia.org/?curid=736']);
    expect(executed.json().data).toMatchObject({
      run: { status: 'SUCCEEDED', citationCount: 1 },
      citations: [{ title: '线性代数', url: 'https://zh.wikipedia.org/?curid=736', publisher: 'zh.wikipedia.org' }],
    });

    const database = openDatabase(join(directory, 'app.sqlite'));
    try {
      expect(database.prepare('select title, url, publisher from course_resource_citations').all())
        .toEqual([{ title: '线性代数', url: 'https://zh.wikipedia.org/?curid=736', publisher: 'zh.wikipedia.org' }]);
    } finally {
      database.close();
    }
  });

  it('rejects redirect, oversized, malformed, and empty MediaWiki responses', async () => {
    let cancelledOversizedBody = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128 * 1024 + 1));
      },
      cancel() {
        cancelledOversizedBody = true;
      },
    });
    const responses = [
      new Response('redirect body', { status: 302 }),
      {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: oversizedBody,
      } as Response,
      new Response(JSON.stringify({ query: { search: [{ pageid: '736', title: '线性代数' }] } }), { status: 200 }),
      new Response(JSON.stringify({ query: { search: [] } }), { status: 200 }),
    ];
    const capability = createWikipediaPublicSearchCapability({
      fetch: async () => {
        const next = responses.shift();
        if (!next) throw new Error('missing response');
        return next;
      },
    });

    await expect(capability.search({ query: 'linear algebra', maxResults: 5 })).rejects.toThrow();
    await expect(capability.search({ query: 'linear algebra', maxResults: 5 })).rejects.toThrow();
    await expect(capability.search({ query: 'linear algebra', maxResults: 5 })).rejects.toThrow();
    await expect(capability.search({ query: 'linear algebra', maxResults: 5 })).rejects.toThrow();
    expect(cancelledOversizedBody).toBe(true);
  });
});
