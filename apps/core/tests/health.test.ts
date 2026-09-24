import { healthResponseSchema, readinessResponseSchema } from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

describe('Core health routes', () => {
  it('reports the Core service version', async () => {
    const app = await buildApp({ logger: false });
    const response = await app.inject({ method: 'GET', url: '/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: 'ok',
      service: 'ev-core',
      version: '0.1.0',
    });

    await app.close();
  });

  it('uses the stable API error shape for unknown routes', async () => {
    const app = await buildApp({ logger: false });
    const response = await app.inject({ method: 'GET', url: '/v1/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: '请求的资源不存在',
      },
    });

    await app.close();
  });

  it('reports ready only after SQLite can answer a query', async () => {
    const app = await buildApp({ logger: false });
    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(readinessResponseSchema.parse(response.json())).toEqual({
      status: 'ready',
      checks: { database: 'up' },
    });

    await app.close();
  });
});

describe('Core request errors', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    {
      name: 'malformed JSON',
      payload: '{',
      headers: { 'content-type': 'application/json' },
    },
    {
      name: 'an empty JSON body',
      payload: '',
      headers: { 'content-type': 'application/json' },
    },
    {
      name: 'a mismatched content length',
      payload: '{}',
      headers: { 'content-type': 'application/json', 'content-length': '1' },
    },
  ])('rejects $name as a sanitized client error', async ({ payload, headers }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      headers,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: expect.any(String) },
    });
  });

  it('rejects unsupported media without exposing the supplied content type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/setup',
      headers: { 'content-type': 'application/x-private-media' },
      payload: 'private request body',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: expect.any(String) },
    });
    expect(response.body).not.toContain('private');
  });

  it('accepts the body limit and rejects the next byte with a sanitized 413', async () => {
    app.post('/v1/body-limit', { bodyLimit: 8 }, async () => ({ accepted: true }));

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/body-limit',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":12}',
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accepted: true });

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/body-limit',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":123}',
    });
    expect(rejected.statusCode).toBe(413);
    expect(rejected.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: expect.any(String) },
    });
  });

  it.each([
    { name: 'an unexpected exception', error: new Error('private server detail') },
    {
      name: 'an exception with forged Fastify fields',
      error: Object.assign(new Error('private server detail'), {
        statusCode: 400,
        code: 'FST_ERR_CTP_INVALID_JSON_BODY',
        details: { secret: 'private database path' },
      }),
    },
  ])('keeps $name a sanitized server error', async ({ error }) => {
    app.get('/v1/failure', async () => {
      throw error;
    });

    const response = await app.inject({ method: 'GET', url: '/v1/failure' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: expect.any(String) },
    });
    expect(response.body).not.toContain('private');
  });
});

describe('Core runtime configuration', () => {
  it('defaults to the owner-machine Core port selected for this deployment', () => {
    expect(loadConfig({ LOCALAPPDATA: 'C:\\temp' }).port).toBe(4311);
  });

  it('rejects a non-loopback bind address', () => {
    expect(() => loadConfig({ EV_CORE_HOST: '0.0.0.0' })).toThrow(
      'EV_CORE_HOST must be 127.0.0.1',
    );
  });
});
