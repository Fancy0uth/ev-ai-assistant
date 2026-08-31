import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('v0.7 health capability composition', () => {
  it('defaults all v0.7 health ports to fail-closed descriptors', async () => {
    const app = await buildApp({ logger: false });
    const response = await app.inject({ method: 'GET', url: '/v1/health-capabilities' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((entry: { availability: string }) => entry.availability)).toEqual(['NOT_CONFIGURED', 'NOT_CONFIGURED', 'NOT_CONFIGURED']);
    await app.close();
  });
});
