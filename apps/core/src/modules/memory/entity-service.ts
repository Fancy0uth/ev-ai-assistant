import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import { deleteEntityMemoryProjection, writeEntityMemoryProjection } from './markdown';
import {
  createMemoryService,
  type MemoryDocument as LegacyMemoryDocument,
  type MemoryRevision as LegacyMemoryRevision,
  type MemoryScope,
} from './service';

export type EntityMemoryScopeType = 'DOMAIN' | 'PROJECT' | 'COURSE' | 'FITNESS' | 'NUTRITION' | 'DAILY';
type StoredEntityMemoryScopeType = Exclude<EntityMemoryScopeType, 'DOMAIN'>;
type EntityMemoryRevisionSource = 'WRITE' | 'RESTORE' | 'LEGACY';

export interface EntityMemoryIdentity {
  scopeType: EntityMemoryScopeType;
  scopeId: string;
}

export interface EntityMemoryDocument extends EntityMemoryIdentity {
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EntityMemoryRevision extends EntityMemoryIdentity {
  id: string;
  content: string;
  version: number;
  parentRevisionId: string | null;
  sourceRevisionId: string | null;
  source: EntityMemoryRevisionSource;
  expectedVersion: number | null;
  contentBytes: number;
  createdAt: string;
}

export interface EntityMemoryRevisionWritten {
  document: EntityMemoryDocument;
  revision: EntityMemoryRevision;
}

export type EntityMemoryBeforeProjection = (event: EntityMemoryRevisionWritten) => void;

export interface EntityMemoryRevisionHook {
  onRevisionAppended(event: { ownerId: string; document: EntityMemoryDocument; revision: EntityMemoryRevision }): void;
}

interface EntityMemoryDocumentRow {
  id: string;
  scope_type: StoredEntityMemoryScopeType;
  scope_id: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface EntityMemoryRevisionRow {
  id: string;
  scope_type: StoredEntityMemoryScopeType;
  scope_id: string;
  content: string;
  version: number;
  parent_revision_id: string | null;
  source_revision_id: string | null;
  source: Exclude<EntityMemoryRevisionSource, 'LEGACY'>;
  expected_version: number | null;
  content_bytes: number;
  created_at: string;
}

interface EntityMemoryServiceOptions {
  now?: () => Date;
  newId?: () => string;
  revisionHook?: EntityMemoryRevisionHook;
}

interface AppendEntityRevisionInput {
  content?: string;
  expectedVersion: number | null | undefined;
  source: Exclude<EntityMemoryRevisionSource, 'LEGACY'>;
  sourceRevisionVersion?: number;
  beforeProjection?: EntityMemoryBeforeProjection;
}

const legacyScopes = new Set<MemoryScope>(['GENERAL', 'FITNESS', 'LEARNING', 'PROJECT']);

function isLegacyScope(scopeId: string): scopeId is MemoryScope {
  return legacyScopes.has(scopeId as MemoryScope);
}

function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function notFound(): ApiError {
  return new ApiError(404, 'MEMORY_ENTITY_SCOPE_NOT_FOUND', '实体记忆范围不存在或不可访问');
}

function invalidScope(): ApiError {
  return new ApiError(422, 'MEMORY_ENTITY_SCOPE_INVALID', '实体记忆范围不符合要求');
}

function toEntityDocument(row: EntityMemoryDocumentRow): EntityMemoryDocument {
  return {
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    content: row.content,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEntityRevision(row: EntityMemoryRevisionRow): EntityMemoryRevision {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    content: row.content,
    version: row.version,
    parentRevisionId: row.parent_revision_id,
    sourceRevisionId: row.source_revision_id,
    source: row.source,
    expectedVersion: row.expected_version,
    contentBytes: row.content_bytes,
    createdAt: row.created_at,
  };
}

function adaptLegacyDocument(scope: MemoryScope, document: LegacyMemoryDocument): EntityMemoryDocument {
  return {
    scopeType: 'DOMAIN',
    scopeId: scope,
    content: document.content,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function adaptLegacyRevision(scope: MemoryScope, revision: LegacyMemoryRevision): EntityMemoryRevision {
  return {
    id: `legacy:${scope}:${revision.version}`,
    scopeType: 'DOMAIN',
    scopeId: scope,
    content: revision.content,
    version: revision.version,
    parentRevisionId: null,
    sourceRevisionId: null,
    source: 'LEGACY',
    expectedVersion: null,
    contentBytes: Buffer.byteLength(revision.content, 'utf8'),
    createdAt: revision.createdAt,
  };
}

export function createEntityMemoryService(
  database: Database.Database,
  projectionRoot: string,
  legacyMemoryService: ReturnType<typeof createMemoryService>,
  options: EntityMemoryServiceOptions = {},
): {
  read(ownerId: string, identity: EntityMemoryIdentity): EntityMemoryDocument | undefined;
  listRevisions(ownerId: string, identity: EntityMemoryIdentity): EntityMemoryRevision[];
  write(ownerId: string, identity: EntityMemoryIdentity, content: string, expectedVersion?: number | null): EntityMemoryDocument;
  writeForCompaction(
    ownerId: string,
    identity: EntityMemoryIdentity,
    content: string,
    expectedVersion: number,
    beforeProjection: EntityMemoryBeforeProjection,
  ): EntityMemoryDocument;
  restore(ownerId: string, identity: EntityMemoryIdentity, revisionVersion: number, expectedVersion?: number): EntityMemoryDocument;
  restoreForCompaction(
    ownerId: string,
    identity: EntityMemoryIdentity,
    revisionVersion: number,
    expectedVersion: number,
    beforeProjection: EntityMemoryBeforeProjection,
  ): EntityMemoryDocument;
  remove(ownerId: string, identity: EntityMemoryIdentity, expectedVersion: number): void;
} {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const findProjectScope = database.prepare('select 1 from project_scopes where id = ? and owner_id = ?');
  const findCourse = database.prepare('select 1 from courses where id = ? and owner_id = ?');
  const findDocument = database.prepare(
    `select id, scope_type, scope_id, content, version, created_at, updated_at
     from entity_memory_documents
     where owner_id = ? and scope_type = ? and scope_id = ?`,
  );
  const findRevision = database.prepare(
    `select id, scope_type, scope_id, content, version, parent_revision_id, source_revision_id,
            source, expected_version, content_bytes, created_at
     from entity_memory_revisions
     where document_id = ? and version = ?`,
  );
  const listRevisionRows = database.prepare(
    `select id, scope_type, scope_id, content, version, parent_revision_id, source_revision_id,
            source, expected_version, content_bytes, created_at
     from entity_memory_revisions
     where document_id = ?
     order by version desc`,
  );

  function legacyScope(identity: EntityMemoryIdentity): MemoryScope {
    if (identity.scopeType !== 'DOMAIN' || !isLegacyScope(identity.scopeId)) throw invalidScope();
    return identity.scopeId;
  }

  function assertOwnedEntityScope(ownerId: string, identity: EntityMemoryIdentity): void {
    switch (identity.scopeType) {
      case 'DOMAIN':
        legacyScope(identity);
        return;
      case 'PROJECT':
        if (!findProjectScope.get(identity.scopeId, ownerId)) throw notFound();
        return;
      case 'COURSE':
        if (!findCourse.get(identity.scopeId, ownerId)) throw notFound();
        return;
      case 'FITNESS':
      case 'NUTRITION':
        if (identity.scopeId !== ownerId) throw notFound();
        return;
      case 'DAILY':
        if (!isValidLocalDate(identity.scopeId)) throw invalidScope();
        return;
    }
  }

  function readStoredDocument(ownerId: string, identity: EntityMemoryIdentity): EntityMemoryDocumentRow | undefined {
    return findDocument.get(ownerId, identity.scopeType, identity.scopeId) as EntityMemoryDocumentRow | undefined;
  }

  function assertExpectedVersion(existing: EntityMemoryDocument | undefined, expectedVersion: number | null | undefined): void {
    if (expectedVersion === undefined) return;
    const actual = existing?.version ?? null;
    if (expectedVersion !== actual) {
      throw new ApiError(409, 'MEMORY_VERSION_CONFLICT', '记忆已被更新，请先读取最新版本', { actualVersion: actual });
    }
  }

  function normalizeContent(content: string): string {
    const normalized = content.trim();
    if (normalized.length === 0 || normalized.length > 20_000) {
      throw new RangeError('memory content must be between 1 and 20000 characters');
    }
    return normalized;
  }

  function appendEntityRevision(
    ownerId: string,
    identity: EntityMemoryIdentity,
    input: AppendEntityRevisionInput,
  ): EntityMemoryDocument {
    assertOwnedEntityScope(ownerId, identity);
    let document: EntityMemoryDocument | undefined;
    let revision: EntityMemoryRevision | undefined;
    database.transaction(() => {
      const existingRow = readStoredDocument(ownerId, identity);
      const existing = existingRow ? toEntityDocument(existingRow) : undefined;
      const sourceRevision = input.source === 'RESTORE' && existingRow
        ? findRevision.get(existingRow.id, input.sourceRevisionVersion) as EntityMemoryRevisionRow | undefined
        : undefined;
      if (input.source === 'RESTORE' && !sourceRevision) {
        throw new ApiError(404, 'MEMORY_REVISION_NOT_FOUND', '记忆历史版本不存在');
      }
      assertExpectedVersion(existing, input.expectedVersion);
      const parentRevision = existingRow
        ? findRevision.get(existingRow.id, existingRow.version) as EntityMemoryRevisionRow | undefined
        : undefined;
      if (existingRow && !parentRevision) throw new Error('entity memory revision disappeared');
      const normalized = normalizeContent(input.source === 'RESTORE' ? sourceRevision!.content : input.content ?? '');
      const timestamp = now().toISOString();
      const documentId = existingRow?.id ?? newId();
      const version = (existing?.version ?? 0) + 1;
      const nextRevision = {
        id: newId(),
        scopeType: identity.scopeType as StoredEntityMemoryScopeType,
        scopeId: identity.scopeId,
        content: normalized,
        version,
        parentRevisionId: parentRevision?.id ?? null,
        sourceRevisionId: input.source === 'RESTORE' ? sourceRevision?.id ?? null : parentRevision?.id ?? null,
        source: input.source,
        expectedVersion: input.expectedVersion ?? null,
        contentBytes: Buffer.byteLength(normalized, 'utf8'),
        createdAt: timestamp,
      } satisfies EntityMemoryRevision;
      const nextDocument = {
        scopeType: identity.scopeType,
        scopeId: identity.scopeId,
        content: normalized,
        version,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      } satisfies EntityMemoryDocument;
      if (existingRow) {
        database.prepare(
          `update entity_memory_documents set content = ?, version = ?, updated_at = ?
           where id = ?`,
        ).run(normalized, version, timestamp, documentId);
      } else {
        database.prepare(
          `insert into entity_memory_documents (
             id, owner_id, scope_type, scope_id, content, version, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(documentId, ownerId, identity.scopeType, identity.scopeId, normalized, version, timestamp, timestamp);
      }
      database.prepare(
        `insert into entity_memory_revisions (
           id, document_id, owner_id, scope_type, scope_id, content, version,
           parent_revision_id, source_revision_id, source, expected_version, content_bytes, created_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        nextRevision.id,
        documentId,
        ownerId,
        identity.scopeType,
        identity.scopeId,
        nextRevision.content,
        nextRevision.version,
        nextRevision.parentRevisionId,
        nextRevision.sourceRevisionId,
        nextRevision.source,
        nextRevision.expectedVersion,
        nextRevision.contentBytes,
        nextRevision.createdAt,
      );
      input.beforeProjection?.({ document: nextDocument, revision: nextRevision });
      writeEntityMemoryProjection(projectionRoot, ownerId, identity.scopeType, identity.scopeId, normalized);
      document = nextDocument;
      revision = nextRevision;
    })();
    if (!document || !revision) throw new Error('entity memory document disappeared');
    try {
      options.revisionHook?.onRevisionAppended({ ownerId, document, revision });
    } catch {
      // A future optional compaction listener must not make a committed write appear to fail.
    }
    return document;
  }

  return {
    read(ownerId, identity) {
      assertOwnedEntityScope(ownerId, identity);
      if (identity.scopeType === 'DOMAIN') {
        const scope = legacyScope(identity);
        const document = legacyMemoryService.read(ownerId, scope);
        return document ? adaptLegacyDocument(scope, document) : undefined;
      }
      const row = readStoredDocument(ownerId, identity);
      return row ? toEntityDocument(row) : undefined;
    },
    listRevisions(ownerId, identity) {
      assertOwnedEntityScope(ownerId, identity);
      if (identity.scopeType === 'DOMAIN') {
        const scope = legacyScope(identity);
        return legacyMemoryService.listRevisions(ownerId, scope).map((revision) => adaptLegacyRevision(scope, revision));
      }
      const document = readStoredDocument(ownerId, identity);
      if (!document) return [];
      return (listRevisionRows.all(document.id) as EntityMemoryRevisionRow[]).map(toEntityRevision);
    },
    write(ownerId, identity, content, expectedVersion) {
      assertOwnedEntityScope(ownerId, identity);
      if (identity.scopeType === 'DOMAIN') {
        const scope = legacyScope(identity);
        return adaptLegacyDocument(scope, legacyMemoryService.write(ownerId, scope, content, expectedVersion));
      }
      return appendEntityRevision(ownerId, identity, { content, expectedVersion, source: 'WRITE' });
    },
    writeForCompaction(ownerId, identity, content, expectedVersion, beforeProjection) {
      assertOwnedEntityScope(ownerId, identity);
      if (identity.scopeType === 'DOMAIN') {
        const scope = legacyScope(identity);
        return adaptLegacyDocument(scope, legacyMemoryService.writeForCompaction(
          ownerId,
          scope,
          content,
          expectedVersion,
          ({ document, revision }) => beforeProjection({
            document: adaptLegacyDocument(scope, document),
            revision: adaptLegacyRevision(scope, revision),
          }),
        ));
      }
      return appendEntityRevision(ownerId, identity, {
        content,
        expectedVersion,
        source: 'WRITE',
        beforeProjection,
      });
    },
    restore(ownerId, identity, revisionVersion, expectedVersion) {
      assertOwnedEntityScope(ownerId, identity);
      if (identity.scopeType === 'DOMAIN') {
        const scope = legacyScope(identity);
        return adaptLegacyDocument(scope, legacyMemoryService.restore(ownerId, scope, revisionVersion, expectedVersion));
      }
      return appendEntityRevision(ownerId, identity, {
        expectedVersion,
        source: 'RESTORE',
        sourceRevisionVersion: revisionVersion,
      });
    },
    restoreForCompaction(ownerId, identity, revisionVersion, expectedVersion, beforeProjection) {
      assertOwnedEntityScope(ownerId, identity);
      if (identity.scopeType === 'DOMAIN') {
        const scope = legacyScope(identity);
        return adaptLegacyDocument(scope, legacyMemoryService.restoreForCompaction(
          ownerId,
          scope,
          revisionVersion,
          expectedVersion,
          ({ document, revision }) => beforeProjection({
            document: adaptLegacyDocument(scope, document),
            revision: adaptLegacyRevision(scope, revision),
          }),
        ));
      }
      return appendEntityRevision(ownerId, identity, {
        expectedVersion,
        source: 'RESTORE',
        sourceRevisionVersion: revisionVersion,
        beforeProjection,
      });
    },
    remove(ownerId, identity, expectedVersion) {
      assertOwnedEntityScope(ownerId, identity);
      if (identity.scopeType === 'DOMAIN') {
        legacyMemoryService.remove(ownerId, legacyScope(identity), expectedVersion);
        return;
      }
      const document = readStoredDocument(ownerId, identity);
      if (!document) throw new ApiError(404, 'MEMORY_NOT_FOUND', '记忆不存在');
      assertExpectedVersion(toEntityDocument(document), expectedVersion);
      database.transaction(() => {
        database.prepare('delete from entity_memory_documents where id = ?').run(document.id);
        deleteEntityMemoryProjection(projectionRoot, ownerId, identity.scopeType, identity.scopeId);
      })();
    },
  };
}
