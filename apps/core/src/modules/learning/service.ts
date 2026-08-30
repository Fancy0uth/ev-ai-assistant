import { createHash, randomUUID } from 'node:crypto';
import {
  publicSearchResponseSchema,
  type CapabilityDescriptor,
  type Course,
  type CourseDetail,
  type CourseLearningContext,
  type CourseResource,
  type CourseResourceCitation,
  type CourseResourceSearchRun,
  type CreateCourseInput,
  type CreateCourseResourceInput,
  type CreateCourseResourceSearchInput,
  type UpdateCourseLearningContextInput,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type { CalendarRepository } from '../calendar/repository';
import { createCapabilityRunRepository, type CapabilityRunRepository } from '../providers/capability-run-repository';
import type { CapabilityRegistry } from '../providers/capabilities';
import { PublicResourceFetchError, type PublicResourceFetcher } from './public-resource-fetcher';
import { createLearningRepository, type CitationDraft } from './repository';

const PUBLIC_SEARCH_CAPABILITY = 'PUBLIC_LEARNING_SEARCH' as const;

function blockedSearchDisclosure(): CapabilityDescriptor {
  return { capability: PUBLIC_SEARCH_CAPABILITY, providerId: null, providerLabel: '未配置', adapterKind: 'NONE', evidenceKind: 'NONE', availability: 'BLOCKED_PROVIDER' };
}

function providerOutputCharacterCount(output: unknown): number {
  try {
    const serialized = JSON.stringify(output);
    return typeof serialized === 'string' ? serialized.length : 0;
  } catch {
    return 0;
  }
}

export function createLearningService(
  database: Database.Database,
  calendar: CalendarRepository,
  options: {
    now?: () => Date;
    newId?: () => string;
    capabilityRegistry?: CapabilityRegistry;
    publicResourceFetcher?: PublicResourceFetcher;
    capabilityRuns?: CapabilityRunRepository;
    onExternalOperation?: (inTransaction: boolean) => void;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const repository = createLearningRepository(database);
  const capabilityRuns = options.capabilityRuns ?? createCapabilityRunRepository(database);
  const searchDisclosure = (): CapabilityDescriptor => options.capabilityRegistry?.list().find(({ capability }) => capability === PUBLIC_SEARCH_CAPABILITY) ?? blockedSearchDisclosure();
  const timestamp = () => now().toISOString();
  const audit = (ownerId: string, eventType: 'COURSE_CONTEXT_UPDATED' | 'RESOURCE_SEARCH_COMPLETED', entityId: string, metadata: Record<string, unknown>, createdAt: string) => {
    database.prepare('insert into audit_events (id, owner_id, event_type, entity_type, entity_id, metadata_json, created_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), ownerId, eventType, eventType === 'COURSE_CONTEXT_UPDATED' ? 'COURSE' : 'COURSE_RESOURCE_SEARCH', entityId, JSON.stringify(metadata), createdAt);
  };
  const finishFailure = (ownerId: string, searchRunId: string, capabilityRunId: string, failureCode: string, at: string, inputChars: number, outputChars: number) => database.transaction(() => {
    const run = repository.failSearchRun(ownerId, searchRunId, failureCode, at);
    capabilityRuns.complete(ownerId, capabilityRunId, { status: 'FAILED', actualCalls: 1, inputChars, outputChars, failureCode, now: at });
    audit(ownerId, 'RESOURCE_SEARCH_COMPLETED', searchRunId, { status: 'FAILED', failureCode }, at);
    return run;
  })();

  return {
    createCourse(ownerId: string, input: CreateCourseInput): Course {
      if (!calendar.findTerm(ownerId, input.termId)) throw new ApiError(404, 'TERM_NOT_FOUND', '学期不存在');
      return repository.createCourse(ownerId, input, newId(), timestamp());
    },
    listCourses(ownerId: string): Course[] { return repository.listCourses(ownerId); },
    addResource(ownerId: string, courseId: string, input: CreateCourseResourceInput): CourseResource {
      if (!repository.findCourse(ownerId, courseId)) throw new ApiError(404, 'COURSE_NOT_FOUND', '课程不存在');
      return repository.addResource(ownerId, courseId, input, newId(), timestamp());
    },
    listResources(ownerId: string, courseId: string): CourseResource[] {
      if (!repository.findCourse(ownerId, courseId)) throw new ApiError(404, 'COURSE_NOT_FOUND', '课程不存在');
      return repository.listResources(ownerId, courseId);
    },
    getCourseDetail(ownerId: string, courseId: string): CourseDetail {
      const detail = repository.getCourseDetail(ownerId, courseId);
      if (!detail) throw new ApiError(404, 'COURSE_NOT_FOUND', '课程不存在');
      return detail;
    },
    updateLearningContext(ownerId: string, courseId: string, input: UpdateCourseLearningContextInput): CourseLearningContext {
      const at = timestamp();
      const result = database.transaction(() => {
        const next = repository.updateLearningContext(ownerId, courseId, input, at);
        if (next.context) audit(ownerId, 'COURSE_CONTEXT_UPDATED', courseId, { stage: next.context.stage, version: next.context.version }, at);
        return next;
      })();
      if (!result.context && !result.current) throw new ApiError(404, 'COURSE_NOT_FOUND', '课程不存在');
      if (!result.context) throw new ApiError(409, 'VERSION_CONFLICT', '课程学习进度已被更新，请刷新后重试', { currentContext: result.current });
      return result.context;
    },
    createResourceSearch(ownerId: string, courseId: string, input: CreateCourseResourceSearchInput): { run: CourseResourceSearchRun; disclosure: CapabilityDescriptor } {
      if (!repository.findCourse(ownerId, courseId)) throw new ApiError(404, 'COURSE_NOT_FOUND', '课程不存在');
      const at = timestamp();
      const disclosure = searchDisclosure();
      const searchRunId = newId();
      const capabilityRunId = newId();
      const status = disclosure.availability === 'READY' ? 'AWAITING_DISCLOSURE' : 'BLOCKED_PROVIDER';
      const run = database.transaction(() => {
        capabilityRuns.create({ id: capabilityRunId, ownerId, resourceId: searchRunId, capability: PUBLIC_SEARCH_CAPABILITY, operation: 'COURSE_RESOURCE_SEARCH', descriptor: disclosure, status, createdAt: at });
        return repository.createSearchRun(ownerId, { id: searchRunId, courseId, capabilityRunId, query: input.query, status, timestamp: at });
      })();
      return { run, disclosure };
    },
    getResourceSearch(ownerId: string, searchRunId: string): { run: CourseResourceSearchRun; citations: CourseResourceCitation[] } {
      const run = repository.findSearchRun(ownerId, searchRunId);
      if (!run) throw new ApiError(404, 'RESOURCE_SEARCH_NOT_FOUND', '公开资料检索不存在');
      return { run, citations: repository.listCitations(ownerId, searchRunId) };
    },
    async executeResourceSearch(ownerId: string, searchRunId: string, input: { expectedVersion: number; disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' }, idempotencyKey: string): Promise<{ run: CourseResourceSearchRun; citations: CourseResourceCitation[]; replayed: boolean }> {
      const initial = repository.findSearchRun(ownerId, searchRunId);
      if (!initial) throw new ApiError(404, 'RESOURCE_SEARCH_NOT_FOUND', '公开资料检索不存在');
      const capability = options.capabilityRegistry?.publicSearch;
      if (!capability || initial.status === 'BLOCKED_PROVIDER') throw new ApiError(503, 'SEARCH_PROVIDER_NOT_CONFIGURED', '匿名公开检索能力尚未配置');
      const requestHash = createHash('sha256').update(JSON.stringify({ searchRunId, ...input })).digest('hex');
      const claimed = database.transaction(() => {
        const existing = capabilityRuns.findByOwnerAndIdempotencyKey(ownerId, idempotencyKey);
        if (existing) {
          if (existing.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求');
          const replayRun = repository.findSearchRunByCapabilityRun(ownerId, existing.id);
          if (!replayRun) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', '幂等键未关联当前检索');
          return { replay: replayRun };
        }
        const current = repository.findSearchRun(ownerId, searchRunId);
        if (!current || current.version !== input.expectedVersion || current.status !== 'AWAITING_DISCLOSURE') throw new ApiError(409, 'VERSION_CONFLICT', '公开资料检索已被更新，请刷新后重试', { currentRun: current });
        if (input.disclosureVersion !== 'CAPABILITY_DISCLOSURE_V1') throw new ApiError(422, 'DISCLOSURE_VERSION_MISMATCH', '外发披露版本不匹配');
        const at = timestamp();
        if (!capabilityRuns.claim(ownerId, current.capabilityRunId, idempotencyKey, requestHash, at)) throw new ApiError(409, 'VERSION_CONFLICT', '公开资料检索已被更新，请刷新后重试');
        const search = repository.claimSearchRun(ownerId, searchRunId, input.expectedVersion, at);
        if (!search.run) throw new ApiError(409, 'VERSION_CONFLICT', '公开资料检索已被更新，请刷新后重试', { currentRun: search.current });
        return { claimed: search.run };
      })();
      if ('replay' in claimed) return { run: claimed.replay, citations: repository.listCitations(ownerId, claimed.replay.id), replayed: true };
      const running = claimed.claimed;
      let rawSearch: unknown;
      try {
        options.onExternalOperation?.(database.inTransaction);
        rawSearch = await capability.search({ query: running.query, maxResults: 5 });
      } catch {
        const failed = finishFailure(ownerId, running.id, running.capabilityRunId, 'SEARCH_PROVIDER_UNAVAILABLE', timestamp(), running.query.length, 0);
        throw new ApiError(503, 'SEARCH_PROVIDER_UNAVAILABLE', '匿名公开检索暂时不可用', { currentRun: failed });
      }
      const parsed = publicSearchResponseSchema.safeParse(rawSearch);
      const outputChars = providerOutputCharacterCount(rawSearch);
      if (!parsed.success) {
        const failed = finishFailure(ownerId, running.id, running.capabilityRunId, 'SEARCH_RESPONSE_INVALID', timestamp(), running.query.length, outputChars);
        throw new ApiError(422, 'SEARCH_RESPONSE_INVALID', '匿名公开检索返回格式无效', { currentRun: failed });
      }
      if (!options.publicResourceFetcher) throw new Error('public resource fetcher is required when search is available');
      const citations: CitationDraft[] = [];
      let rejectedCount = 0;
      for (const result of parsed.data.results) {
        try {
          options.onExternalOperation?.(database.inTransaction);
          const resource = await options.publicResourceFetcher.fetch({ url: result.url });
          citations.push({ id: newId(), courseResourceId: newId(), title: result.title, url: resource.canonicalUrl, publisher: resource.publisher, retrievedAt: resource.retrievedAt, contentHash: resource.contentHash, mediaType: resource.mediaType, createdAt: timestamp() });
        } catch (error) {
          rejectedCount += 1;
          if (!(error instanceof PublicResourceFetchError)) rejectedCount += 0;
        }
      }
      if (citations.length === 0) {
        const failed = finishFailure(ownerId, running.id, running.capabilityRunId, 'NO_SAFE_PUBLIC_RESULTS', timestamp(), running.query.length, outputChars);
        throw new ApiError(422, 'NO_SAFE_PUBLIC_RESULTS', '没有可安全保存的公开资料', { currentRun: failed });
      }
      const completed = database.transaction(() => {
        const current = repository.findSearchRun(ownerId, running.id);
        if (!current || current.status !== 'SEARCHING') throw new ApiError(409, 'VERSION_CONFLICT', '公开资料检索已被更新，请刷新后重试', { currentRun: current });
        const result = repository.finishSearchRun(ownerId, running.id, { citations, rejectedCount, timestamp: timestamp() });
        capabilityRuns.complete(ownerId, running.capabilityRunId, { status: 'SUCCEEDED', actualCalls: 1, inputChars: running.query.length, outputChars, failureCode: null, now: timestamp() });
        audit(ownerId, 'RESOURCE_SEARCH_COMPLETED', running.id, { status: 'SUCCEEDED', citationCount: result.citations.length, rejectedCount }, timestamp());
        return result;
      })();
      return { ...completed, replayed: false };
    },
  };
}
