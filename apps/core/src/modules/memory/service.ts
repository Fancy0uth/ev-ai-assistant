import { randomUUID } from 'node:crypto';
import { ApiError } from '../../http/api-error';
import type Database from 'better-sqlite3';
import { deleteMemoryProjection, writeMemoryProjection } from './markdown';

export type MemoryScope = 'GENERAL' | 'FITNESS' | 'LEARNING' | 'PROJECT';

export interface MemoryDocument {
  scope: MemoryScope;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRevision {
  scope: MemoryScope;
  content: string;
  version: number;
  createdAt: string;
}

interface MemoryDocumentRow {
  scope: MemoryScope;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface MemoryRevisionRow {
  scope: MemoryScope;
  content: string;
  version: number;
  created_at: string;
}

interface MemoryServiceOptions {
  now?: () => Date;
  newId?: () => string;
}

function toDocument(row: MemoryDocumentRow): MemoryDocument {
  return {
    scope: row.scope,
    content: row.content,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRevision(row: MemoryRevisionRow): MemoryRevision {
  return { scope: row.scope, content: row.content, version: row.version, createdAt: row.created_at };
}

export function createMemoryService(
  database: Database.Database,
  projectionRoot: string,
  options: MemoryServiceOptions = {},
): {
  read(ownerId: string, scope: MemoryScope): MemoryDocument | undefined;
  list(ownerId: string): MemoryDocument[];
  listRevisions(ownerId: string, scope: MemoryScope): MemoryRevision[];
  write(ownerId: string, scope: MemoryScope, content: string, expectedVersion?: number | null): MemoryDocument;
  restore(ownerId: string, scope: MemoryScope, revisionVersion: number, expectedVersion?: number): MemoryDocument;
  remove(ownerId: string, scope: MemoryScope, expectedVersion: number): void;
} {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const findDocument = database.prepare(
    `select scope, content, version, created_at, updated_at
     from memory_documents where owner_id = ? and scope = ?`,
  );

  function read(ownerId: string, scope: MemoryScope): MemoryDocument | undefined {
    const row = findDocument.get(ownerId, scope) as MemoryDocumentRow | undefined;
    return row ? toDocument(row) : undefined;
  }

  function assertExpectedVersion(existing: MemoryDocument | undefined, expectedVersion: number | null | undefined): void {
    if (expectedVersion === undefined) return;
    const actual = existing?.version ?? null;
    if (expectedVersion !== actual) {
      throw new ApiError(409, 'MEMORY_VERSION_CONFLICT', '记忆已被更新，请先读取最新版本', { actualVersion: actual });
    }
  }

  function write(ownerId: string, scope: MemoryScope, content: string, expectedVersion?: number | null): MemoryDocument {
    const normalized = content.trim();
    if (normalized.length === 0 || normalized.length > 20_000) {
      throw new RangeError('memory content must be between 1 and 20000 characters');
    }
    const existing = read(ownerId, scope);
    assertExpectedVersion(existing, expectedVersion);
    const version = (existing?.version ?? 0) + 1;
    const timestamp = now().toISOString();
    const save = database.transaction(() => {
      if (existing) {
        database
          .prepare(
            `update memory_documents set content = ?, version = ?, updated_at = ?
             where owner_id = ? and scope = ?`,
          )
          .run(normalized, version, timestamp, ownerId, scope);
      } else {
        database
          .prepare(
            `insert into memory_documents (
               owner_id, scope, content, version, created_at, updated_at
             ) values (?, ?, ?, ?, ?, ?)`,
          )
          .run(ownerId, scope, normalized, version, timestamp, timestamp);
      }
      database
        .prepare(
          `insert into memory_revisions (id, owner_id, scope, content, version, created_at)
           values (?, ?, ?, ?, ?, ?)`,
        )
        .run(newId(), ownerId, scope, normalized, version, timestamp);
      writeMemoryProjection(projectionRoot, scope, normalized);
    });
    save();
    const document = read(ownerId, scope);
    if (!document) throw new Error('memory document disappeared');
    return document;
  }

  return {
    read,
    list(ownerId) {
      return (database.prepare(`select scope, content, version, created_at, updated_at from memory_documents where owner_id = ? order by scope asc`).all(ownerId) as MemoryDocumentRow[]).map(toDocument);
    },
    listRevisions(ownerId, scope) {
      return (database.prepare(`select scope, content, version, created_at from memory_revisions where owner_id = ? and scope = ? order by version desc`).all(ownerId, scope) as MemoryRevisionRow[]).map(toRevision);
    },
    write,
    restore(ownerId, scope, revisionVersion, expectedVersion) {
      const revision = database
        .prepare(
          `select content from memory_revisions
           where owner_id = ? and scope = ? and version = ?`,
        )
        .get(ownerId, scope, revisionVersion) as { content: string } | undefined;
      if (!revision) throw new ApiError(404, 'MEMORY_REVISION_NOT_FOUND', '记忆历史版本不存在');
      return write(ownerId, scope, revision.content, expectedVersion);
    },
    remove(ownerId, scope, expectedVersion) {
      const existing = read(ownerId, scope);
      if (!existing) throw new ApiError(404, 'MEMORY_NOT_FOUND', '记忆不存在');
      assertExpectedVersion(existing, expectedVersion);
      database.transaction(() => {
        database.prepare('delete from memory_revisions where owner_id = ? and scope = ?').run(ownerId, scope);
        database.prepare('delete from memory_documents where owner_id = ? and scope = ?').run(ownerId, scope);
        deleteMemoryProjection(projectionRoot, scope);
      })();
    },
  };
}
