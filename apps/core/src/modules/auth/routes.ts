import {
  credentialsSchema,
  logoutResponseSchema,
  sessionResponseSchema,
  setupStatusResponseSchema,
  type Credentials,
} from '@ev/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ApiError } from '../../http/api-error';
import { createAuthGuard } from './guard';
import type { AuthService } from './service';

const SESSION_COOKIE = 'ev_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

interface AuthRouteOptions {
  authService: AuthService;
  secureCookies: boolean;
}

function parseCredentials(input: unknown): Credentials {
  const result = credentialsSchema.safeParse(input);
  if (!result.success) {
    throw new ApiError(422, 'VALIDATION_ERROR', '账号信息不符合要求', {
      issues: result.error.issues.map(({ code, message, path }) => ({ code, message, path })),
    });
  }
  return result.data;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const { authService, secureCookies } = options;
  const authGuard = createAuthGuard(authService);
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
    const result = await authService.setup(parseCredentials(request.body));
    setSessionCookie(reply, result.token, result.expiresAt);
    return reply.status(201).send(
      sessionResponseSchema.parse({
        data: { owner: result.owner },
      }),
    );
  });

  app.post('/v1/auth/login', { config: { rateLimit } }, async (request, reply) => {
    const result = await authService.login(parseCredentials(request.body));
    setSessionCookie(reply, result.token, result.expiresAt);
    return sessionResponseSchema.parse({ data: { owner: result.owner } });
  });

  app.get('/v1/auth/session', { preHandler: authGuard }, async (request) => {
    return sessionResponseSchema.parse({ data: { owner: request.owner } });
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
