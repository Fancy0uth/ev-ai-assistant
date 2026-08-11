import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../src/app/api/core/[...path]/route';

describe('Core BFF proxy', () => {
  beforeEach(() => {
    vi.stubEnv('EV_CORE_URL', 'http://127.0.0.1:4311');
  });

  it('forwards only ev_session without changing its opaque value and returns the Core cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { owner: { id: 'owner', username: 'codex' } } }), {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'ev_session=opaque; Path=/; HttpOnly; SameSite=Strict',
          connection: 'keep-alive',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('http://web.local/api/core/auth/setup?source=web', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'theme=dark; ev_session=session=opaque==; preference=compact',
        connection: 'close',
      },
      body: JSON.stringify({ username: 'codex', password: 'safe password value' }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ path: ['auth', 'setup'] }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('ev_session=opaque');
    expect(response.headers.get('connection')).toBeNull();
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toBe('http://127.0.0.1:4311/v1/auth/setup?source=web');
    const forwardedHeaders = init.headers as Headers;
    expect(forwardedHeaders.get('content-type')).toBe('application/json');
    expect(forwardedHeaders.get('cookie')).toBe('ev_session=session=opaque==');
    expect(forwardedHeaders.get('connection')).toBeNull();
  });

  it('does not forward a Cookie header when ev_session is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://web.local/api/core/tasks', {
        method: 'POST',
        headers: { cookie: 'theme=dark; preference=compact' },
      }),
      { params: Promise.resolve({ path: ['tasks'] }) },
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('cookie')).toBeNull();
  });

  it.each([
    ['IPv4 loopback', 'http://127.0.0.1:4311', 'http://127.0.0.1:4311'],
    ['localhost', 'https://localhost:4312', 'https://localhost:4312'],
    ['IPv6 loopback', 'http://[::1]:4313', 'http://[::1]:4313'],
    ['IPv4 loopback without a port', 'http://127.0.0.1', 'http://127.0.0.1'],
    ['localhost with a single trailing slash', 'https://localhost/', 'https://localhost'],
  ])('allows exact %s Core hostname forms and preserves configured ports', async (_label, coreUrl, origin) => {
    vi.stubEnv('EV_CORE_URL', coreUrl);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://web.local/api/core/system/health?full=1', { method: 'POST' }),
      { params: Promise.resolve({ path: ['system', 'health'] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `${origin}/v1/system/health?full=1`,
      expect.any(Object),
    );
  });

  it.each([
    ['external origin', 'https://core.example.test:4311'],
    ['localhost suffix', 'http://localhost.evil.test:4311'],
    ['IPv4 suffix', 'http://127.0.0.1.evil.test:4311'],
    ['localhost prefix', 'http://evil-localhost:4311'],
    ['out-of-range port', 'http://localhost:65536'],
  ])('rejects a Core URL with an %s before fetching', async (_label, coreUrl) => {
    vi.stubEnv('EV_CORE_URL', coreUrl);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://web.local/api/core/auth/login', { method: 'POST' }),
      { params: Promise.resolve({ path: ['auth', 'login'] }) },
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('CORE_CONFIGURATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty userinfo', 'http://@localhost:4311'],
    ['dot-segment path', 'http://localhost:4311/a/..'],
    ['encoded dot path', 'http://localhost:4311/%2e'],
    ['bare query delimiter', 'http://localhost:4311?'],
    ['bare hash delimiter', 'http://localhost:4311#'],
  ])('rejects a Core URL with a normalized %s before fetching', async (_label, coreUrl) => {
    vi.stubEnv('EV_CORE_URL', coreUrl);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://web.local/api/core/auth/login', { method: 'POST' }),
      { params: Promise.resolve({ path: ['auth', 'login'] }) },
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('CORE_CONFIGURATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects traversal-like path segments before calling Core', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(new Request('http://web.local/api/core/unsafe'), {
      params: Promise.resolve({ path: ['..'] }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_PROXY_PATH');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a stable 502 when Core cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const response = await POST(
      new Request('http://web.local/api/core/auth/login', { method: 'POST' }),
      { params: Promise.resolve({ path: ['auth', 'login'] }) },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: 'CORE_UNAVAILABLE',
        message: '本地 Core 暂时不可用，请确认服务已启动',
      },
    });
  });

  it('rejects a Core base URL that contains a path', async () => {
    vi.stubEnv('EV_CORE_URL', 'http://127.0.0.1:4311/unexpected');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://web.local/api/core/auth/login', { method: 'POST' }),
      { params: Promise.resolve({ path: ['auth', 'login'] }) },
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('CORE_CONFIGURATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
