import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type {
  EntityMemoryDocument,
  EntityMemoryIdentity,
  EntityMemoryRevisionHook,
  createEntityMemoryService,
} from './entity-service';
import type { MemoryRevisionHook } from './service';

type MemoryCompactionMode = 'LOCAL_RULES' | 'EXTERNAL';
type MemoryCompactionTrigger = 'MANUAL' | 'THRESHOLD';
type MemoryCompactionStatus = 'PENDING' | 'REJECTED' | 'ACCEPTED' | 'BLOCKED' | 'FAILED' | 'INVALIDATED';

interface SourceRevision {
  id: string;
  version: number;
  contentBytes: number;
}

interface DiffSegment {
  segment: string;
  sourceIndexes: number[];
}

interface CompactionDiff {
  kept: DiffSegment[];
  merged: DiffSegment[];
}

export interface MemoryCompactionDraft {
  id: string;
  scopeType: EntityMemoryIdentity['scopeType'];
  scopeId: string;
  mode: MemoryCompactionMode;
  trigger: MemoryCompactionTrigger;
  status: MemoryCompactionStatus;
  baseVersion: number;
  sourceRevisions: SourceRevision[];
  content: string | null;
  summary: string;
  diff: CompactionDiff | null;
  inputBytes: number;
  outputBytes: number | null;
  byteBudget: 16_384;
  failureCode: string | null;
  resultRevisionVersion: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  invalidatedAt: string | null;
}

interface DraftRow {
  id: string;
  scope_type: EntityMemoryIdentity['scopeType'];
  scope_id: string;
  mode: MemoryCompactionMode;
  trigger: MemoryCompactionTrigger;
  status: MemoryCompactionStatus;
  base_version: number;
  source_revisions_json: string;
  content: string | null;
  summary: string;
  diff_json: string | null;
  input_bytes: number;
  output_bytes: number | null;
  byte_budget: 16_384;
  failure_code: string | null;
  result_revision_version: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  invalidated_at: string | null;
}

interface RevisionAggregateRow {
  revision_count: number;
  content_bytes: number;
}

interface EntityRevisionMetadataRow {
  id: string;
  version: number;
  content_bytes: number;
}

interface MemoryCompactionEvent {
  module: 'memory-compaction';
  mode: MemoryCompactionMode;
  elapsedMs: number;
  status: MemoryCompactionStatus | 'SKIPPED';
  revisionId?: string;
  draftId?: string;
  failureCode?: string;
}

interface MemoryCompactionServiceOptions {
  now?: () => Date;
  newId?: () => string;
  onEvent?: (event: MemoryCompactionEvent) => void;
}

const byteBudget = 16_384 as const;
const automaticByteThreshold = 32_768;
const automaticRevisionThreshold = 20;

function toDraft(row: DraftRow): MemoryCompactionDraft {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    mode: row.mode,
    trigger: row.trigger,
    status: row.status,
    baseVersion: row.base_version,
    sourceRevisions: JSON.parse(row.source_revisions_json) as SourceRevision[],
    content: row.content,
    summary: row.summary,
    diff: row.diff_json === null ? null : JSON.parse(row.diff_json) as CompactionDiff,
    inputBytes: row.input_bytes,
    outputBytes: row.output_bytes,
    byteBudget: row.byte_budget,
    failureCode: row.failure_code,
    resultRevisionVersion: row.result_revision_version,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    invalidatedAt: row.invalidated_at,
  };
}

function versionConflict(actualVersion: number | null): ApiError {
  return new ApiError(409, 'MEMORY_VERSION_CONFLICT', '记忆已被更新，请先读取最新版本', { actualVersion });
}

function unavailableDraft(): ApiError {
  return new ApiError(409, 'MEMORY_COMPACTION_DRAFT_UNAVAILABLE', '记忆压缩草案已不可用');
}

function draftVersionConflict(actualVersion: number): ApiError {
  return new ApiError(409, 'MEMORY_COMPACTION_DRAFT_VERSION_CONFLICT', '记忆压缩草案已被更新，请先读取最新版本', { actualVersion });
}

function compactExactDuplicateSegments(content: string): {
  content: string;
  diff: CompactionDiff;
  duplicateCount: number;
} {
  const segments = content.split(/\n{2,}/).filter((segment) => segment.length > 0);
  const locations = new Map<string, number[]>();
  const ordered: string[] = [];
  for (const [index, segment] of segments.entries()) {
    const existing = locations.get(segment);
    if (existing) {
      existing.push(index);
    } else {
      locations.set(segment, [index]);
      ordered.push(segment);
    }
  }
  const kept = ordered.map((segment) => ({ segment, sourceIndexes: locations.get(segment)! }));
  return {
    content: ordered.join('\n\n'),
    diff: { kept, merged: kept.filter(({ sourceIndexes }) => sourceIndexes.length > 1) },
    duplicateCount: segments.length - ordered.length,
  };
}

function identityKey(ownerId: string, identity: EntityMemoryIdentity): string {
  return `${ownerId}\u0000${identity.scopeType}\u0000${identity.scopeId}`;
}

function failureCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'AUTO_COMPACTION_FAILED';
}

export function createMemoryCompactionService(
  database: Database.Database,
  entityMemoryService: ReturnType<typeof createEntityMemoryService>,
  options: MemoryCompactionServiceOptions = {},
): {
  createManualDraft(ownerId: string, input: {
    identity: EntityMemoryIdentity;
    mode: MemoryCompactionMode;
    expectedVersion: number;
  }): { draft: MemoryCompactionDraft; reused: boolean };
  listDrafts(ownerId: string, identity: EntityMemoryIdentity): MemoryCompactionDraft[];
  getDraft(ownerId: string, draftId: string): MemoryCompactionDraft | undefined;
  reject(ownerId: string, draftId: string, expectedDraftVersion: number): MemoryCompactionDraft;
  confirm(ownerId: string, draftId: string, input: {
    expectedVersion: number;
    expectedDraftVersion: number;
  }): { draft: MemoryCompactionDraft; document: EntityMemoryDocument };
  restore(ownerId: string, draftId: string, input: {
    expectedVersion: number;
    revisionVersion: number;
  }): { draft: MemoryCompactionDraft; document: EntityMemoryDocument };
  onLegacyRevisionAppended(event: Parameters<MemoryRevisionHook['onRevisionAppended']>[0]): void;
  onEntityRevisionAppended(event: Parameters<EntityMemoryRevisionHook['onRevisionAppended']>[0]): void;
} {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const findDraft = database.prepare(
    `select id, scope_type, scope_id, mode, trigger, status, base_version, source_revisions_json,
            content, summary, diff_json, input_bytes, output_bytes, byte_budget, failure_code,
            result_revision_version, version, created_at, updated_at, decided_at, invalidated_at
     from memory_compaction_drafts where owner_id = ? and id = ?`,
  );
  const findPendingDraft = database.prepare(
    `select id, scope_type, scope_id, mode, trigger, status, base_version, source_revisions_json,
            content, summary, diff_json, input_bytes, output_bytes, byte_budget, failure_code,
            result_revision_version, version, created_at, updated_at, decided_at, invalidated_at
     from memory_compaction_drafts
     where owner_id = ? and scope_type = ? and scope_id = ? and base_version = ? and status = 'PENDING'`,
  );
  const listDraftRows = database.prepare(
    `select id, scope_type, scope_id, mode, trigger, status, base_version, source_revisions_json,
            content, summary, diff_json, input_bytes, output_bytes, byte_budget, failure_code,
            result_revision_version, version, created_at, updated_at, decided_at, invalidated_at
     from memory_compaction_drafts
     where owner_id = ? and scope_type = ? and scope_id = ?
     order by created_at desc, id desc`,
  );
  const findCurrentEntityRevision = database.prepare(
    `select id, version, content_bytes
     from entity_memory_revisions
     where owner_id = ? and scope_type = ? and scope_id = ? and version = ?`,
  );
  const aggregateLegacyRevisions = database.prepare(
    `select count(*) as revision_count, coalesce(sum(length(cast(content as blob))), 0) as content_bytes
     from memory_revisions
     where owner_id = ? and scope = ? and version > ?`,
  );
  const aggregateEntityRevisions = database.prepare(
    `select count(*) as revision_count, coalesce(sum(content_bytes), 0) as content_bytes
     from entity_memory_revisions
     where owner_id = ? and scope_type = ? and scope_id = ? and version > ?`,
  );
  const findBaseline = database.prepare(
    'select processed_version from memory_compaction_baselines where owner_id = ? and scope_type = ? and scope_id = ?',
  );
  const upsertBaseline = database.prepare(
    `insert into memory_compaction_baselines (owner_id, scope_type, scope_id, processed_version, processed_at)
     values (?, ?, ?, ?, ?)
     on conflict(owner_id, scope_type, scope_id) do update set
       processed_version = excluded.processed_version,
       processed_at = excluded.processed_at`,
  );
  const insertDraft = database.prepare(
    `insert into memory_compaction_drafts (
       id, owner_id, scope_type, scope_id, mode, trigger, status, base_version,
       source_revisions_json, content, summary, diff_json, input_bytes, output_bytes,
       byte_budget, failure_code, result_revision_version, version, created_at, updated_at,
       decided_at, invalidated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 1, ?, ?, null, null)`,
  );
  const insertRevisionLink = database.prepare(
    `insert into memory_compaction_revision_links (
       id, draft_id, owner_id, scope_type, scope_id, relation, source_revision_version,
       result_revision_version, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const acceptPendingDraft = database.prepare(
    `update memory_compaction_drafts
     set status = 'ACCEPTED', result_revision_version = ?, version = version + 1,
         updated_at = ?, decided_at = ?
     where owner_id = ? and id = ? and status = 'PENDING' and version = ? and base_version = ?`,
  );
  const applying = new Set<string>();

  function emit(event: Omit<MemoryCompactionEvent, 'module'>): void {
    options.onEvent?.({ module: 'memory-compaction', ...event });
  }

  function readDraft(ownerId: string, draftId: string): MemoryCompactionDraft | undefined {
    const row = findDraft.get(ownerId, draftId) as DraftRow | undefined;
    return row ? toDraft(row) : undefined;
  }

  function sourceRevisions(
    ownerId: string,
    identity: EntityMemoryIdentity,
    document: EntityMemoryDocument,
  ): SourceRevision[] {
    if (identity.scopeType === 'DOMAIN') {
      return [{
        id: `legacy:${identity.scopeId}:${document.version}`,
        version: document.version,
        contentBytes: Buffer.byteLength(document.content, 'utf8'),
      }];
    }
    const revision = findCurrentEntityRevision.get(
      ownerId,
      identity.scopeType,
      identity.scopeId,
      document.version,
    ) as EntityRevisionMetadataRow | undefined;
    if (!revision) throw new Error('entity memory revision disappeared');
    return [{ id: revision.id, version: revision.version, contentBytes: revision.content_bytes }];
  }

  function accumulatedRevisionStats(
    ownerId: string,
    identity: EntityMemoryIdentity,
    processedVersion: number,
  ): RevisionAggregateRow {
    if (identity.scopeType === 'DOMAIN') {
      return aggregateLegacyRevisions.get(ownerId, identity.scopeId, processedVersion) as RevisionAggregateRow;
    }
    return aggregateEntityRevisions.get(
      ownerId,
      identity.scopeType,
      identity.scopeId,
      processedVersion,
    ) as RevisionAggregateRow;
  }

  function insertDraftRecord(input: {
    ownerId: string;
    identity: EntityMemoryIdentity;
    mode: MemoryCompactionMode;
    trigger: MemoryCompactionTrigger;
    status: MemoryCompactionStatus;
    baseVersion: number;
    sourceRevisions: SourceRevision[];
    content: string | null;
    summary: string;
    diff: CompactionDiff | null;
    inputBytes: number;
    outputBytes: number | null;
    failureCode: string | null;
  }): MemoryCompactionDraft {
    const timestamp = now().toISOString();
    const id = newId();
    insertDraft.run(
      id,
      input.ownerId,
      input.identity.scopeType,
      input.identity.scopeId,
      input.mode,
      input.trigger,
      input.status,
      input.baseVersion,
      JSON.stringify(input.sourceRevisions),
      input.content,
      input.summary,
      input.diff === null ? null : JSON.stringify(input.diff),
      input.inputBytes,
      input.outputBytes,
      byteBudget,
      input.failureCode,
      timestamp,
      timestamp,
    );
    const draft = readDraft(input.ownerId, id);
    if (!draft) throw new Error('memory compaction draft disappeared');
    return draft;
  }

  function assertCurrentVersion(ownerId: string, identity: EntityMemoryIdentity, expectedVersion: number) {
    const document = entityMemoryService.read(ownerId, identity);
    if (!document) throw new ApiError(404, 'MEMORY_NOT_FOUND', '记忆不存在');
    if (document.version !== expectedVersion) throw versionConflict(document.version);
    return document;
  }

  function createLocalRulesDraft(
    ownerId: string,
    identity: EntityMemoryIdentity,
    trigger: MemoryCompactionTrigger,
    expectedVersion: number,
  ): { draft: MemoryCompactionDraft; reused: boolean } {
    const startedAt = Date.now();
    const document = assertCurrentVersion(ownerId, identity, expectedVersion);
    const pending = findPendingDraft.get(ownerId, identity.scopeType, identity.scopeId, document.version) as DraftRow | undefined;
    if (pending) {
      const draft = toDraft(pending);
      emit({ mode: 'LOCAL_RULES', elapsedMs: Date.now() - startedAt, status: draft.status, draftId: draft.id });
      return { draft, reused: true };
    }
    const revisions = sourceRevisions(ownerId, identity, document);
    const inputBytes = Buffer.byteLength(document.content, 'utf8');
    const compacted = compactExactDuplicateSegments(document.content);
    const outputBytes = Buffer.byteLength(compacted.content, 'utf8');
    let status: MemoryCompactionStatus = 'PENDING';
    let content: string | null = compacted.content;
    let diff: CompactionDiff | null = compacted.diff;
    let summary = `精确合并 ${compacted.duplicateCount} 个重复段，保留 ${compacted.diff.kept.length} 个段。`;
    let draftFailureCode: string | null = null;
    if (compacted.duplicateCount === 0) {
      status = 'BLOCKED';
      content = null;
      diff = null;
      summary = '未发现可精确合并的重复段，需人工处理。';
      draftFailureCode = 'NO_EXACT_DUPLICATE_SEGMENTS';
    } else if (outputBytes > inputBytes || outputBytes > byteBudget) {
      status = 'BLOCKED';
      content = null;
      diff = null;
      summary = '去重后仍超过规则字节预算，需人工处理。';
      draftFailureCode = 'UNIQUE_CONTENT_EXCEEDS_BYTE_BUDGET';
    }
    const draft = insertDraftRecord({
      ownerId,
      identity,
      mode: 'LOCAL_RULES',
      trigger,
      status,
      baseVersion: document.version,
      sourceRevisions: revisions,
      content,
      summary,
      diff,
      inputBytes,
      outputBytes,
      failureCode: draftFailureCode,
    });
    upsertBaseline.run(ownerId, identity.scopeType, identity.scopeId, document.version, now().toISOString());
    emit({ mode: 'LOCAL_RULES', elapsedMs: Date.now() - startedAt, status: draft.status, draftId: draft.id });
    return { draft, reused: false };
  }

  function recordAutomaticFailure(
    ownerId: string,
    identity: EntityMemoryIdentity,
    revisionId: string,
    error: unknown,
  ): void {
    const startedAt = Date.now();
    try {
      const document = entityMemoryService.read(ownerId, identity);
      if (!document) return;
      const draft = insertDraftRecord({
        ownerId,
        identity,
        mode: 'LOCAL_RULES',
        trigger: 'THRESHOLD',
        status: 'FAILED',
        baseVersion: document.version,
        sourceRevisions: [],
        content: null,
        summary: '自动规则草案未生成，需人工处理。',
        diff: null,
        inputBytes: Buffer.byteLength(document.content, 'utf8'),
        outputBytes: null,
        failureCode: failureCode(error),
      });
      upsertBaseline.run(ownerId, identity.scopeType, identity.scopeId, document.version, now().toISOString());
      emit({
        mode: 'LOCAL_RULES',
        elapsedMs: Date.now() - startedAt,
        status: 'FAILED',
        revisionId,
        draftId: draft.id,
        ...(draft.failureCode === null ? {} : { failureCode: draft.failureCode }),
      });
    } catch {
      emit({
        mode: 'LOCAL_RULES',
        elapsedMs: Date.now() - startedAt,
        status: 'FAILED',
        revisionId,
        failureCode: failureCode(error),
      });
    }
  }

  function triggerAutomaticDraft(ownerId: string, identity: EntityMemoryIdentity, revisionId: string): void {
    const startedAt = Date.now();
    if (applying.has(identityKey(ownerId, identity))) {
      emit({ mode: 'LOCAL_RULES', elapsedMs: Date.now() - startedAt, status: 'SKIPPED', revisionId });
      return;
    }
    try {
      const document = entityMemoryService.read(ownerId, identity);
      if (!document) return;
      const baseline = findBaseline.get(ownerId, identity.scopeType, identity.scopeId) as { processed_version: number } | undefined;
      const stats = accumulatedRevisionStats(ownerId, identity, baseline?.processed_version ?? 0);
      if (stats.revision_count < automaticRevisionThreshold && stats.content_bytes < automaticByteThreshold) {
        emit({ mode: 'LOCAL_RULES', elapsedMs: Date.now() - startedAt, status: 'SKIPPED', revisionId });
        return;
      }
      createLocalRulesDraft(ownerId, identity, 'THRESHOLD', document.version);
    } catch (error) {
      recordAutomaticFailure(ownerId, identity, revisionId, error);
    }
  }

  function requirePendingDraft(ownerId: string, draftId: string, expectedDraftVersion?: number): MemoryCompactionDraft {
    const draft = readDraft(ownerId, draftId);
    if (!draft || draft.status !== 'PENDING' || draft.mode !== 'LOCAL_RULES' || draft.content === null || draft.diff === null) {
      throw unavailableDraft();
    }
    if (expectedDraftVersion !== undefined && draft.version !== expectedDraftVersion) {
      throw draftVersionConflict(draft.version);
    }
    return draft;
  }

  function applyGuard(ownerId: string, identity: EntityMemoryIdentity, action: () => void): void {
    const key = identityKey(ownerId, identity);
    applying.add(key);
    try {
      action();
    } finally {
      applying.delete(key);
    }
  }

  return {
    createManualDraft(ownerId, input) {
      if (input.mode === 'EXTERNAL') {
        emit({ mode: 'EXTERNAL', elapsedMs: 0, status: 'FAILED', failureCode: 'MEMORY_COMPACTION_PROVIDER_UNAVAILABLE' });
        throw new ApiError(503, 'MEMORY_COMPACTION_PROVIDER_UNAVAILABLE', '外部记忆压缩服务未配置');
      }
      return createLocalRulesDraft(ownerId, input.identity, 'MANUAL', input.expectedVersion);
    },
    listDrafts(ownerId, identity) {
      entityMemoryService.read(ownerId, identity);
      return (listDraftRows.all(ownerId, identity.scopeType, identity.scopeId) as DraftRow[]).map(toDraft);
    },
    getDraft: readDraft,
    reject(ownerId, draftId, expectedDraftVersion) {
      requirePendingDraft(ownerId, draftId, expectedDraftVersion);
      const timestamp = now().toISOString();
      const result = database.prepare(
        `update memory_compaction_drafts
         set status = 'REJECTED', version = version + 1, updated_at = ?, decided_at = ?
         where owner_id = ? and id = ? and status = 'PENDING' and version = ?`,
      ).run(timestamp, timestamp, ownerId, draftId, expectedDraftVersion);
      if (result.changes !== 1) throw unavailableDraft();
      const updated = readDraft(ownerId, draftId);
      if (!updated) throw new Error('memory compaction draft disappeared');
      emit({ mode: updated.mode, elapsedMs: 0, status: updated.status, draftId: updated.id });
      return updated;
    },
    confirm(ownerId, draftId, input) {
      const startedAt = Date.now();
      const draft = requirePendingDraft(ownerId, draftId, input.expectedDraftVersion);
      const identity: EntityMemoryIdentity = { scopeType: draft.scopeType, scopeId: draft.scopeId };
      let document: EntityMemoryDocument | undefined;
      let acceptedDraft: MemoryCompactionDraft | undefined;
      let revisionId: string | undefined;
      applyGuard(ownerId, identity, () => {
        document = entityMemoryService.writeForCompaction(
          ownerId,
          identity,
          draft.content!,
          input.expectedVersion,
          ({ document: nextDocument, revision }) => {
            const previousVersion = nextDocument.version - 1;
            if (previousVersion !== draft.baseVersion) throw versionConflict(previousVersion);
            const timestamp = now().toISOString();
            const update = acceptPendingDraft.run(
              nextDocument.version,
              timestamp,
              timestamp,
              ownerId,
              draftId,
              input.expectedDraftVersion,
              draft.baseVersion,
            );
            if (update.changes !== 1) throw unavailableDraft();
            insertRevisionLink.run(
              newId(),
              draftId,
              ownerId,
              identity.scopeType,
              identity.scopeId,
              'COMPACTION',
              draft.baseVersion,
              nextDocument.version,
              timestamp,
            );
            acceptedDraft = {
              ...draft,
              status: 'ACCEPTED',
              resultRevisionVersion: nextDocument.version,
              version: draft.version + 1,
              updatedAt: timestamp,
              decidedAt: timestamp,
            };
            revisionId = revision.id;
          },
        );
      });
      if (!document || !acceptedDraft) throw new Error('memory compaction confirmation did not write a document');
      emit({
        mode: acceptedDraft.mode,
        elapsedMs: Date.now() - startedAt,
        status: acceptedDraft.status,
        draftId: acceptedDraft.id,
        ...(revisionId === undefined ? {} : { revisionId }),
      });
      return { draft: acceptedDraft, document };
    },
    restore(ownerId, draftId, input) {
      const startedAt = Date.now();
      const draft = readDraft(ownerId, draftId);
      if (!draft || draft.status !== 'ACCEPTED' || draft.mode !== 'LOCAL_RULES') throw unavailableDraft();
      if (!draft.sourceRevisions.some(({ version }) => version === input.revisionVersion)) throw unavailableDraft();
      const identity: EntityMemoryIdentity = { scopeType: draft.scopeType, scopeId: draft.scopeId };
      let document: EntityMemoryDocument | undefined;
      let restoredDraft: MemoryCompactionDraft | undefined;
      let revisionId: string | undefined;
      applyGuard(ownerId, identity, () => {
        document = entityMemoryService.restoreForCompaction(
          ownerId,
          identity,
          input.revisionVersion,
          input.expectedVersion,
          ({ document: nextDocument, revision }) => {
            const currentDraft = readDraft(ownerId, draftId);
            if (!currentDraft || currentDraft.status !== 'ACCEPTED' || currentDraft.mode !== 'LOCAL_RULES') {
              throw unavailableDraft();
            }
            if (!currentDraft.sourceRevisions.some(({ version }) => version === input.revisionVersion)) {
              throw unavailableDraft();
            }
            insertRevisionLink.run(
              newId(),
              draftId,
              ownerId,
              identity.scopeType,
              identity.scopeId,
              'RESTORE',
              input.revisionVersion,
              nextDocument.version,
              now().toISOString(),
            );
            restoredDraft = currentDraft;
            revisionId = revision.id;
          },
        );
      });
      if (!document || !restoredDraft) throw new Error('memory compaction restore did not write a document');
      emit({
        mode: restoredDraft.mode,
        elapsedMs: Date.now() - startedAt,
        status: restoredDraft.status,
        draftId: restoredDraft.id,
        ...(revisionId === undefined ? {} : { revisionId }),
      });
      return { draft: restoredDraft, document };
    },
    onLegacyRevisionAppended(event) {
      triggerAutomaticDraft(
        event.ownerId,
        { scopeType: 'DOMAIN', scopeId: event.revision.scope },
        `legacy:${event.revision.scope}:${event.revision.version}`,
      );
    },
    onEntityRevisionAppended(event) {
      triggerAutomaticDraft(event.ownerId, {
        scopeType: event.document.scopeType,
        scopeId: event.document.scopeId,
      }, event.revision.id);
    },
  };
}
