import type { CourseImport, ExternalDisclosure, LocalArtifact } from '@ev/contracts';
import type Database from 'better-sqlite3';

interface ArtifactRow {
  id: string; media_type: LocalArtifact['mediaType']; byte_size: number; width: number; height: number;
  pixel_count: number; sha256: string; state: LocalArtifact['state']; version: number;
  created_at: string; delete_requested_at: string | null; deleted_at: string | null;
}
interface ImportRow {
  id: string; term_id: string; artifact_id: string; capability_run_id: string; status: CourseImport['status'];
  current_revision_id: string | null; schedule_proposal_id: string | null; failure_code: string | null;
  version: number; created_at: string; updated_at: string;
}

function toArtifact(row: ArtifactRow): LocalArtifact {
  return {
    id: row.id, kind: 'COURSE_SCHEDULE_IMAGE', mediaType: row.media_type, byteSize: row.byte_size,
    width: row.width, height: row.height, pixelCount: row.pixel_count, sha256: row.sha256,
    state: row.state, version: row.version, createdAt: row.created_at,
    deleteRequestedAt: row.delete_requested_at, deletedAt: row.deleted_at,
  };
}
function toImport(row: ImportRow): CourseImport {
  return {
    id: row.id, termId: row.term_id, artifactId: row.artifact_id, capabilityRunId: row.capability_run_id,
    status: row.status, currentRevisionId: row.current_revision_id, scheduleProposalId: row.schedule_proposal_id,
    failureCode: row.failure_code, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export interface CourseImportRepository {
  findActiveArtifactByHash(ownerId: string, sha256: string): LocalArtifact | undefined;
  findArtifact(ownerId: string, id: string): LocalArtifact | undefined;
  findArtifactStorageKey(ownerId: string, id: string): string | undefined;
  insertArtifact(input: LocalArtifact & { ownerId: string; storageKey: string }): LocalArtifact;
  requestArtifactDelete(ownerId: string, id: string, timestamp: string): LocalArtifact | undefined;
  markArtifactDeleted(ownerId: string, id: string, timestamp: string): LocalArtifact | undefined;
  insertImport(input: CourseImport & { ownerId: string }): CourseImport;
  insertCapabilityRun(input: {
    id: string; ownerId: string; resourceId: string; status: 'BLOCKED_PROVIDER' | 'AWAITING_DISCLOSURE';
    disclosure: ExternalDisclosure; timestamp: string; appVersion: string;
  }): void;
}

const artifactColumns = `id, media_type, byte_size, width, height, pixel_count, sha256, state, version, created_at, delete_requested_at, deleted_at`;
const importColumns = `id, term_id, artifact_id, capability_run_id, status, current_revision_id, schedule_proposal_id, failure_code, version, created_at, updated_at`;

export function createCourseImportRepository(database: Database.Database): CourseImportRepository {
  const findArtifact = database.prepare(`select ${artifactColumns} from local_artifacts where id = ? and owner_id = ?`);
  return {
    findActiveArtifactByHash(ownerId, sha256) {
      const row = database.prepare(`select ${artifactColumns} from local_artifacts where owner_id = ? and sha256 = ? and state = 'ACTIVE' order by created_at asc, id asc limit 1`).get(ownerId, sha256) as ArtifactRow | undefined;
      return row ? toArtifact(row) : undefined;
    },
    findArtifact(ownerId, id) {
      const row = findArtifact.get(id, ownerId) as ArtifactRow | undefined;
      return row ? toArtifact(row) : undefined;
    },
    findArtifactStorageKey(ownerId, id) {
      const row = database.prepare('select storage_key from local_artifacts where id = ? and owner_id = ?').get(id, ownerId) as { storage_key: string } | undefined;
      return row?.storage_key;
    },
    insertArtifact(input) {
      database.prepare(`insert into local_artifacts (
        id, owner_id, kind, storage_key, media_type, byte_size, width, height, pixel_count, sha256,
        state, created_at, delete_requested_at, deleted_at, version
      ) values (?, ?, 'COURSE_SCHEDULE_IMAGE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.id, input.ownerId, input.storageKey, input.mediaType, input.byteSize, input.width, input.height,
          input.pixelCount, input.sha256, input.state, input.createdAt, input.deleteRequestedAt, input.deletedAt, input.version);
      const artifact = this.findArtifact(input.ownerId, input.id);
      if (!artifact) throw new Error('stored artifact disappeared');
      return artifact;
    },
    requestArtifactDelete(ownerId, id, timestamp) {
      database.prepare(`update local_artifacts set state = 'DELETE_PENDING', delete_requested_at = ?, version = version + 1 where id = ? and owner_id = ? and state = 'ACTIVE'`).run(timestamp, id, ownerId);
      return this.findArtifact(ownerId, id);
    },
    markArtifactDeleted(ownerId, id, timestamp) {
      database.prepare(`update local_artifacts set state = 'DELETED', deleted_at = ?, version = version + 1 where id = ? and owner_id = ? and state = 'DELETE_PENDING'`).run(timestamp, id, ownerId);
      return this.findArtifact(ownerId, id);
    },
    insertImport(input) {
      database.prepare(`insert into course_imports_v2 (
        id, owner_id, term_id, artifact_id, capability_run_id, status, current_revision_id, schedule_proposal_id,
        confirm_idempotency_key, confirm_request_hash, failure_code, created_at, updated_at, version
      ) values (?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?, ?)`)
        .run(input.id, input.ownerId, input.termId, input.artifactId, input.capabilityRunId, input.status,
          input.currentRevisionId, input.scheduleProposalId, input.failureCode, input.createdAt, input.updatedAt, input.version);
      const row = database.prepare(`select ${importColumns} from course_imports_v2 where id = ? and owner_id = ?`).get(input.id, input.ownerId) as ImportRow | undefined;
      if (!row) throw new Error('stored course import disappeared');
      return toImport(row);
    },
    insertCapabilityRun(input) {
      database.prepare(`insert into external_capability_runs (
        id, owner_id, capability, operation, resource_id, provider_id, provider_label, adapter_kind, evidence_kind,
        disclosure_json, disclosure_version, idempotency_key, request_hash, status, lease_token, lease_expires_at,
        deadline_at, policy_version, local_date, reserved_calls, actual_calls, input_chars, output_chars,
        failure_code, app_version, created_at, updated_at, version
      ) values (?, ?, 'COURSE_SCHEDULE_VISION', 'COURSE_IMPORT_EXTRACT', ?, ?, ?, ?, ?, ?, 'CAPABILITY_DISCLOSURE_V1',
        null, null, ?, null, null, null, 'CAPABILITY_POLICY_V1', substr(?, 1, 10), 0, 0, 0, 0, ?, ?, ?, ?, 1)`)
        .run(input.id, input.ownerId, input.resourceId, input.disclosure.providerId, input.disclosure.providerLabel,
          input.disclosure.adapterKind, input.disclosure.evidenceKind, JSON.stringify(input.disclosure), input.status,
          input.timestamp, input.status === 'BLOCKED_PROVIDER' ? 'VISION_PROVIDER_NOT_CONFIGURED' : null,
          input.appVersion, input.timestamp, input.timestamp);
    },
  };
}
