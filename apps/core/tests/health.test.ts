import { healthResponseSchema } from '@ev/contracts';
import { describe, expect, it } from 'vitest';
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
});

describe('Core runtime configuration', () => {
  it('rejects a non-loopback bind address', () => {
    expect(() => loadConfig({ EV_CORE_HOST: '0.0.0.0' })).toThrow(
      'EV_CORE_HOST must be 127.0.0.1',
    );
  });
});
