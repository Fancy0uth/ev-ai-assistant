import type Database from 'better-sqlite3';

export interface StoredOwner {
  id: string;
  username: string;
  passwordHash: string;
}

export interface PublicOwner {
  id: string;
  username: string;
}

interface NewOwner extends StoredOwner {
  createdAt: string;
}

interface NewSession {
  id: string;
  ownerId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface AuthRepository {
  hasOwner(): boolean;
  findOwnerId(): string | undefined;
  createOwner(owner: NewOwner): StoredOwner;
  findOwnerByUsername(username: string): StoredOwner | undefined;
  createSession(session: NewSession): void;
  findOwnerBySession(tokenHash: string, now: string): PublicOwner | undefined;
  revokeSession(tokenHash: string): void;
}

export function createAuthRepository(database: Database.Database): AuthRepository {
  return {
    hasOwner() {
      return database.prepare('select 1 from owners limit 1').get() !== undefined;
    },

    findOwnerId() {
      const owner = database.prepare('select id from owners limit 1').get() as
        | { id: string }
        | undefined;
      return owner?.id;
    },

    createOwner(owner) {
      database
        .prepare(
          `insert into owners (id, username, password_hash, created_at)
           values (?, ?, ?, ?)`,
        )
        .run(owner.id, owner.username, owner.passwordHash, owner.createdAt);
      return {
        id: owner.id,
        username: owner.username,
        passwordHash: owner.passwordHash,
      };
    },

    findOwnerByUsername(username) {
      return database
        .prepare(
          `select id, username, password_hash as passwordHash
           from owners
           where username = ?`,
        )
        .get(username) as StoredOwner | undefined;
    },

    createSession(session) {
      database
        .prepare(
          `insert into sessions (id, owner_id, token_hash, expires_at, created_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.ownerId,
          session.tokenHash,
          session.expiresAt,
          session.createdAt,
        );
    },

    findOwnerBySession(tokenHash, now) {
      const owner = database
        .prepare(
          `select owners.id, owners.username
           from sessions
           join owners on owners.id = sessions.owner_id
           where sessions.token_hash = ? and sessions.expires_at > ?`,
        )
        .get(tokenHash, now) as PublicOwner | undefined;

      if (!owner) {
        database
          .prepare('delete from sessions where token_hash = ? and expires_at <= ?')
          .run(tokenHash, now);
      }
      return owner;
    },

    revokeSession(tokenHash) {
      database.prepare('delete from sessions where token_hash = ?').run(tokenHash);
    },
  };
}
