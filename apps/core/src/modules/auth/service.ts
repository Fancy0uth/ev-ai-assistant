import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Credentials, Owner } from '@ev/contracts';
import { ApiError } from '../../http/api-error';
import { hashPassword, verifyPassword } from './password';
import type { AuthRepository, PublicOwner, StoredOwner } from './repository';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

interface AuthResult {
  owner: Owner;
  token: string;
  expiresAt: Date;
}

interface AuthServiceOptions {
  now?: () => Date;
}

export interface AuthService {
  needsSetup(): boolean;
  setup(credentials: Credentials): Promise<AuthResult>;
  login(credentials: Credentials): Promise<AuthResult>;
  authenticate(token: string | undefined): Owner;
  logout(token: string | undefined): void;
}

function sessionDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function publicOwner(owner: PublicOwner | StoredOwner): Owner {
  return { id: owner.id, username: owner.username };
}

export async function createAuthService(
  repository: AuthRepository,
  options: AuthServiceOptions = {},
): Promise<AuthService> {
  const now = options.now ?? (() => new Date());
  const dummyPasswordHash = await hashPassword('invalid-login-placeholder');

  function createSession(owner: PublicOwner | StoredOwner): AuthResult {
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_LIFETIME_MS);
    const token = randomBytes(32).toString('base64url');
    repository.createSession({
      id: randomUUID(),
      ownerId: owner.id,
      tokenHash: sessionDigest(token),
      expiresAt: expiresAt.toISOString(),
      createdAt: issuedAt.toISOString(),
    });
    return { owner: publicOwner(owner), token, expiresAt };
  }

  return {
    needsSetup() {
      return !repository.hasOwner();
    },

    async setup(credentials) {
      if (repository.hasOwner()) {
        throw new ApiError(409, 'SETUP_ALREADY_COMPLETED', '本地账号已经完成初始化');
      }

      const passwordHash = await hashPassword(credentials.password);
      let owner: StoredOwner;
      try {
        owner = repository.createOwner({
          id: randomUUID(),
          username: credentials.username,
          passwordHash,
          createdAt: now().toISOString(),
        });
      } catch (error) {
        if (repository.hasOwner()) {
          throw new ApiError(409, 'SETUP_ALREADY_COMPLETED', '本地账号已经完成初始化');
        }
        throw error;
      }
      return createSession(owner);
    },

    async login(credentials) {
      const owner = repository.findOwnerByUsername(credentials.username);
      const passwordMatches = await verifyPassword(
        credentials.password,
        owner?.passwordHash ?? dummyPasswordHash,
      );
      if (!owner || !passwordMatches) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
      }
      return createSession(owner);
    },

    authenticate(token) {
      const owner = token
        ? repository.findOwnerBySession(sessionDigest(token), now().toISOString())
        : undefined;
      if (!owner) {
        throw new ApiError(401, 'AUTHENTICATION_REQUIRED', '请先登录本地账号');
      }
      return publicOwner(owner);
    },

    logout(token) {
      if (token) repository.revokeSession(sessionDigest(token));
    },
  };
}
