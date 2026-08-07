import type { Owner } from '@ev/contracts';
import type { preHandlerHookHandler } from 'fastify';
import type { AuthService } from './service';

declare module 'fastify' {
  interface FastifyRequest {
    owner: Owner | null;
  }
}

export function createAuthGuard(authService: AuthService): preHandlerHookHandler {
  return async (request) => {
    request.owner = authService.authenticate(request.cookies.ev_session);
  };
}
