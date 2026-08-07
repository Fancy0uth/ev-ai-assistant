import type { Owner } from '@ev/contracts';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ApiError } from '../../http/api-error';
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

export function authenticatedOwnerId(request: FastifyRequest): string {
  if (!request.owner) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', '请先登录本地账号');
  }
  return request.owner.id;
}
