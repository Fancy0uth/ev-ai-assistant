import type { Owner } from '@ev/contracts';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ApiError } from '../../http/api-error';
import type { AuthService } from './service';

declare module 'fastify' {
  interface FastifyRequest {
    owner: Owner | null;
  }
}

export interface AuthGuardOptions {
  readOnlySessionLookup?: true;
}

export function createAuthGuard(
  authService: AuthService,
  options: AuthGuardOptions = {},
): preHandlerHookHandler {
  return async (request) => {
    request.owner = options.readOnlySessionLookup === true
      ? authService.authenticate(request.cookies.ev_session, { readOnly: true })
      : authService.authenticate(request.cookies.ev_session);
  };
}

export function authenticatedOwnerId(request: FastifyRequest): string {
  if (!request.owner) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', '请先登录本地账号');
  }
  return request.owner.id;
}
