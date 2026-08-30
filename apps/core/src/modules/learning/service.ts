import { createHash, randomUUID } from 'node:crypto';
import {
  publicSearchResponseSchema,
  citedLearningAdviceInputSchema,
  citedLearningAdviceOutputSchema,
  type CapabilityDescriptor,
  type CitedLearningAdviceInput,
  type Course,
  type CourseLearningActionSummary,
  type CourseDetail,
  type CourseLearningContext,
  type CourseResource,
  type CourseResourceCitation,
  type CourseResourceSearchRun,
  type CreateCourseInput,
  type CreateCourseResourceInput,
  type CreateCourseResourceSearchInput,
  type CreateLearningRunInput,
  type LearningRun,
  type Proposal,
  type UpdateCourseLearningContextInput,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type { CalendarRepository } from '../calendar/repository';
import { createCapabilityRunRepository, type CapabilityRunRepository } from '../providers/capability-run-repository';
import { terminalEvidenceKind, type CapabilityRegistry, type LearningAdviceCapabilityFactory } from '../providers/capabilities';
import type { ProviderCredentialService } from '../providers/credential-service';
import type { ProposalService } from '../proposals/service';
import { PublicResourceFetchError, type PublicResourceFetcher } from './public-resource-fetcher';
import { createLearningRepository, type CitationDraft } from './repository';

const PUBLIC_SEARCH_CAPABILITY = 'PUBLIC_LEARNING_SEARCH' as const;
const LEARNING_ADVICE_CAPABILITY = 'LEARNING_TEXT_ANALYSIS' as const;

function blockedSearchDisclosure(): CapabilityDescriptor {
  return { capability: PUBLIC_SEARCH_CAPABILITY, providerId: null, providerLabel: '未配置', adapterKind: 'NONE', evidenceKind: 'NONE', availability: 'BLOCKED_PROVIDER' };
}
function blockedLearningDisclosure(): CapabilityDescriptor {
  return { capability: LEARNING_ADVICE_CAPABILITY, providerId: null, providerLabel: '未配置', adapterKind: 'NONE', evidenceKind: 'NONE', availability: 'BLOCKED_PROVIDER' };
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
    proposalService?: ProposalService;
    credentialService?: Pick<ProviderCredentialService, 'getMetadata' | 'withApiKey'>;
    learningAdviceCapabilityFactory?: LearningAdviceCapabilityFactory;
    onExternalOperation?: (inTransaction: boolean, operation?: 'LEARNING_CREDENTIAL_UNPROTECT' | 'LEARNING_ADVICE_GENERATE') => void;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const repository = createLearningRepository(database);
  const capabilityRuns = options.capabilityRuns ?? createCapabilityRunRepository(database);
  const searchDisclosure = (): CapabilityDescriptor => options.capabilityRegistry?.list().find(({ capability }) => capability === PUBLIC_SEARCH_CAPABILITY) ?? blockedSearchDisclosure();
  const learningDisclosure = (ownerId: string): CapabilityDescriptor => {
    const injectedCapability = options.capabilityRegistry?.learningAdvice;
    if (injectedCapability) {
      return options.capabilityRegistry?.list().find(({ capability }) => capability === LEARNING_ADVICE_CAPABILITY) ?? blockedLearningDisclosure();
    }
    const factory = options.learningAdviceCapabilityFactory;
    if (!factory) return blockedLearningDisclosure();
    const configured = options.credentialService?.getMetadata(ownerId).state === 'CONFIGURED';
    return {
      capability: LEARNING_ADVICE_CAPABILITY,
      ...factory.descriptor,
      providerLabel: configured ? factory.descriptor.providerLabel : `${factory.descriptor.providerLabel}（请先在设置配置凭据）`,
      evidenceKind: 'NONE',
      availability: configured ? 'READY' : 'BLOCKED_PROVIDER',
    };
  };
  const timestamp = () => now().toISOString();
  const audit = (ownerId: string, eventType: 'COURSE_CONTEXT_UPDATED' | 'RESOURCE_SEARCH_COMPLETED' | 'LEARNING_PROPOSAL_CREATED', entityId: string, metadata: Record<string, unknown>, createdAt: string) => {
    database.prepare('insert into audit_events (id, owner_id, event_type, entity_type, entity_id, metadata_json, created_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), ownerId, eventType, eventType === 'COURSE_CONTEXT_UPDATED' ? 'COURSE' : eventType === 'LEARNING_PROPOSAL_CREATED' ? 'LEARNING_RUN' : 'COURSE_RESOURCE_SEARCH', entityId, JSON.stringify(metadata), createdAt);
  };
  const finishFailure = (ownerId: string, searchRunId: string, capabilityRunId: string, failureCode: string, at: string, inputChars: number, outputChars: number) => database.transaction(() => {
    const run = repository.failSearchRun(ownerId, searchRunId, failureCode, at);
    capabilityRuns.complete(ownerId, capabilityRunId, { status: 'FAILED', actualCalls: 1, inputChars, outputChars, failureCode, evidenceKind: 'NONE', now: at });
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
        capabilityRuns.complete(ownerId, running.capabilityRunId, { status: 'SUCCEEDED', actualCalls: 1, inputChars: running.query.length, outputChars, failureCode: null, evidenceKind: terminalEvidenceKind(capability.descriptor.adapterKind), now: timestamp() });
        audit(ownerId, 'RESOURCE_SEARCH_COMPLETED', running.id, { status: 'SUCCEEDED', citationCount: result.citations.length, rejectedCount }, timestamp());
        return result;
      })();
      return { ...completed, replayed: false };
    },
    createLearningRun(ownerId: string, courseId: string, input: CreateLearningRunInput): { run: LearningRun; disclosure: CapabilityDescriptor } {
      if (!repository.findCourse(ownerId, courseId)) throw new ApiError(404, 'COURSE_NOT_FOUND', '课程不存在');
      const searchRun = repository.findSearchRun(ownerId, input.searchRunId);
      if (!searchRun || searchRun.courseId !== courseId) throw new ApiError(404, 'RESOURCE_SEARCH_NOT_FOUND', '公开资料检索不存在');
      if (searchRun.status !== 'SUCCEEDED') throw new ApiError(422, 'RESOURCE_SEARCH_NOT_READY', '公开资料检索尚未完成');
      const citations = repository.listCitations(ownerId, searchRun.id);
      const selected = new Set(input.citationIds);
      if (citations.filter((citation) => selected.has(citation.id)).length !== input.citationIds.length) {
        throw new ApiError(422, 'CITATION_SELECTION_INVALID', '所选引用不属于该公开资料检索');
      }
      const disclosure = learningDisclosure(ownerId);
      const status = disclosure.availability === 'READY' ? 'AWAITING_DISCLOSURE' : 'BLOCKED_PROVIDER';
      const at = timestamp();
      const learningRunId = newId();
      const capabilityRunId = newId();
      const run = database.transaction(() => {
        capabilityRuns.create({
          id: capabilityRunId, ownerId, resourceId: learningRunId, capability: LEARNING_ADVICE_CAPABILITY,
          operation: 'LEARNING_ADVICE_GENERATE', descriptor: disclosure, status, createdAt: at,
        });
        return repository.createLearningRun(ownerId, {
          id: learningRunId, courseId, searchRunId: searchRun.id, capabilityRunId, command: input, status, timestamp: at,
        });
      })();
      return { run, disclosure };
    },
    getLearningRun(ownerId: string, learningRunId: string): LearningRun {
      const run = repository.findLearningRun(ownerId, learningRunId);
      if (!run) throw new ApiError(404, 'LEARNING_RUN_NOT_FOUND', '学习建议运行不存在');
      return run;
    },
    listLearningActionsForDate(ownerId: string, localDate: string): CourseLearningActionSummary[] {
      return repository.listLearningActionsForDate(ownerId, localDate);
    },
    listScheduledLearningEventCourseIds(ownerId: string, localDate: string): Map<string, string> {
      return repository.listScheduledLearningEventCourseIds(ownerId, localDate);
    },
    async executeLearningRun(ownerId: string, learningRunId: string, input: { expectedVersion: number; disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' }, idempotencyKey: string): Promise<{ run: LearningRun; proposal: Proposal; replayed: boolean }> {
      const initial = repository.findLearningRun(ownerId, learningRunId);
      if (!initial) throw new ApiError(404, 'LEARNING_RUN_NOT_FOUND', '学习建议运行不存在');
      const capability = options.capabilityRegistry?.learningAdvice;
      const factory = capability ? undefined : options.learningAdviceCapabilityFactory;
      if ((!capability && (!factory || !options.credentialService)) || initial.status === 'BLOCKED_PROVIDER') throw new ApiError(503, 'LEARNING_PROVIDER_NOT_CONFIGURED', '学习建议能力尚未配置');
      if (!options.proposalService || !options.publicResourceFetcher) throw new Error('learning advice dependencies are required when the capability is available');
      const requestHash = createHash('sha256').update(JSON.stringify({ learningRunId, ...input })).digest('hex');
      const claimed = database.transaction(() => {
        const existing = capabilityRuns.findByOwnerAndIdempotencyKey(ownerId, idempotencyKey);
        if (existing) {
          if (existing.resourceId !== learningRunId || existing.requestHash !== requestHash) {
            throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求');
          }
          const replay = repository.findLearningRun(ownerId, learningRunId);
          if (!replay?.proposalId) throw new ApiError(409, 'LEARNING_RUN_NOT_READY', '学习建议尚未生成可确认提案');
          const proposal = options.proposalService?.findById(ownerId, replay.proposalId);
          if (!proposal) throw new ApiError(409, 'LEARNING_RUN_NOT_READY', '学习建议提案不存在');
          return { replay, proposal };
        }
        const current = repository.findLearningRun(ownerId, learningRunId);
        if (!current || current.version !== input.expectedVersion || current.status !== 'AWAITING_DISCLOSURE') {
          throw new ApiError(409, 'LEARNING_RUN_VERSION_CONFLICT', '学习建议运行已被更新，请刷新后重试', { currentRun: current });
        }
        if (input.disclosureVersion !== 'CAPABILITY_DISCLOSURE_V1') throw new ApiError(422, 'DISCLOSURE_VERSION_MISMATCH', '外发披露版本不匹配');
        const at = timestamp();
        if (!capabilityRuns.claim(ownerId, current.capabilityRunId, idempotencyKey, requestHash, at)) {
          throw new ApiError(409, 'LEARNING_RUN_VERSION_CONFLICT', '学习建议运行已被更新，请刷新后重试');
        }
        const claimedRun = repository.claimLearningRun(ownerId, learningRunId, input.expectedVersion, at);
        if (!claimedRun.run) throw new ApiError(409, 'LEARNING_RUN_VERSION_CONFLICT', '学习建议运行已被更新，请刷新后重试', { currentRun: claimedRun.current });
        return { running: claimedRun.run };
      })();
      if ('replay' in claimed) {
        if (!claimed.proposal) throw new ApiError(409, 'LEARNING_RUN_NOT_READY', '学习建议提案不存在');
        return { run: claimed.replay, proposal: claimed.proposal, replayed: true };
      }
      const running = claimed.running;
      const fail = (failureCode: string, actualCalls: number, inputChars: number, outputChars: number) => database.transaction(() => {
        const run = repository.failLearningRun(ownerId, running.id, failureCode, timestamp());
        capabilityRuns.complete(ownerId, running.capabilityRunId, { status: 'FAILED', actualCalls, inputChars, outputChars, failureCode, evidenceKind: 'NONE', now: timestamp() });
        return run;
      })();
      const command = repository.learningRunCommand(ownerId, running.id);
      const detail = repository.getCourseDetail(ownerId, running.courseId);
      if (!command || !detail) throw new ApiError(409, 'LEARNING_RUN_VERSION_CONFLICT', '学习建议上下文已变化');
      const citations = repository.listCitations(ownerId, running.searchRunId)
        .filter((citation) => command.citationIds.includes(citation.id));
      if (citations.length !== command.citationIds.length) {
        fail('CITATION_SELECTION_INVALID', 0, 0, 0);
        throw new ApiError(422, 'CITATION_SELECTION_INVALID', '所选引用已不可用');
      }
      let adviceInput: CitedLearningAdviceInput;
      try {
        const materials = [] as CitedLearningAdviceInput['materials'];
        for (const citation of citations) {
          options.onExternalOperation?.(database.inTransaction);
          const material = await options.publicResourceFetcher.fetch({ url: citation.url, expectedContentHash: citation.contentHash });
          materials.push({
            citationId: citation.id, title: citation.title, publisher: citation.publisher, url: citation.url,
            contentHash: citation.contentHash, untrustedText: material.normalizedText.slice(0, 4_000),
          });
        }
        adviceInput = citedLearningAdviceInputSchema.parse({
          schemaVersion: 'CITED_LEARNING_ADVICE_V1',
          course: { id: detail.course.id, title: detail.course.title, stage: detail.learningContext.stage },
          objective: command.objective,
          materials,
        });
      } catch (error) {
        const changed = error instanceof PublicResourceFetchError && error.code === 'CITATION_CONTENT_CHANGED';
        fail(changed ? 'CITATION_CONTENT_CHANGED' : 'CITATION_REVALIDATION_FAILED', 0, 0, 0);
        throw new ApiError(changed ? 409 : 422, changed ? 'CITATION_CONTENT_CHANGED' : 'CITATION_REVALIDATION_FAILED', changed ? '公开资料内容已变化，无法生成学习建议' : '公开资料无法重新校验');
      }
      let rawAdvice: unknown;
      let actualAdapterKind: 'NONE' | 'TEST_FAKE' | 'PRODUCTION_ADAPTER' = 'NONE';
      let providerCallStarted = false;
      try {
        if (capability) {
          actualAdapterKind = capability.descriptor.adapterKind;
          options.onExternalOperation?.(database.inTransaction, 'LEARNING_ADVICE_GENERATE');
          providerCallStarted = true;
          rawAdvice = await capability.generate(adviceInput);
        } else if (factory && options.credentialService) {
          await options.credentialService.withApiKey(ownerId, async (apiKey) => {
            const adapter = factory.create(apiKey);
            actualAdapterKind = adapter.descriptor.adapterKind;
            options.onExternalOperation?.(database.inTransaction, 'LEARNING_ADVICE_GENERATE');
            providerCallStarted = true;
            rawAdvice = await adapter.generate(adviceInput);
          }, {
            beforeUnprotect: () => options.onExternalOperation?.(database.inTransaction, 'LEARNING_CREDENTIAL_UNPROTECT'),
          });
        }
      } catch {
        const failed = fail('LEARNING_PROVIDER_UNAVAILABLE', providerCallStarted ? 1 : 0, providerOutputCharacterCount(adviceInput), 0);
        throw new ApiError(503, 'LEARNING_PROVIDER_UNAVAILABLE', '学习建议暂时不可用', { currentRun: failed });
      }
      const outputChars = providerOutputCharacterCount(rawAdvice);
      const advice = citedLearningAdviceOutputSchema.safeParse(rawAdvice);
      if (!advice.success || advice.data.citationIds.some((citationId) => !command.citationIds.includes(citationId))) {
        const failed = fail('LEARNING_ADVICE_INVALID', providerCallStarted ? 1 : 0, providerOutputCharacterCount(adviceInput), outputChars);
        throw new ApiError(422, 'LEARNING_ADVICE_INVALID', '学习建议返回格式或引用无效', { currentRun: failed });
      }
      const completed = database.transaction(() => {
        const at = timestamp();
        const proposal = options.proposalService?.create(ownerId, {
          kind: 'LEARNING', source: 'LEARNING_AGENT', title: advice.data.title,
          changes: [{
            operation: 'CREATE_LEARNING_ACTION',
            action: { id: newId(), courseId: running.courseId, title: advice.data.title, targetDate: command.targetDate, status: 'OPEN', kind: 'STUDY', version: 1, createdAt: at, updatedAt: at },
            scheduling: { timeRequestId: newId(), durationMinutes: advice.data.durationMinutes, priority: advice.data.priority, earliestStartLocalTime: command.earliestStartLocalTime, latestEndLocalTime: command.latestEndLocalTime, isFixed: false },
            citationIds: advice.data.citationIds,
          }],
        });
        if (!proposal) throw new Error('proposal service is unavailable');
        const run = repository.finishLearningRun(ownerId, running.id, proposal.id, at);
        capabilityRuns.complete(ownerId, running.capabilityRunId, { status: 'SUCCEEDED', actualCalls: providerCallStarted ? 1 : 0, inputChars: providerOutputCharacterCount(adviceInput), outputChars, failureCode: null, evidenceKind: terminalEvidenceKind(actualAdapterKind), now: at });
        audit(ownerId, 'LEARNING_PROPOSAL_CREATED', running.id, { proposalId: proposal.id, citationIds: advice.data.citationIds }, at);
        return { run, proposal };
      })();
      return { ...completed, replayed: false };
    },
  };
}
