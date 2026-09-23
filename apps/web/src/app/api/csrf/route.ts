import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  applyApiSecurityHeaders,
  CSRF_COOKIE_NAME,
  isExplicitCrossSiteFetch,
  isTrustedOrigin,
  loadWebSecurityConfig,
  readCsrfCookie,
} from '../../../lib/web-security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function responseError(status: number, code: string, message: string): Response {
  return applyApiSecurityHeaders(
    NextResponse.json({ error: { code, message } }, {
      status,
      headers: { 'cache-control': 'no-store' },
    }),
  );
}

export async function GET(request: Request): Promise<Response> {
  let config;
  try {
    config = loadWebSecurityConfig();
  } catch {
    return responseError(500, 'WEB_ORIGIN_CONFIGURATION_ERROR', 'Web Origin 配置无效');
  }

  const origin = request.headers.get('origin');
  if (
    isExplicitCrossSiteFetch(request.headers)
    || (origin !== null && !isTrustedOrigin(request.headers, config.origin))
  ) {
    return responseError(403, 'CSRF_ORIGIN_REJECTED', 'CSRF 初始化来源不符合要求');
  }

  const existing = readCsrfCookie(request.headers.get('cookie'));
  if (existing.kind === 'ambiguous') {
    return responseError(400, 'CSRF_COOKIE_INVALID', 'CSRF Cookie 不符合要求');
  }

  const token = existing.kind === 'valid' ? existing.token : randomBytes(32).toString('base64url');
  const response = NextResponse.json(
    { token },
    { headers: { 'cache-control': 'no-store' } },
  );
  if (existing.kind !== 'valid') {
    response.cookies.set({
      name: CSRF_COOKIE_NAME,
      value: token,
      path: '/',
      sameSite: 'strict',
      secure: config.secureCookies,
      httpOnly: false,
    });
  }
  return applyApiSecurityHeaders(response);
}
