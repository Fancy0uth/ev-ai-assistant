import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type { createEntityMemoryService } from '../memory/entity-service';

export type FitnessFeedbackMemoryStatus = { state: 'RECORDED'; sourceId: string }
  | { state: 'SKIPPED_HUMAN_EDIT' | 'DEGRADED' | 'REPLAYED' };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** A committed feedback source gets one attempt, without historical rebuild or retry. */
export function createFitnessFeedbackMemory(database: Database.Database, memory: ReturnType<typeof createEntityMemoryService> | undefined,
  options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());
  const audit = database.prepare(`insert into v07_audit_events
    (id, owner_id, event_type, entity_type, entity_id, entity_version, metadata_json, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)`);
  const currentRevision = database.prepare(`select r.id from entity_memory_documents d
    join entity_memory_revisions r on r.document_id = d.id and r.version = d.version and r.owner_id = d.owner_id
    where d.owner_id = ? and d.scope_type = 'FITNESS' and d.scope_id = ? limit 1`);
  return {
    record(ownerId: string, workoutId: string, feedbackId: string): FitnessFeedbackMemoryStatus {
      if (database.inTransaction) return { state: 'DEGRADED' };
      try {
        const fact = database.prepare(`select outcome, perceived_effort, had_pain, started_at, ended_at
          from workout_feedback_v2 where owner_id = ? and workout_id = ? and id = ?`).get(ownerId, workoutId, feedbackId) as {
            outcome: string; perceived_effort: number | null; had_pain: number; started_at: string | null; ended_at: string | null;
          } | undefined;
        if (!fact) return { state: 'DEGRADED' };
        const sourceId = `feedback:${feedbackId}`;
        const attemptId = `fitness-memory-attempt:${ownerId}:${feedbackId}`;
        const claimed = database.transaction(() => {
          if (database.prepare('select id from v07_audit_events where id = ? and owner_id = ?').get(attemptId, ownerId)) return false;
          audit.run(attemptId, ownerId, 'FITNESS_MEMORY_ATTEMPT', 'FITNESS_FEEDBACK', feedbackId, 1, JSON.stringify({ sourceId }), now().toISOString());
          return true;
        }).immediate();
        if (!claimed) return { state: 'REPLAYED' };
        if (!memory) return { state: 'DEGRADED' };
        const identity = { scopeType: 'FITNESS' as const, scopeId: ownerId };
        const current = memory.read(ownerId, identity);
        let provenParentId: string | null = null;
        if (current) {
          const prior = database.prepare(`select metadata_json from v07_audit_events
            where owner_id = ? and entity_type = 'FITNESS_AUTO_MEMORY' and entity_id = ?
            order by created_at desc, rowid desc limit 1`).get(ownerId, ownerId) as { metadata_json: string } | undefined;
          const proof = prior ? JSON.parse(prior.metadata_json) as { contentHash?: string; version?: number; revisionId?: string } : undefined;
          const revision = currentRevision.get(ownerId, ownerId) as { id: string } | undefined;
          if (!proof || proof.contentHash !== hash(current.content) || proof.version !== current.version || proof.revisionId !== revision?.id) return { state: 'SKIPPED_HUMAN_EDIT' };
          if (!revision) return { state: 'SKIPPED_HUMAN_EDIT' };
          provenParentId = revision.id;
        }
        const seconds = fact.started_at && fact.ended_at ? (Date.parse(fact.ended_at) - Date.parse(fact.started_at)) / 1000 : null;
        // Only this fact; no free text, prior facts, inferred disease status or model advice.
        const content = `用户训练反馈（非医学判断）\nsourceId: ${sourceId}\nworkoutId: ${workoutId}\n结果: ${fact.outcome}\n实际秒数: ${seconds ?? 'UNKNOWN'}\n自述用力: ${fact.perceived_effort ?? 'UNKNOWN'}\n自述疼痛: ${fact.had_pain === 1 ? 'YES' : 'NO'}`;
        type GuardedWrite = typeof memory.writeForCompaction;
        type GuardedArgs = Parameters<GuardedWrite>;
        // FITNESS delegates to appendEntityRevision (source WRITE), whose CAS accepts null
        // for absence. Keep this runtime-supported widening local to the helper.
        const writeWithParent = memory.writeForCompaction as (
          owner: string, scope: GuardedArgs[1], text: string, expectedVersion: number | null,
          beforeProjection: GuardedArgs[4],
        ) => ReturnType<GuardedWrite>;
        writeWithParent(ownerId, identity, content, current?.version ?? null, ({ document, revision }) => {
          // Numeric versions can restart after deletion. Validate UUID lineage inside
          // the write transaction, before any filesystem projection can overwrite it.
          if (revision.source !== 'WRITE' || revision.parentRevisionId !== provenParentId || revision.sourceRevisionId !== provenParentId) {
            throw new ApiError(409, 'MEMORY_VERSION_CONFLICT', 'Fitness memory parent changed');
          }
          audit.run(randomUUID(), ownerId, 'FITNESS_MEMORY_WRITTEN', 'FITNESS_AUTO_MEMORY', ownerId, document.version,
            JSON.stringify({ sourceId, contentHash: hash(document.content), version: document.version, revisionId: revision.id }), now().toISOString());
        });
        return { state: 'RECORDED', sourceId };
      } catch { return { state: 'DEGRADED' }; }
    },
  };
}
