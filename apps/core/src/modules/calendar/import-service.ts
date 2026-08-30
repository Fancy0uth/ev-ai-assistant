import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { APP_VERSION, type CourseImport, type CreateCourseImportInput, type ExternalDisclosure, type LocalArtifact } from '@ev/contracts';
import { ApiError } from '../../http/api-error';
import type { CapabilityRegistry } from '../providers/capabilities';
import { createArtifactStore, type ArtifactStore } from './artifact-store';
import { ImageMetadataError, readImageMetadata } from './image-metadata';
import { createCourseImportRepository, type CourseImportRepository } from './import-repository';
import type { CalendarRepository } from './repository';

const MAX_IMAGE_BYTES = 5_000_000;
export interface CourseImportResult { import: CourseImport; disclosure: ExternalDisclosure; }
export interface CourseImportService {
  uploadArtifact(ownerId: string, mediaType: LocalArtifact['mediaType'], bytes: Uint8Array): Promise<{ artifact: LocalArtifact; deduplicated: boolean }>;
  deleteArtifact(ownerId: string, artifactId: string): Promise<void>;
  create(ownerId: string, input: CreateCourseImportInput): CourseImportResult;
  findById(ownerId: string, importId: string): CourseImportResult;
}

export function createCourseImportService(
  database: Database.Database,
  calendarRepository: CalendarRepository,
  artifactRoot: string,
  capabilities: CapabilityRegistry,
  options: { now?: () => Date; newId?: () => string; repository?: CourseImportRepository; store?: ArtifactStore } = {},
): CourseImportService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const repository = options.repository ?? createCourseImportRepository(database);
  const store = options.store ?? createArtifactStore(artifactRoot);
  const importDisclosures = new Map<string, ExternalDisclosure>();

  function disclosure(): ExternalDisclosure {
    const capability = capabilities.visionDisclosure();
    return {
      version: 'CAPABILITY_DISCLOSURE_V1', purpose: '提取课表候选',
      selectedData: ['课表图片', '学期时区', '第一教学周周一'],
      providerId: capability.providerId, providerLabel: capability.providerLabel,
      adapterKind: capability.adapterKind, evidenceKind: capability.evidenceKind,
    };
  }
  function metadataError(error: unknown): never {
    if (!(error instanceof ImageMetadataError)) throw error;
    const message = error.code === 'IMAGE_SIGNATURE_MISMATCH' ? '图片类型与文件签名不匹配'
      : error.code === 'IMAGE_PIXEL_LIMIT_EXCEEDED' ? '图片像素超过限制' : '图片尺寸无效';
    throw new ApiError(422, error.code, message);
  }

  return {
    async uploadArtifact(ownerId, mediaType, bytes) {
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, 'IMAGE_TOO_LARGE', '课表截图不能超过 5 MB');
      let metadata: Pick<LocalArtifact, 'mediaType' | 'byteSize' | 'width' | 'height' | 'pixelCount' | 'sha256'>;
      try { metadata = readImageMetadata(bytes, mediaType); } catch (error) { return metadataError(error); }
      const replay = repository.findActiveArtifactByHash(ownerId, metadata.sha256);
      if (replay) return { artifact: replay, deduplicated: true };
      let written: { storageKey: string };
      try { written = await store.write(ownerId, bytes); }
      catch { throw new ApiError(503, 'ARTIFACT_STORE_UNAVAILABLE', '本地图片存储暂时不可用'); }
      const timestamp = now().toISOString();
      try {
        const artifact = repository.insertArtifact({
          id: newId(), ownerId, ...metadata, kind: 'COURSE_SCHEDULE_IMAGE', storageKey: written.storageKey,
          state: 'ACTIVE', version: 1, createdAt: timestamp, deleteRequestedAt: null, deletedAt: null,
        });
        return { artifact, deduplicated: false };
      } catch (error) {
        await store.remove(written.storageKey).catch(() => undefined);
        throw error;
      }
    },
    async deleteArtifact(ownerId, artifactId) {
      const existing = repository.findArtifact(ownerId, artifactId);
      if (!existing) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', '课表图片不存在');
      if (existing.state === 'DELETED') return;
      const pending = existing.state === 'ACTIVE'
        ? repository.requestArtifactDelete(ownerId, artifactId, now().toISOString()) : existing;
      const storageKey = repository.findArtifactStorageKey(ownerId, artifactId);
      if (!pending || !storageKey) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', '课表图片不存在');
      try { await store.remove(storageKey); }
      catch { throw new ApiError(503, 'ARTIFACT_DELETE_FAILED', '本地图片删除暂未完成'); }
      repository.markArtifactDeleted(ownerId, artifactId, now().toISOString());
    },
    create(ownerId, input) {
      if (!calendarRepository.findTerm(ownerId, input.termId)) throw new ApiError(404, 'TERM_NOT_FOUND', '学期不存在');
      const artifact = repository.findArtifact(ownerId, input.artifactId);
      if (!artifact) throw new ApiError(404, 'ARTIFACT_NOT_FOUND', '课表图片不存在');
      if (artifact.state !== 'ACTIVE') throw new ApiError(409, 'ARTIFACT_NOT_ACTIVE', '课表图片当前不可用于导入');
      const disclosureValue = disclosure();
      const timestamp = now().toISOString();
      const importId = newId();
      const capabilityRunId = newId();
      const status: CourseImport['status'] = capabilities.vision ? 'AWAITING_DISCLOSURE' : 'BLOCKED_PROVIDER';
      repository.insertCapabilityRun({
        id: capabilityRunId, ownerId, resourceId: importId,
        status: status === 'BLOCKED_PROVIDER' ? 'BLOCKED_PROVIDER' : 'AWAITING_DISCLOSURE',
        disclosure: disclosureValue, timestamp, appVersion: APP_VERSION,
      });
      const imported = repository.insertImport({
        id: importId, ownerId, termId: input.termId, artifactId: input.artifactId, capabilityRunId, status,
        currentRevisionId: null, scheduleProposalId: null,
        failureCode: status === 'BLOCKED_PROVIDER' ? 'VISION_PROVIDER_NOT_CONFIGURED' : null,
        version: 1, createdAt: timestamp, updatedAt: timestamp,
      });
      importDisclosures.set(imported.id, disclosureValue);
      return { import: imported, disclosure: disclosureValue };
    },
    findById(ownerId, importId) {
      const row = database.prepare(`select id, term_id, artifact_id, capability_run_id, status, current_revision_id, schedule_proposal_id, failure_code, version, created_at, updated_at from course_imports_v2 where id = ? and owner_id = ?`).get(importId, ownerId) as {
        id: string; term_id: string; artifact_id: string; capability_run_id: string; status: CourseImport['status']; current_revision_id: string | null; schedule_proposal_id: string | null; failure_code: string | null; version: number; created_at: string; updated_at: string;
      } | undefined;
      if (!row) throw new ApiError(404, 'COURSE_IMPORT_NOT_FOUND', '课表导入记录不存在');
      return {
        import: { id: row.id, termId: row.term_id, artifactId: row.artifact_id, capabilityRunId: row.capability_run_id, status: row.status, currentRevisionId: row.current_revision_id, scheduleProposalId: row.schedule_proposal_id, failureCode: row.failure_code, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at },
        disclosure: importDisclosures.get(importId) ?? disclosure(),
      };
    },
  };
}
