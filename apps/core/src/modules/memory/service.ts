import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { writeMemoryProjection } from './markdown';

export type MemoryScope = 'GENERAL' | 'FITNESS' | 'LEARNING' | 'PROJECT';

export interface MemoryDocument {
  scope: MemoryScope;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface MemoryDocumentRow {
  scope: MemoryScope;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
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

export function createMemoryService(
  database: Database.Database,
  projectionRoot: string,
  options: MemoryServiceOptions = {},
): {
  read(ownerId: string, scope: MemoryScope): MemoryDocument | undefined;
  write(ownerId: string, scope: MemoryScope, content: string): MemoryDocument;
  restore(ownerId: string, scope: MemoryScope, revisionVersion: number): MemoryDocument;
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

  function write(ownerId: string, scope: MemoryScope, content: string): MemoryDocument {
    const normalized = content.trim();
    if (normalized.length === 0 || normalized.length > 20_000) {
      throw new RangeError('memory content must be between 1 and 20000 characters');
    }
    const existing = read(ownerId, scope);
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
    });
    save();
    const document = read(ownerId, scope);
    if (!document) throw new Error('memory document disappeared');
    writeMemoryProjection(projectionRoot, scope, document.content);
    return document;
  }

  return {
    read,
    write,
    restore(ownerId, scope, revisionVersion) {
      const revision = database
        .prepare(
          `select content from memory_revisions
           where owner_id = ? and scope = ? and version = ?`,
        )
        .get(ownerId, scope, revisionVersion) as { content: string } | undefined;
      if (!revision) throw new RangeError('memory revision does not exist');
      return write(ownerId, scope, revision.content);
    },
  };
}
