import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { APP_VERSION, courseImportRevisionSchema, visionCourseScheduleExtractionSchema, type CourseImport, type CourseImportRevision, type CreateCourseImportInput, type ExternalDisclosure, type LocalArtifact } from '@ev/contracts';
import { ApiError } from '../../http/api-error';
import { terminalEvidenceKind, type CapabilityRegistry } from '../providers/capabilities';
import { createCapabilityRunRepository } from '../providers/capability-run-repository';
import { CAPABILITY_POLICY, CapabilityExecutionError, executeCapabilityAdapter } from '../providers/provider-policy';
import { createArtifactStore, type ArtifactStore } from './artifact-store';
import { ImageMetadataError, readImageMetadata } from './image-metadata';
import { createCourseImportRepository, type CourseImportRepository } from './import-repository';
import type { CalendarRepository } from './repository';

const MAX_IMAGE_BYTES = 5_000_000;
export interface CourseImportResult { import: CourseImport; disclosure: ExternalDisclosure; revision?: CourseImportRevision | null; }
export interface ArtifactDeleteRecoveryResult {
  recovered: number;
  failures: Array<{ artifactId: string; ownerId: string; error: unknown }>;
}
export interface CourseImportService {
  uploadArtifact(ownerId: string, mediaType: LocalArtifact['mediaType'], bytes: Uint8Array): Promise<{ artifact: LocalArtifact; deduplicated: boolean }>;
  deleteArtifact(ownerId: string, artifactId: string): Promise<void>;
  recoverPendingArtifactDeletes(): Promise<ArtifactDeleteRecoveryResult>;
  create(ownerId: string, input: CreateCourseImportInput): CourseImportResult;
  findById(ownerId: string, importId: string): CourseImportResult;
  extract(ownerId: string, importId: string, input: { expectedVersion: number; disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' }, idempotencyKey: string): Promise<CourseImportResult>;
  saveRevision(ownerId: string, importId: string, input: { expectedVersion: number; parentRevisionId: string; candidates: Array<Pick<import('@ev/contracts').CourseScheduleCandidate, 'candidateId' | 'included' | 'title' | 'location' | 'weekday' | 'startLocalTime' | 'endLocalTime' | 'weekStart' | 'weekEnd' | 'weekPattern'>> }): CourseImportResult;
  confirm(ownerId: string, importId: string, input: { expectedVersion: number; revisionId: string }, idempotencyKey: string): CourseImportResult;
}

export function createCourseImportService(
  database: Database.Database,
  calendarRepository: CalendarRepository,
  artifactRoot: string,
  capabilities: CapabilityRegistry,
  options: { now?: () => Date; newId?: () => string; repository?: CourseImportRepository; store?: ArtifactStore; onExternalOperation?: (inTransaction: boolean) => void } = {},
): CourseImportService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const repository = options.repository ?? createCourseImportRepository(database);
  const capabilityRuns = createCapabilityRunRepository(database);
  const store = options.store ?? createArtifactStore(artifactRoot);
  const importDisclosures = new Map<string, ExternalDisclosure>();

  function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  function ownedResult(ownerId: string, imported: CourseImport, revision?: CourseImportRevision | null): CourseImportResult {
    const stored = database.prepare('select disclosure_json from external_capability_runs where id = ? and owner_id = ?').get(imported.capabilityRunId, ownerId) as { disclosure_json: string } | undefined;
    const base = { import: imported, disclosure: importDisclosures.get(imported.id) ?? (stored ? JSON.parse(stored.disclosure_json) : disclosure()) };
    return revision === undefined ? base : { ...base, revision };
  }

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
  function markDeleted(ownerId: string, artifactId: string, timestamp: string): LocalArtifact | undefined {
    return database.transaction(() => repository.markArtifactDeleted(ownerId, artifactId, timestamp)).immediate();
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
      const deleted = markDeleted(ownerId, artifactId, now().toISOString());
      if (!deleted && repository.findArtifact(ownerId, artifactId)?.state !== 'DELETED') {
        throw new ApiError(503, 'ARTIFACT_DELETE_FAILED', '本地图片删除暂未完成');
      }
    },
    async recoverPendingArtifactDeletes() {
      const failures: ArtifactDeleteRecoveryResult['failures'] = [];
      let recovered = 0;
      for (const pending of repository.listPendingArtifactDeletes()) {
        try {
          if (!pending.storageKey.startsWith(`${pending.ownerId}/`)) throw new Error('artifact storage key owner mismatch');
          options.onExternalOperation?.(database.inTransaction);
          await store.remove(pending.storageKey);
          const deleted = markDeleted(pending.ownerId, pending.artifactId, now().toISOString());
          if (!deleted) throw new Error('pending artifact could not be terminalized');
          recovered += 1;
        } catch (error) {
          failures.push({ artifactId: pending.artifactId, ownerId: pending.ownerId, error });
        }
      }
      return { recovered, failures };
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
      const imported = database.transaction(() => {
        repository.insertCapabilityRun({
          id: capabilityRunId, ownerId, resourceId: importId,
          status: status === 'BLOCKED_PROVIDER' ? 'BLOCKED_PROVIDER' : 'AWAITING_DISCLOSURE',
          disclosure: disclosureValue, timestamp, appVersion: APP_VERSION,
        });
        return repository.insertImport({
          id: importId, ownerId, termId: input.termId, artifactId: input.artifactId, capabilityRunId, status,
          currentRevisionId: null, scheduleProposalId: null,
          failureCode: status === 'BLOCKED_PROVIDER' ? 'VISION_PROVIDER_NOT_CONFIGURED' : null,
          version: 1, createdAt: timestamp, updatedAt: timestamp,
        });
      }).immediate();
      importDisclosures.set(imported.id, disclosureValue);
      return { import: imported, disclosure: disclosureValue, revision: null };
    },
    findById(ownerId, importId) {
      const imported = repository.findImport(ownerId, importId);
      if (!imported) throw new ApiError(404, 'COURSE_IMPORT_NOT_FOUND', '课表导入记录不存在');
      return ownedResult(ownerId, imported, repository.findCurrentRevision(ownerId, importId) ?? null);
    },
    async extract(ownerId, importId, input, idempotencyKey) {
      if (!repository.findImport(ownerId, importId)) throw new ApiError(404, 'COURSE_IMPORT_NOT_FOUND', '课表导入记录不存在');
      const requestHash = hash({ importId, ...input });
      const claimResult = database.transaction(() => {
        const existing = capabilityRuns.findByOwnerAndIdempotencyKey(ownerId, idempotencyKey);
        if (existing) {
          if (existing.resourceId !== importId || existing.requestHash !== requestHash) {
            throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求');
          }
          const replayImport = repository.findImport(ownerId, importId);
          if (existing.status === 'SUCCEEDED' && replayImport) {
            return { replay: ownedResult(ownerId, replayImport, repository.findCurrentRevision(ownerId, importId) ?? null) };
          }
          if (existing.status === 'FAILED') {
            const unavailable = replayImport?.failureCode === 'VISION_PROVIDER_UNAVAILABLE';
            throw new ApiError(unavailable ? 503 : 422, replayImport?.failureCode ?? 'VISION_RESPONSE_INVALID', unavailable ? 'Vision Provider 暂时不可用' : 'Vision 输出不符合严格课表契约');
          }
          throw new ApiError(409, 'VERSION_CONFLICT', '课表导入正在处理');
        }
        const imported = repository.findImport(ownerId, importId);
        if (!imported) throw new ApiError(404, 'COURSE_IMPORT_NOT_FOUND', '课表导入记录不存在');
        if (input.disclosureVersion !== 'CAPABILITY_DISCLOSURE_V1') throw new ApiError(409, 'VERSION_CONFLICT', '外发披露版本已变化');
        if (imported.status !== 'AWAITING_DISCLOSURE' || imported.version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '课表导入状态已变化');
        if (!capabilities.vision) throw new ApiError(503, 'VISION_PROVIDER_NOT_CONFIGURED', 'Vision Provider 未配置');
        const artifact = repository.findArtifact(ownerId, imported.artifactId);
        const storageKey = repository.findArtifactStorageKey(ownerId, imported.artifactId);
        if (!artifact || !storageKey || artifact.state !== 'ACTIVE') throw new ApiError(410, 'ARTIFACT_DELETED', '课表图片已删除');
        const timestamp = now().toISOString();
        if (!capabilityRuns.claim(ownerId, imported.capabilityRunId, idempotencyKey, requestHash, timestamp)) {
          const collision = capabilityRuns.findByOwnerAndIdempotencyKey(ownerId, idempotencyKey);
          if (collision) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求');
          if (capabilityRuns.quotaExhausted(ownerId, imported.capabilityRunId, timestamp)) {
            throw new ApiError(429, 'CAPABILITY_PROVIDER_QUOTA_EXCEEDED', '今日 Vision Provider 调用额度已用尽');
          }
          throw new ApiError(409, 'VERSION_CONFLICT', '课表导入状态已变化');
        }
        const claimed = repository.updateImport(ownerId, importId, imported.version, { status: 'EXTRACTING', timestamp });
        if (!claimed) throw new ApiError(409, 'VERSION_CONFLICT', '课表导入状态已变化');
        const capabilityRun = capabilityRuns.findByOwnerAndId(ownerId, imported.capabilityRunId);
        if (!capabilityRun?.leaseToken) throw new Error('Vision capability lease is missing');
        return { imported, claimed, artifact, storageKey, leaseToken: capabilityRun.leaseToken };
      }).immediate();
      if ('replay' in claimResult) return claimResult.replay;
      const { imported, claimed, artifact, storageKey, leaseToken } = claimResult;
      let parsed: import('@ev/contracts').VisionCourseScheduleExtraction;
      let outputChars = 0;
      try {
        options.onExternalOperation?.(database.inTransaction);
        const image = await readFile(store.resolveVerified(storageKey));
        const term = calendarRepository.findTerm(ownerId, imported.termId);
        if (!term) throw new Error('Course import term disappeared');
        const execution = await executeCapabilityAdapter({
          inputSize: image.byteLength,
          maxInputSize: CAPABILITY_POLICY.vision.maxInputBytes,
          maxOutputChars: CAPABILITY_POLICY.vision.maxOutputChars,
          timeoutMs: CAPABILITY_POLICY.vision.totalTimeoutMs,
          invoke: () => capabilities.vision!.extractCourseSchedule({
            schemaVersion: 'COURSE_SCHEDULE_EXTRACTION_V1', image, mediaType: artifact.mediaType,
            term: { timezone: term.timezone, weekOneMonday: term.weekOneMonday },
          }),
        });
        outputChars = execution.outputChars;
        parsed = visionCourseScheduleExtractionSchema.parse(execution.output);
      } catch (error) {
        const providerCallStarted = error instanceof CapabilityExecutionError ? error.providerCallStarted : outputChars > 0;
        const failureCode = error instanceof CapabilityExecutionError && ['CAPABILITY_EXECUTION_TIMEOUT', 'CAPABILITY_PROVIDER_UNAVAILABLE'].includes(error.code)
          ? 'VISION_PROVIDER_UNAVAILABLE' : 'VISION_RESPONSE_INVALID';
        const timestamp = now().toISOString();
        database.transaction(() => {
          const failed = repository.updateImport(ownerId, importId, claimed.version, { status: 'FAILED', failureCode, timestamp });
          if (!failed || !capabilityRuns.complete(ownerId, imported.capabilityRunId, {
            leaseToken, status: 'FAILED', actualCalls: providerCallStarted ? 1 : 0, inputChars: 0,
            outputChars: error instanceof CapabilityExecutionError ? error.outputChars : outputChars,
            failureCode, evidenceKind: 'NONE', now: timestamp,
          })) throw new Error('Vision failure terminalization could not be committed');
        }).immediate();
        if (error instanceof ApiError) throw error;
        throw new ApiError(failureCode === 'VISION_PROVIDER_UNAVAILABLE' ? 503 : 422, failureCode, failureCode === 'VISION_PROVIDER_UNAVAILABLE' ? 'Vision Provider 暂时不可用' : 'Vision 输出不符合严格课表契约');
      }
      const capturedAt = now().toISOString();
      const candidates = parsed.candidates.map((candidate) => ({ ...candidate, candidateId: newId(), included: true, provenance: [{ kind: 'VISION_OUTPUT' as const, providerId: capabilities.vision!.descriptor.providerId, capabilityRunId: imported.capabilityRunId, editedFields: [], capturedAt }] }));
      const revision = courseImportRevisionSchema.parse({ id: newId(), importId, parentRevisionId: null, revisionNo: 1, candidates, contentHash: hash(candidates), createdBy: 'VISION', createdAt: capturedAt });
      const finalized = database.transaction(() => {
        repository.insertRevision({ ...revision, ownerId });
        const updated = repository.updateImport(ownerId, importId, claimed.version, { status: 'REVIEW_REQUIRED', currentRevisionId: revision.id, timestamp: capturedAt });
        if (!updated) throw new ApiError(409, 'VERSION_CONFLICT', '课表导入状态已变化');
        if (!capabilityRuns.complete(ownerId, imported.capabilityRunId, {
          leaseToken, status: 'SUCCEEDED', actualCalls: 1, inputChars: 0, outputChars,
          failureCode: null, evidenceKind: terminalEvidenceKind(capabilities.vision!.descriptor.adapterKind), now: capturedAt,
        })) throw new Error('Vision success terminalization could not be committed');
        return updated;
      }).immediate();
      return ownedResult(ownerId, finalized, revision);
    },
    saveRevision(ownerId, importId, input) {
      const imported = repository.findImport(ownerId, importId);
      const parent = repository.findRevision(ownerId, input.parentRevisionId);
      if (!imported || !parent) throw new ApiError(404, 'COURSE_IMPORT_NOT_FOUND', '课表导入记录不存在');
      if (imported.status !== 'REVIEW_REQUIRED' || imported.version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '课表导入状态已变化');
      if (imported.currentRevisionId !== parent.id || parent.importId !== importId) throw new ApiError(409, 'REVISION_PARENT_STALE', '候选版本已变化');
      const values = input.candidates.map((candidate) => {
        const original = parent.candidates.find((item) => item.candidateId === candidate.candidateId);
        if (!original) throw new ApiError(422, 'CANDIDATE_REVISION_INVALID', '候选不属于当前版本');
        const editedFields = (['included', 'title', 'location', 'weekday', 'startLocalTime', 'endLocalTime', 'weekStart', 'weekEnd', 'weekPattern'] as const).filter((field) => original[field] !== candidate[field]);
        return { ...candidate, confidence: original.confidence, provenance: editedFields.length ? [...original.provenance, { kind: 'OWNER_EDIT' as const, providerId: null, capabilityRunId: null, editedFields, capturedAt: now().toISOString() }] : original.provenance };
      });
      const timestamp = now().toISOString();
      const revision = courseImportRevisionSchema.parse({ id: newId(), importId, parentRevisionId: parent.id, revisionNo: parent.revisionNo + 1, candidates: values, contentHash: hash(values), createdBy: 'OWNER', createdAt: timestamp });
      repository.insertRevision({ ...revision, ownerId });
      const updated = repository.updateImport(ownerId, importId, imported.version, { status: 'REVIEW_REQUIRED', currentRevisionId: revision.id, timestamp });
      if (!updated) throw new ApiError(409, 'VERSION_CONFLICT', '课表导入状态已变化');
      return ownedResult(ownerId, updated, revision);
    },
    confirm(ownerId, importId, input, idempotencyKey) {
      const timestamp = now().toISOString();
      const outcome = database.transaction(() => {
        const imported = repository.findImport(ownerId, importId);
        if (!imported) throw new ApiError(404, 'COURSE_IMPORT_NOT_FOUND', '课表导入记录不存在');
        const previous = database.prepare('select confirm_idempotency_key, confirm_request_hash from course_imports_v2 where id = ? and owner_id = ?').get(importId, ownerId) as { confirm_idempotency_key: string | null; confirm_request_hash: string | null };
        const requestHash = hash(input);
        if (previous.confirm_idempotency_key !== null) {
          if (previous.confirm_idempotency_key === idempotencyKey && previous.confirm_request_hash === requestHash) {
            return { imported, revision: repository.findCurrentRevision(ownerId, importId)! };
          }
          if (previous.confirm_idempotency_key === idempotencyKey) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key 已用于不同确认请求');
          throw new ApiError(409, 'IMPORT_ALREADY_CONFIRMED', '课程导入已确认，不能重复创建课程');
        }
        if (imported.status !== 'REVIEW_REQUIRED' || imported.version !== input.expectedVersion || imported.currentRevisionId !== input.revisionId) throw new ApiError(409, 'VERSION_CONFLICT', '课表导入状态已变化');
        const revision = repository.findRevision(ownerId, input.revisionId);
        if (!revision) throw new ApiError(422, 'REVISION_INCOMPLETE', '候选版本不存在');
        const included = revision.candidates.filter((candidate) => candidate.included);
        if (!included.length) throw new ApiError(422, 'NO_INCLUDED_CANDIDATES', '至少保留一个课程候选');
        const proposalId = newId();
        const changes: Array<{ operation: 'EXPAND_CALENDAR_RULE'; calendarRuleId: string; expectedRuleVersion: number }> = [];
        for (const candidate of included) {
          const courseId = newId(); const ruleId = newId();
          database.prepare(`insert into courses (id, owner_id, term_id, title, course_code, official_url, version, created_at, updated_at) values (?, ?, ?, ?, null, null, 1, ?, ?)`).run(courseId, ownerId, imported.termId, candidate.title, timestamp, timestamp);
          database.prepare(`insert into calendar_rules (id, owner_id, term_id, course_id, title, weekday, start_local_time, end_local_time, week_start, week_end, week_pattern, is_hard, version) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`).run(ruleId, ownerId, imported.termId, courseId, candidate.title, candidate.weekday, candidate.startLocalTime, candidate.endLocalTime, candidate.weekStart, candidate.weekEnd, candidate.weekPattern);
          database.prepare(`insert into course_import_entities (owner_id, import_id, candidate_id, course_id, calendar_rule_id, created_at) values (?, ?, ?, ?, ?, ?)`).run(ownerId, importId, candidate.candidateId, courseId, ruleId, timestamp);
          database.prepare(`insert into course_learning_contexts (owner_id, course_id, stage, progress_note, created_at, updated_at, version) values (?, ?, 'NOT_STARTED', '', ?, ?, 1)`).run(ownerId, courseId, timestamp, timestamp);
          changes.push({ operation: 'EXPAND_CALENDAR_RULE', calendarRuleId: ruleId, expectedRuleVersion: 1 });
        }
        database.prepare(`insert into proposals (id, owner_id, kind, status, source, title, changes_json, version, created_at, expires_at, decided_at) values (?, ?, 'SCHEDULE', 'PENDING', 'COURSE_IMPORT', ?, ?, 1, ?, null, null)`).run(proposalId, ownerId, '确认课程排程', JSON.stringify(changes), timestamp);
        const updated = repository.updateImport(ownerId, importId, imported.version, { status: 'SCHEDULE_PROPOSAL_PENDING', scheduleProposalId: proposalId, timestamp });
        if (!updated) throw new ApiError(409, 'VERSION_CONFLICT', '课表导入状态已变化');
        database.prepare(`update course_imports_v2 set confirm_idempotency_key = ?, confirm_request_hash = ? where id = ? and owner_id = ?`).run(idempotencyKey, requestHash, importId, ownerId);
        return { imported: updated, revision };
      })();
      return ownedResult(ownerId, outcome.imported, outcome.revision);
    },
  };
}
