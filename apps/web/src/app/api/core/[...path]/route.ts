interface RouteContext {
  params: Promise<{ path: string[] }>;
}

const FORWARDED_REQUEST_HEADERS = ['content-type', 'cookie'] as const;
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'set-cookie'] as const;

function coreBaseUrl(): string {
  const value = process.env.EV_CORE_URL ?? 'http://127.0.0.1:4311';
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('EV_CORE_URL must contain only an HTTP(S) origin');
  }
  return url.origin;
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

async function proxyToCore(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const encodedPath = safePath(path);
  if (!encodedPath) {
    return Response.json(
      { error: { code: 'INVALID_PROXY_PATH', message: '请求路径不符合要求' } },
      { status: 400 },
    );
  }

  let target: string;
  try {
    target = `${coreBaseUrl()}/v1/${encodedPath}${new URL(request.url).search}`;
  } catch {
    return Response.json(
      { error: { code: 'CORE_CONFIGURATION_ERROR', message: '本地 Core 地址配置无效' } },
      { status: 500 },
    );
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    cache: 'no-store',
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) init.body = body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      {
        error: {
          code: 'CORE_UNAVAILABLE',
          message: '本地 Core 暂时不可用，请确认服务已启动',
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const dynamic = 'force-dynamic';
export const GET = proxyToCore;
export const POST = proxyToCore;
export const PATCH = proxyToCore;
export const DELETE = proxyToCore;
