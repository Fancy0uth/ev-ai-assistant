import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/core/[...path]/route';

const webOrigin = 'http://127.0.0.1:3217';
const csrfToken = 'C'.repeat(43);

function trustedMutationRequest(url: string, init: RequestInit): Request {
  const headers = new Headers(init.headers);
  headers.set('origin', webOrigin);
  headers.set('x-ev-csrf-token', csrfToken);
  const existingCookie = headers.get('cookie');
  headers.set('cookie', existingCookie ? `${existingCookie}; ev_csrf=${csrfToken}` : `ev_csrf=${csrfToken}`);
  return new Request(url, { ...init, headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Core BFF idempotency headers', () => {
  it('rejects a raw upload stream over 5 MB before it calls Core', async () => {
    vi.stubEnv('EV_CORE_URL', 'http://127.0.0.1:4311');
    vi.stubEnv('EV_WEB_ORIGIN', webOrigin);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      trustedMutationRequest('http://localhost/api/core/course-artifacts', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array(5_000_001),
      }),
      { params: Promise.resolve({ path: ['course-artifacts'] }) },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BFF_BODY_TOO_LARGE', message: '上传内容超过 5 MB 限制' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards only the approved Idempotency request header and exposes the approved response headers', async () => {
    vi.stubEnv('EV_CORE_URL', 'http://127.0.0.1:4311');
    vi.stubEnv('EV_WEB_ORIGIN', webOrigin);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'proposal' } }), {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'idempotency-replayed': 'true',
          'retry-after': '1',
          'x-provider-secret': 'must-not-cross-bff',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const key = 'web-v05-idempotency-0001';

    const response = await POST(
      trustedMutationRequest('http://localhost/api/core/daily-plans/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          'x-not-allowed': 'do-not-forward',
        },
        body: JSON.stringify({ preflightId: 'preflight', expectedPreflightVersion: 2 }),
      }),
      { params: Promise.resolve({ path: ['daily-plans', 'generate'] }) },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4311/v1/daily-plans/generate',
      expect.anything(),
    );
    expect(new Headers(init.headers).get('idempotency-key')).toBe(key);
    expect(new Headers(init.headers).get('x-not-allowed')).toBeNull();
    expect(response.headers.get('idempotency-replayed')).toBe('true');
    expect(response.headers.get('retry-after')).toBe('1');
    expect(response.headers.get('x-provider-secret')).toBeNull();
  });
});
