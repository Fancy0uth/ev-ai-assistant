import {
  credentialsSchema,
  logoutResponseSchema,
  sessionResponseSchema,
  setupStatusResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import type { AuthService } from './service';

const SESSION_COOKIE = 'ev_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

interface AuthRouteOptions {
  authService: AuthService;
  secureCookies: boolean;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const { authService, secureCookies } = options;
  const rateLimit = { max: 5, timeWindow: '1 minute' };

  function setSessionCookie(
    reply: FastifyReply,
    token: string,
    expiresAt: Date,
  ): void {
    reply.setCookie(SESSION_COOKIE, token, {
      expires: expiresAt,
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
      sameSite: 'strict',
      secure: secureCookies,
    });
  }

  app.get('/v1/auth/setup-status', async () => {
    return setupStatusResponseSchema.parse({
      data: { needsSetup: authService.needsSetup() },
    });
  });

  app.post('/v1/auth/setup', { config: { rateLimit } }, async (request, reply) => {
    const credentials = parseRequestInput(
      credentialsSchema,
      request.body,
      '账号信息不符合要求',
    );
    const result = await authService.setup(credentials);
    setSessionCookie(reply, result.token, result.expiresAt);
    return reply.status(201).send(
      sessionResponseSchema.parse({
        data: { authenticated: true, owner: result.owner },
      }),
    );
  });

  app.post('/v1/auth/login', { config: { rateLimit } }, async (request, reply) => {
    const credentials = parseRequestInput(
      credentialsSchema,
      request.body,
      '账号信息不符合要求',
    );
    const result = await authService.login(credentials);
    setSessionCookie(reply, result.token, result.expiresAt);
    return sessionResponseSchema.parse({ data: { authenticated: true, owner: result.owner } });
  });

  app.get('/v1/auth/session', async (request) => {
    const owner = authService.optionalSessionOwner(request.cookies[SESSION_COOKIE]);
    return sessionResponseSchema.parse({
      data: owner ? { authenticated: true, owner } : { authenticated: false },
    });
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    authService.logout(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: secureCookies,
    });
    return logoutResponseSchema.parse({ data: { success: true } });
  });
}
