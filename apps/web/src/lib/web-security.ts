export const CSRF_COOKIE_NAME = 'ev_csrf';
export const CSRF_TOKEN_LENGTH = 43;

const csrfTokenPattern = new RegExp(`^[A-Za-z0-9_-]{${CSRF_TOKEN_LENGTH}}$`);
const webOriginPattern = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]+\/?$/;
const loopbackHostnames = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface WebSecurityConfig {
  origin: string;
  secureCookies: boolean;
}

export type CsrfCookieState =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'ambiguous' }
  | { kind: 'valid'; token: string };

export function isCsrfToken(value: string): boolean {
  return csrfTokenPattern.test(value);
}

export function readCsrfCookie(rawCookie: string | null): CsrfCookieState {
  if (!rawCookie) return { kind: 'missing' };

  const values: string[] = [];
  for (const part of rawCookie.split(';')) {
    const cookie = part.trim();
    const separator = cookie.indexOf('=');
    if (separator <= 0 || cookie.slice(0, separator) !== CSRF_COOKIE_NAME) continue;
    values.push(cookie.slice(separator + 1));
  }

  if (values.length === 0) return { kind: 'missing' };
  if (values.length !== 1) return { kind: 'ambiguous' };
  const [token] = values;
  if (token === undefined || !isCsrfToken(token)) return { kind: 'invalid' };
  return { kind: 'valid', token };
}

export function loadWebSecurityConfig(env: NodeJS.ProcessEnv = process.env): WebSecurityConfig {
  const value = env.EV_WEB_ORIGIN;
  if (!value || value !== value.trim() || !webOriginPattern.test(value)) {
    throw new Error('EV_WEB_ORIGIN must contain only an HTTP(S) origin');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('EV_WEB_ORIGIN must contain only an HTTP(S) origin');
  }

  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || url.origin === 'null'
  ) {
    throw new Error('EV_WEB_ORIGIN must contain only an HTTP(S) origin');
  }

  if (url.protocol === 'http:' && !loopbackHostnames.has(url.hostname)) {
    throw new Error('EV_WEB_ORIGIN allows HTTP only for explicit loopback origins');
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('EV_WEB_ORIGIN must use HTTPS in production');
  }

  return {
    origin: url.origin,
    secureCookies: url.protocol === 'https:',
  };
}

export function isTrustedOrigin(headers: Headers, configuredOrigin: string): boolean {
  return headers.get('origin') === configuredOrigin;
}

export function hasMatchingCsrfToken(headers: Headers): boolean {
  const cookie = readCsrfCookie(headers.get('cookie'));
  const header = headers.get('x-ev-csrf-token');
  return cookie.kind === 'valid' && header !== null && isCsrfToken(header) && header === cookie.token;
}

export function isExplicitCrossSiteFetch(headers: Headers): boolean {
  return headers.get('sec-fetch-site') === 'cross-site';
}

const apiContentSecurityPolicy = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function documentContentSecurityPolicy(nonce: string, env: NodeJS.ProcessEnv = process.env): string {
  const development = env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self'${development ? " 'unsafe-inline'" : ` 'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function hstsValue(env: NodeJS.ProcessEnv): string | undefined {
  try {
    const config = loadWebSecurityConfig(env);
    return env.NODE_ENV === 'production' && config.secureCookies ? 'max-age=300' : undefined;
  } catch {
    return undefined;
  }
}

function commonSecurityHeaders(env: NodeJS.ProcessEnv): Array<{ key: string; value: string }> {
  const headers = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ];
  const hsts = hstsValue(env);
  if (hsts) headers.push({ key: 'Strict-Transport-Security', value: hsts });
  return headers;
}

export function staticSecurityHeaders(env: NodeJS.ProcessEnv = process.env): Array<{ key: string; value: string }> {
  return commonSecurityHeaders(env);
}

export function applyApiSecurityHeaders(response: Response, env: NodeJS.ProcessEnv = process.env): Response {
  for (const { key, value } of commonSecurityHeaders(env)) response.headers.set(key, value);
  response.headers.set('Content-Security-Policy', apiContentSecurityPolicy);
  return response;
}

export function applyDocumentSecurityHeaders(
  response: Response,
  nonce: string,
  env: NodeJS.ProcessEnv = process.env,
): Response {
  for (const { key, value } of commonSecurityHeaders(env)) response.headers.set(key, value);
  response.headers.set('Content-Security-Policy', documentContentSecurityPolicy(nonce, env));
  return response;
}
