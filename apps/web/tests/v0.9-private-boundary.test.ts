import type { FastifyInstance, InjectOptions } from 'fastify';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as postCore } from '@/app/api/core/[...path]/route';
import { buildApp } from '../../core/src/app';

const webOrigin = 'http://127.0.0.1:3217';
const coreOrigin = 'http://127.0.0.1:4311';
const credentials = {
  username: 'v9-owner',
  password: 'correct horse battery staple',
};

type CsrfRoute = {
  GET(request: Request): Promise<Response>;
};

type WebSecurityModule = {
  documentContentSecurityPolicy(nonce: string, env?: NodeJS.ProcessEnv): string;
  loadWebSecurityConfig(env?: NodeJS.ProcessEnv): unknown;
};

type CoreClientModule = {
  requestCore(path: string, init: RequestInit): Promise<unknown>;
};

type ProxyModule = {
  proxy(request: NextRequest): Response;
};

type InjectMethod = NonNullable<InjectOptions['method']>;

const injectMethods: readonly InjectMethod[] = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS'];

function toInjectMethod(method: string | undefined): InjectMethod {
  const normalized = (method ?? 'GET').toUpperCase();
  if (!injectMethods.includes(normalized as InjectMethod)) {
    throw new Error(`Unsupported Core bridge method: ${normalized}`);
  }
  return normalized as InjectMethod;
}

function cookieValue(cookie: string, name: string): string | undefined {
  for (const entry of cookie.split(';')) {
    const [key, ...value] = entry.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function recordSetCookie(cookieJar: Map<string, string>, response: Response): void {
  const header = response.headers.get('set-cookie');
  if (!header) return;
  const [pair] = header.split(';', 1);
  if (pair === undefined) throw new Error('Expected a Set-Cookie name/value pair');
  const separator = pair.indexOf('=');
  if (separator <= 0) throw new Error('Expected a Set-Cookie name/value pair');
  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  cookieJar.set(name, value);
  document.cookie = `${name}=${value}; Path=/; SameSite=Strict`;
}

function cookieHeader(cookieJar: Map<string, string>): string {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; Max-Age=0; Path=/`;
}

describe('V9 private Web boundary', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    clearCookie('ev_csrf');
    clearCookie('ev_session');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('initializes one CSRF token for setup/login and an Owner write, while refusing forged boundary requests before Core', async () => {
    vi.stubEnv('EV_WEB_ORIGIN', webOrigin);
    vi.stubEnv('EV_CORE_URL', coreOrigin);

    const beforeBoundaryGuard = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', beforeBoundaryGuard);

    const missingOrigin = await postCore(
      new Request(`${webOrigin}/api/core/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title: 'must not reach Core', area: 'WORK', priority: 'MEDIUM' }),
      }),
      { params: Promise.resolve({ path: ['tasks'] }) },
    );

    expect(missingOrigin.status).toBe(403);
    expect(beforeBoundaryGuard).not.toHaveBeenCalled();

    const csrfRoutePath = '../src/app/api/csrf/route';
    const webSecurityPath = '../src/lib/web-security';
    const coreClientPath = '../src/lib/core-client';
    const proxyModulePath = '../src/proxy';
    const { GET: getCsrf } = await import(csrfRoutePath) as CsrfRoute;
    const { documentContentSecurityPolicy, loadWebSecurityConfig } = await import(webSecurityPath) as WebSecurityModule;
    const { requestCore } = await import(coreClientPath) as CoreClientModule;
    const proxyModule = await import(proxyModulePath).catch(() => null) as ProxyModule | null;

    expect(proxyModule).not.toBeNull();
    if (!proxyModule) return;

    const htmlResponse = proxyModule.proxy(new NextRequest(`${webOrigin}/setup`));
    const htmlCsp = htmlResponse.headers.get('content-security-policy');
    const overriddenRequestHeaders = htmlResponse.headers.get('x-middleware-override-headers')?.split(',') ?? [];
    expect(htmlCsp).toContain("frame-ancestors 'none'");
    expect(htmlCsp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(htmlResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(overriddenRequestHeaders).toContain('content-security-policy');
    expect(overriddenRequestHeaders).toContain('x-nonce');
    expect(htmlResponse.headers.get('x-middleware-request-content-security-policy')).toBe(htmlCsp);
    expect(htmlResponse.headers.get('x-middleware-request-x-nonce')).toMatch(/^[A-Za-z0-9+/=]+$/);

    expect(() => loadWebSecurityConfig({ NODE_ENV: 'test', EV_WEB_ORIGIN: 'http://192.0.2.17:3217' })).toThrow();

    app = await buildApp({ logger: false });
    const cookieJar = new Map<string, string>();
    let csrfInitializations = 0;
    let coreCalls = 0;
    let lastBffResponse: Response | undefined;
    let lastCsrfResponse: Response | undefined;

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

      if (rawUrl === '/api/csrf') {
        csrfInitializations += 1;
        const headers = new Headers(init?.headers);
        const cookies = cookieHeader(cookieJar);
        if (cookies) headers.set('cookie', cookies);
        lastCsrfResponse = await getCsrf(new Request(`${webOrigin}/api/csrf`, {
          method: init?.method ?? 'GET',
          headers,
        }));
        recordSetCookie(cookieJar, lastCsrfResponse);
        return lastCsrfResponse;
      }

      if (rawUrl.startsWith('/api/core/')) {
        const url = new URL(rawUrl, webOrigin);
        const headers = new Headers(init?.headers);
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes((init?.method ?? 'GET').toUpperCase())) {
          headers.set('origin', webOrigin);
        }
        const cookies = cookieHeader(cookieJar);
        if (cookies) headers.set('cookie', cookies);
        lastBffResponse = await postCore(
          new Request(url, { ...init, headers }),
          { params: Promise.resolve({ path: url.pathname.split('/').slice(3) }) },
        );
        recordSetCookie(cookieJar, lastBffResponse);
        return lastBffResponse;
      }

      const url = new URL(rawUrl);
      if (url.origin !== coreOrigin) throw new Error(`Unexpected fetch target: ${rawUrl}`);
      coreCalls += 1;
      const headers = new Headers(init?.headers);
      const payload = init?.body == null
        ? undefined
        : Buffer.from(await new Response(init.body).arrayBuffer());
      const injectOptions: InjectOptions = {
        method: toInjectMethod(init?.method),
        url: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(headers.entries()),
      };
      if (payload !== undefined) injectOptions.payload = payload;
      const injected = await app!.inject(injectOptions);
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(injected.headers)) {
        if (Array.isArray(value)) {
          for (const entry of value) responseHeaders.append(name, entry);
        } else if (value !== undefined) {
          responseHeaders.set(name, String(value));
        }
      }
      return new Response(injected.body, { status: injected.statusCode, headers: responseHeaders });
    });

    clearCookie('ev_csrf');
    const setup = await requestCore('auth/setup', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }) as { data: { authenticated: boolean } };
    const login = await requestCore('auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }) as { data: { authenticated: boolean } };
    const task = await requestCore('tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'V9 boundary task', area: 'WORK', priority: 'MEDIUM' }),
    }) as { data: { title: string } };

    expect(setup.data.authenticated).toBe(true);
    expect(login.data.authenticated).toBe(true);
    expect(task.data.title).toBe('V9 boundary task');
    expect(csrfInitializations).toBe(1);
    expect(coreCalls).toBe(3);
    expect(lastCsrfResponse?.headers.get('cache-control')).toBe('no-store');
    expect(lastCsrfResponse?.headers.get('set-cookie')).toContain('Path=/');
    expect(lastCsrfResponse?.headers.get('set-cookie')).toMatch(/; SameSite=strict(?:;|$)/i);
    expect(lastCsrfResponse?.headers.get('set-cookie')).not.toContain('HttpOnly');
    expect(lastCsrfResponse?.headers.get('set-cookie')).not.toMatch(/; Domain=/i);
    expect(lastBffResponse?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(lastBffResponse?.headers.get('referrer-policy')).toBe('no-referrer');
    expect(lastBffResponse?.headers.get('x-frame-options')).toBe('DENY');
    expect(lastBffResponse?.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(lastBffResponse?.headers.get('access-control-allow-origin')).toBeNull();

    const csrf = cookieValue(cookieHeader(cookieJar), 'ev_csrf');
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const coreCallsBeforeRejects = coreCalls;
    const trustedHeaders = {
      origin: webOrigin,
      cookie: cookieHeader(cookieJar),
      'x-ev-csrf-token': csrf ?? '',
      'content-type': 'application/json',
    };

    const forgedOrigin = await postCore(
      new Request(`${webOrigin}/api/core/tasks`, {
        method: 'POST',
        headers: { ...trustedHeaders, origin: 'https://attacker.example' },
        body: JSON.stringify({ title: 'forged origin', area: 'WORK', priority: 'MEDIUM' }),
      }),
      { params: Promise.resolve({ path: ['tasks'] }) },
    );
    const missingCsrf = await postCore(
      new Request(`${webOrigin}/api/core/tasks`, {
        method: 'POST',
        headers: { origin: webOrigin, cookie: cookieHeader(cookieJar), 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'missing csrf', area: 'WORK', priority: 'MEDIUM' }),
      }),
      { params: Promise.resolve({ path: ['tasks'] }) },
    );
    const wrongCsrf = await postCore(
      new Request(`${webOrigin}/api/core/tasks`, {
        method: 'POST',
        headers: { ...trustedHeaders, 'x-ev-csrf-token': 'wrong' },
        body: JSON.stringify({ title: 'wrong csrf', area: 'WORK', priority: 'MEDIUM' }),
      }),
      { params: Promise.resolve({ path: ['tasks'] }) },
    );
    const ambiguousCsrfCookie = await postCore(
      new Request(`${webOrigin}/api/core/tasks`, {
        method: 'POST',
        headers: {
          origin: webOrigin,
          cookie: `ev_csrf=${csrf}; ev_csrf=${csrf}`,
          'x-ev-csrf-token': csrf ?? '',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'ambiguous csrf', area: 'WORK', priority: 'MEDIUM' }),
      }),
      { params: Promise.resolve({ path: ['tasks'] }) },
    );

    expect(forgedOrigin.status).toBe(403);
    expect(missingCsrf.status).toBe(403);
    expect(wrongCsrf.status).toBe(403);
    expect(ambiguousCsrfCookie.status).toBe(403);
    expect(coreCalls).toBe(coreCallsBeforeRejects);

    const anonymousOwnerWrite = await postCore(
      new Request(`${webOrigin}/api/core/tasks`, {
        method: 'POST',
        headers: {
          origin: webOrigin,
          cookie: `ev_csrf=${csrf}`,
          'x-ev-csrf-token': csrf ?? '',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'anonymous owner write', area: 'WORK', priority: 'MEDIUM' }),
      }),
      { params: Promise.resolve({ path: ['tasks'] }) },
    );
    expect(anonymousOwnerWrite.status).toBe(401);

    const localAdmin = await postCore(
      new Request(`${webOrigin}/api/core/local-admin/system`, {
        method: 'POST',
        headers: trustedHeaders,
      }),
      { params: Promise.resolve({ path: ['local-admin', 'system'] }) },
    );
    const projectRegistration = await postCore(
      new Request(`${webOrigin}/api/core/projects`, {
        method: 'POST',
        headers: trustedHeaders,
      }),
      { params: Promise.resolve({ path: ['projects'] }) },
    );
    expect(localAdmin.status).toBe(404);
    expect(projectRegistration.status).toBe(405);
    await expect(projectRegistration.json()).resolves.toMatchObject({
      error: { code: 'PROJECT_MODULE_RETIRED', message: '项目分析模块已退役，项目路径不可用' },
    });

    const reusedToken = await getCsrf(new Request(`${webOrigin}/api/csrf`, {
      headers: { origin: webOrigin, cookie: `ev_csrf=${csrf}` },
    }));
    expect(await reusedToken.json()).toEqual({ token: csrf });
    expect(reusedToken.headers.get('set-cookie')).toBeNull();

    const crossSiteInitialization = await getCsrf(new Request(`${webOrigin}/api/csrf`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    }));
    expect(crossSiteInitialization.status).toBe(403);

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EV_WEB_ORIGIN', 'https://dashboard.example.test');
    const productionCsrf = await getCsrf(new Request('https://dashboard.example.test/api/csrf'));
    expect(productionCsrf.headers.get('set-cookie')).toContain('Secure');
    expect(productionCsrf.headers.get('strict-transport-security')).toBe('max-age=300');
    const productionCsp = documentContentSecurityPolicy('test-nonce', process.env);
    expect(productionCsp).toContain("'nonce-test-nonce'");
    expect(productionCsp).not.toContain("'unsafe-eval'");
  });
});
