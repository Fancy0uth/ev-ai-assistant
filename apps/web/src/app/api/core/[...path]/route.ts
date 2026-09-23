import {
  applyApiSecurityHeaders,
  hasMatchingCsrfToken,
  isTrustedOrigin,
  loadWebSecurityConfig,
} from '../../../../lib/web-security';

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

const ALLOWED_CORE_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const CORE_ORIGIN_PATTERN =
  /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/;
/** Explicitly bounded so browser clients cannot turn the BFF into a header proxy. */
const FORWARDED_REQUEST_HEADERS = ['content-type', 'idempotency-key'] as const;
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'set-cookie',
  'idempotency-replayed',
  'retry-after',
] as const;
const MAX_REQUEST_BODY_BYTES = 5_000_000;

function coreBaseUrl(): string {
  const value = process.env.EV_CORE_URL ?? 'http://127.0.0.1:4311';
  if (CORE_ORIGIN_PATTERN.exec(value)?.[0] !== value) {
    throw new Error('EV_CORE_URL must contain only an HTTP(S) origin');
  }
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !ALLOWED_CORE_HOSTNAMES.has(url.hostname)
  ) {
    throw new Error('EV_CORE_URL must contain only an HTTP(S) origin');
  }
  return url.origin;
}

function sessionCookie(rawCookie: string | null): string | null {
  if (!rawCookie) return null;

  for (const part of rawCookie.split(';')) {
    const cookie = part.trim();
    const separator = cookie.indexOf('=');
    if (separator <= 0 || cookie.slice(0, separator).trim() !== 'ev_session') continue;
    return `ev_session=${cookie.slice(separator + 1)}`;
  }

  return null;
}

function safePath(segments: string[]): string | null {
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('/') ||
        segment.includes('\\'),
    )
  ) {
    return null;
  }
  return segments.map(encodeURIComponent).join('/');
}

function isRetiredProjectPath(path: string[]): boolean {
  return path[0]?.toLowerCase() === 'projects';
}

function isLocalAdminPath(path: string[]): boolean {
  return path[0]?.toLowerCase() === 'local-admin';
}

function isMutation(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

function responseJson(body: unknown, status: number): Response {
  return applyApiSecurityHeaders(
    Response.json(body, { status, headers: { 'cache-control': 'no-store' } }),
  );
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new RangeError('BFF_BODY_TOO_LARGE');
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RangeError('BFF_BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function proxyToCore(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  let webSecurity;
  try {
    webSecurity = loadWebSecurityConfig();
  } catch {
    return responseJson(
      { error: { code: 'WEB_ORIGIN_CONFIGURATION_ERROR', message: 'Web Origin 配置无效' } },
      500,
    );
  }
  if (isRetiredProjectPath(path)) {
    return responseJson(
      { error: { code: 'PROJECT_MODULE_RETIRED', message: '项目分析模块已退役，项目路径不可用' } },
      405,
    );
  }
  if (isLocalAdminPath(path)) {
    return responseJson(
      { error: { code: 'LOCAL_ADMIN_PROXY_FORBIDDEN', message: '本机管理路径不通过 Web 代理' } },
      404,
    );
  }
  const encodedPath = safePath(path);
  if (!encodedPath) {
    return responseJson(
      { error: { code: 'INVALID_PROXY_PATH', message: '请求路径不符合要求' } },
      400,
    );
  }

  if (isMutation(request.method)) {
    if (!isTrustedOrigin(request.headers, webSecurity.origin)) {
      return responseJson(
        { error: { code: 'BFF_ORIGIN_REJECTED', message: '请求来源不符合要求' } },
        403,
      );
    }
    if (!hasMatchingCsrfToken(request.headers)) {
      return responseJson(
        { error: { code: 'BFF_CSRF_REJECTED', message: 'CSRF Token 不符合要求' } },
        403,
      );
    }
  }

  let target: string;
  try {
    target = `${coreBaseUrl()}/v1/${encodedPath}${new URL(request.url).search}`;
  } catch {
    return responseJson(
      { error: { code: 'CORE_CONFIGURATION_ERROR', message: '本地 Core 地址配置无效' } },
      500,
    );
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookie = sessionCookie(request.headers.get('cookie'));
  if (cookie) headers.set('cookie', cookie);
  const init: RequestInit = {
    method: request.method,
    headers,
    cache: 'no-store',
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    try {
      const body = await readBoundedBody(request, MAX_REQUEST_BODY_BYTES);
      if (body.byteLength > 0) init.body = new Uint8Array(body).buffer;
    } catch (error) {
      if (error instanceof RangeError && error.message === 'BFF_BODY_TOO_LARGE') {
        return responseJson(
          { error: { code: 'BFF_BODY_TOO_LARGE', message: '上传内容超过 5 MB 限制' } },
          413,
        );
      }
      throw error;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return responseJson(
      {
        error: {
          code: 'CORE_UNAVAILABLE',
          message: '本地 Core 暂时不可用，请确认服务已启动',
        },
      },
      502,
    );
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return applyApiSecurityHeaders(new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  }));
}

export const dynamic = 'force-dynamic';
export const GET = proxyToCore;
export const POST = proxyToCore;
export const PUT = proxyToCore;
export const PATCH = proxyToCore;
export const DELETE = proxyToCore;
