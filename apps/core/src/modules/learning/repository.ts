import {
  courseDetailSchema,
  courseLearningActionSummarySchema,
  type CalendarRule,
  type CourseLearningActionSummary,
  type Course,
  type CourseDetail,
  type CourseLearningContext,
  type CourseResource,
  type CourseResourceCitation,
  type CourseResourceSearchRun,
  type CreateCourseInput,
  type CreateCourseResourceInput,
  type CreateLearningRunInput,
  type LearningRun,
  type UpdateCourseLearningContextInput,
} from '@ev/contracts';
import type Database from 'better-sqlite3';

interface CourseRow {
  id: string; term_id: string; title: string; course_code: string | null; official_url: string | null;
  version: number; created_at: string; updated_at: string;
}
interface ResourceRow { id: string; course_id: string; title: string; url: string; source: CourseResource['source']; created_at: string; }
interface ContextRow { course_id: string; stage: CourseLearningContext['stage']; progress_note: string; version: number; created_at: string; updated_at: string; }
interface RuleRow {
  id: string; term_id: string; course_id: string | null; title: string; weekday: number; start_local_time: string; end_local_time: string;
  week_start: number; week_end: number; week_pattern: CalendarRule['weekPattern']; is_hard: number; version: number;
}
interface CitationRow {
  id: string; course_id: string; course_resource_id: string; search_run_id: string; title: string; url: string; publisher: string;
  retrieved_at: string; content_hash: string; media_type: CourseResourceCitation['mediaType']; created_at: string;
}
interface SearchRunRow {
  id: string; course_id: string; capability_run_id: string; query: string; status: CourseResourceSearchRun['status'];
  citation_count: number; rejected_count: number; failure_code: string | null; version: number; created_at: string; updated_at: string;
}
interface LearningRunRow {
  id: string; course_id: string; search_run_id: string; capability_run_id: string; citation_ids_json: string;
  status: LearningRun['status']; proposal_id: string | null; failure_code: string | null; version: number; created_at: string; updated_at: string;
}
interface LearningActionRow {
  id: string; event_id: string | null; title: string; kind: 'STUDY'; status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'DEFERRED' | 'CANCELLED'; target_date: string | null;
  version: number; created_at: string; updated_at: string; course_id: string; course_title: string; citation_count: number;
}

export interface LearningRunCommand {
  citationIds: string[];
  objective: string;
  targetDate: string;
  earliestStartLocalTime: string | null;
  latestEndLocalTime: string | null;
}

export interface CitationDraft {
  id: string;
  courseResourceId: string;
  title: string;
  url: string;
  publisher: string;
  retrievedAt: string;
  contentHash: string;
  mediaType: CourseResourceCitation['mediaType'];
  createdAt: string;
}

const courseColumns = 'id, term_id, title, course_code, official_url, version, created_at, updated_at';
const resourceColumns = 'id, course_id, title, url, source, created_at';
const contextColumns = 'course_id, stage, progress_note, version, created_at, updated_at';
const ruleColumns = 'id, term_id, course_id, title, weekday, start_local_time, end_local_time, week_start, week_end, week_pattern, is_hard, version';
const citationColumns = 'id, course_id, course_resource_id, search_run_id, title, url, publisher, retrieved_at, content_hash, media_type, created_at';
const searchRunColumns = 'id, course_id, capability_run_id, query, status, citation_count, rejected_count, failure_code, version, created_at, updated_at';
const learningRunColumns = 'id, course_id, search_run_id, capability_run_id, citation_ids_json, status, proposal_id, failure_code, version, created_at, updated_at';

function toCourse(row: CourseRow): Course {
  return { id: row.id, termId: row.term_id, title: row.title, courseCode: row.course_code, officialUrl: row.official_url, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
function toResource(row: ResourceRow): CourseResource {
  return { id: row.id, courseId: row.course_id, title: row.title, url: row.url, source: row.source, createdAt: row.created_at };
}
function toContext(row: ContextRow): CourseLearningContext {
  return { courseId: row.course_id, stage: row.stage, progressNote: row.progress_note, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
function toRule(row: RuleRow): CalendarRule {
  return { id: row.id, termId: row.term_id, courseId: row.course_id, title: row.title, weekday: row.weekday, startLocalTime: row.start_local_time, endLocalTime: row.end_local_time, weekStart: row.week_start, weekEnd: row.week_end, weekPattern: row.week_pattern, isHard: row.is_hard === 1, version: row.version };
}
function toCitation(row: CitationRow): CourseResourceCitation {
  return { id: row.id, courseId: row.course_id, courseResourceId: row.course_resource_id, searchRunId: row.search_run_id, title: row.title, url: row.url, publisher: row.publisher, retrievedAt: row.retrieved_at, contentHash: row.content_hash, mediaType: row.media_type, createdAt: row.created_at };
}
function toSearchRun(row: SearchRunRow): CourseResourceSearchRun {
  return { id: row.id, courseId: row.course_id, capabilityRunId: row.capability_run_id, query: row.query, status: row.status, citationCount: row.citation_count, rejectedCount: row.rejected_count, failureCode: row.failure_code, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
function parseLearningRunCommand(value: string): LearningRunCommand {
  const parsed = JSON.parse(value) as LearningRunCommand;
  if (!parsed || !Array.isArray(parsed.citationIds) || typeof parsed.objective !== 'string' || typeof parsed.targetDate !== 'string') {
    throw new Error('learning run command is invalid');
  }
  return parsed;
}
function toLearningRun(row: LearningRunRow): LearningRun {
  const command = parseLearningRunCommand(row.citation_ids_json);
  return {
    id: row.id, courseId: row.course_id, searchRunId: row.search_run_id, capabilityRunId: row.capability_run_id,
    citationIds: command.citationIds, status: row.status, proposalId: row.proposal_id, failureCode: row.failure_code,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createLearningRepository(database: Database.Database) {
  const findCourse = database.prepare(`select ${courseColumns} from courses where id = ? and owner_id = ?`);
  const findContext = database.prepare(`select ${contextColumns} from course_learning_contexts where course_id = ? and owner_id = ?`);
  const findSearch = database.prepare(`select ${searchRunColumns} from course_resource_search_runs where id = ? and owner_id = ?`);
  const findLearningRun = database.prepare(`select ${learningRunColumns} from learning_runs where id = ? and owner_id = ?`);
  const listCitations = database.prepare(`select ${citationColumns} from course_resource_citations where search_run_id = ? and owner_id = ? order by created_at asc, id asc`);
  const readSearchRun = (ownerId: string, searchRunId: string): CourseResourceSearchRun | undefined => {
    const row = findSearch.get(searchRunId, ownerId) as SearchRunRow | undefined;
    return row ? toSearchRun(row) : undefined;
  };
  const readLearningRun = (ownerId: string, learningRunId: string): LearningRun | undefined => {
    const row = findLearningRun.get(learningRunId, ownerId) as LearningRunRow | undefined;
    return row ? toLearningRun(row) : undefined;
  };

  return {
    createCourse(ownerId: string, input: CreateCourseInput, id: string, timestamp: string): Course {
      database.prepare(`insert into courses (id, owner_id, term_id, title, course_code, official_url, version, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(id, ownerId, input.termId, input.title, input.courseCode ?? null, input.officialUrl ?? null, timestamp, timestamp);
      return toCourse(findCourse.get(id, ownerId) as CourseRow);
    },
    findCourse(ownerId: string, courseId: string): Course | undefined {
      const row = findCourse.get(courseId, ownerId) as CourseRow | undefined;
      return row ? toCourse(row) : undefined;
    },
    listCourses(ownerId: string): Course[] {
      return (database.prepare(`select ${courseColumns} from courses where owner_id = ? order by created_at asc, id asc`).all(ownerId) as CourseRow[]).map(toCourse);
    },
    addResource(ownerId: string, courseId: string, input: CreateCourseResourceInput, id: string, timestamp: string): CourseResource {
      database.prepare('insert into course_resources (id, owner_id, course_id, title, url, source, created_at) values (?, ?, ?, ?, ?, ?, ?)')
        .run(id, ownerId, courseId, input.title, input.url, 'USER_PROVIDED', timestamp);
      return toResource(database.prepare(`select ${resourceColumns} from course_resources where id = ? and owner_id = ?`).get(id, ownerId) as ResourceRow);
    },
    listResources(ownerId: string, courseId: string): CourseResource[] {
      return (database.prepare(`select ${resourceColumns} from course_resources where owner_id = ? and course_id = ? order by created_at asc, id asc`).all(ownerId, courseId) as ResourceRow[]).map(toResource);
    },
    getCourseDetail(ownerId: string, courseId: string): CourseDetail | undefined {
      const courseRow = findCourse.get(courseId, ownerId) as CourseRow | undefined;
      if (!courseRow) return undefined;
      const course = toCourse(courseRow);
      const contextRow = findContext.get(courseId, ownerId) as ContextRow | undefined;
      const learningContext = contextRow
        ? toContext(contextRow)
        : { courseId, stage: 'NOT_STARTED' as const, progressNote: '', version: 1, createdAt: course.createdAt, updatedAt: course.updatedAt };
      const rules = (database.prepare(`select ${ruleColumns} from calendar_rules where owner_id = ? and course_id = ? order by weekday asc, start_local_time asc, id asc`).all(ownerId, courseId) as RuleRow[]).map(toRule);
      const user = (database.prepare(`select ${resourceColumns} from course_resources where owner_id = ? and course_id = ? and source = 'USER_PROVIDED' order by created_at asc, id asc`).all(ownerId, courseId) as ResourceRow[]).map(toResource);
      const citations = (database.prepare(`select ${citationColumns} from course_resource_citations where owner_id = ? and course_id = ? order by created_at asc, id asc`).all(ownerId, courseId) as CitationRow[]).map(toCitation);
      const count = (status: 'open' | 'completed') => (database.prepare(`select count(*) as count from learning_actions la join actions a on a.id = la.action_id and a.owner_id = la.owner_id where la.owner_id = ? and la.course_id = ? and a.status ${status === 'open' ? "in ('OPEN', 'IN_PROGRESS', 'DEFERRED')" : "in ('DONE', 'CANCELLED')"}`).get(ownerId, courseId) as { count: number }).count;
      return courseDetailSchema.parse({
        course, rules,
        sources: { official: course.officialUrl ? [{ title: '课程官网', url: course.officialUrl }] : [], user, public: citations },
        learningContext,
        actionCounts: { open: count('open'), completed: count('completed') },
      });
    },
    updateLearningContext(ownerId: string, courseId: string, input: UpdateCourseLearningContextInput, timestamp: string): { context?: CourseLearningContext; current?: CourseLearningContext } {
      const course = findCourse.get(courseId, ownerId) as CourseRow | undefined;
      if (!course) return {};
      const existing = findContext.get(courseId, ownerId) as ContextRow | undefined;
      if (!existing) {
        const initial: CourseLearningContext = { courseId, stage: 'NOT_STARTED', progressNote: '', version: 1, createdAt: course.created_at, updatedAt: course.updated_at };
        if (input.expectedVersion !== initial.version) return { current: initial };
        database.prepare('insert into course_learning_contexts (owner_id, course_id, stage, progress_note, created_at, updated_at, version) values (?, ?, ?, ?, ?, ?, 2)')
          .run(ownerId, courseId, input.stage, input.progressNote, timestamp, timestamp);
        return { context: toContext(findContext.get(courseId, ownerId) as ContextRow) };
      }
      const current = toContext(existing);
      if (current.version !== input.expectedVersion) return { current };
      database.prepare('update course_learning_contexts set stage = ?, progress_note = ?, updated_at = ?, version = version + 1 where owner_id = ? and course_id = ? and version = ?')
        .run(input.stage, input.progressNote, timestamp, ownerId, courseId, input.expectedVersion);
      return { context: toContext(findContext.get(courseId, ownerId) as ContextRow) };
    },
    createSearchRun(ownerId: string, input: { id: string; courseId: string; capabilityRunId: string; query: string; status: CourseResourceSearchRun['status']; timestamp: string }): CourseResourceSearchRun {
      database.prepare(`insert into course_resource_search_runs (id, owner_id, course_id, capability_run_id, query, status, citation_count, rejected_count, failure_code, created_at, updated_at, version) values (?, ?, ?, ?, ?, ?, 0, 0, null, ?, ?, 1)`)
        .run(input.id, ownerId, input.courseId, input.capabilityRunId, input.query, input.status, input.timestamp, input.timestamp);
      return toSearchRun(findSearch.get(input.id, ownerId) as SearchRunRow);
    },
    findSearchRun(ownerId: string, searchRunId: string): CourseResourceSearchRun | undefined {
      return readSearchRun(ownerId, searchRunId);
    },
    listCitations(ownerId: string, searchRunId: string): CourseResourceCitation[] {
      return (listCitations.all(searchRunId, ownerId) as CitationRow[]).map(toCitation);
    },
    findSearchRunByCapabilityRun(ownerId: string, capabilityRunId: string): CourseResourceSearchRun | undefined {
      const row = database.prepare(`select ${searchRunColumns} from course_resource_search_runs where owner_id = ? and capability_run_id = ?`).get(ownerId, capabilityRunId) as SearchRunRow | undefined;
      return row ? toSearchRun(row) : undefined;
    },
    createLearningRun(ownerId: string, input: {
      id: string; courseId: string; searchRunId: string; capabilityRunId: string; command: CreateLearningRunInput;
      status: LearningRun['status']; timestamp: string;
    }): LearningRun {
      database.prepare(`insert into learning_runs (
        id, owner_id, course_id, search_run_id, capability_run_id, citation_ids_json, status, proposal_id,
        failure_code, created_at, updated_at, version
      ) values (?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, 1)`)
        .run(input.id, ownerId, input.courseId, input.searchRunId, input.capabilityRunId, JSON.stringify({
          citationIds: input.command.citationIds,
          objective: input.command.objective,
          targetDate: input.command.targetDate,
          earliestStartLocalTime: input.command.earliestStartLocalTime,
          latestEndLocalTime: input.command.latestEndLocalTime,
        }), input.status, input.timestamp, input.timestamp);
      return toLearningRun(findLearningRun.get(input.id, ownerId) as LearningRunRow);
    },
    findLearningRun(ownerId: string, learningRunId: string): LearningRun | undefined {
      return readLearningRun(ownerId, learningRunId);
    },
    learningRunCommand(ownerId: string, learningRunId: string): LearningRunCommand | undefined {
      const row = findLearningRun.get(learningRunId, ownerId) as LearningRunRow | undefined;
      return row ? parseLearningRunCommand(row.citation_ids_json) : undefined;
    },
    claimLearningRun(ownerId: string, learningRunId: string, expectedVersion: number, timestamp: string): { run?: LearningRun; current?: LearningRun } {
      const current = readLearningRun(ownerId, learningRunId);
      if (!current) return {};
      if (current.version !== expectedVersion || current.status !== 'AWAITING_DISCLOSURE') return { current };
      database.prepare(`update learning_runs set status = 'GENERATING', updated_at = ?, version = version + 1
        where id = ? and owner_id = ? and version = ? and status = 'AWAITING_DISCLOSURE'`)
        .run(timestamp, learningRunId, ownerId, expectedVersion);
      const run = readLearningRun(ownerId, learningRunId);
      return run ? { run } : {};
    },
    finishLearningRun(ownerId: string, learningRunId: string, proposalId: string, timestamp: string): LearningRun {
      database.prepare(`update learning_runs set status = 'PROPOSAL_PENDING', proposal_id = ?, failure_code = null,
        updated_at = ?, version = version + 1 where id = ? and owner_id = ? and status = 'GENERATING'`)
        .run(proposalId, timestamp, learningRunId, ownerId);
      return toLearningRun(findLearningRun.get(learningRunId, ownerId) as LearningRunRow);
    },
    failLearningRun(ownerId: string, learningRunId: string, failureCode: string, timestamp: string): LearningRun {
      database.prepare(`update learning_runs set status = 'FAILED', failure_code = ?, updated_at = ?, version = version + 1
        where id = ? and owner_id = ? and status = 'GENERATING'`)
        .run(failureCode, timestamp, learningRunId, ownerId);
      return toLearningRun(findLearningRun.get(learningRunId, ownerId) as LearningRunRow);
    },
    listLearningActionsForDate(ownerId: string, localDate: string): CourseLearningActionSummary[] {
      const rows = database.prepare(`select action.id, action.event_id, action.title, action.kind, action.status,
        action.target_date, action.version, action.created_at, action.updated_at, learning_action.course_id,
        course.title as course_title, count(citation.citation_id) as citation_count
        from learning_actions as learning_action
        join actions as action on action.id = learning_action.action_id and action.owner_id = learning_action.owner_id
        join courses as course on course.id = learning_action.course_id and course.owner_id = learning_action.owner_id
        left join learning_action_citations as citation on citation.action_id = action.id and citation.owner_id = action.owner_id
        where learning_action.owner_id = ? and action.target_date = ?
        group by action.id, action.event_id, action.title, action.kind, action.status, action.target_date, action.version,
          action.created_at, action.updated_at, learning_action.course_id, course.title
        order by action.created_at asc, action.id asc`).all(ownerId, localDate) as LearningActionRow[];
      return rows.map((row) => courseLearningActionSummarySchema.parse({
        action: {
          id: row.id, eventId: row.event_id, title: row.title, kind: row.kind, status: row.status,
          targetDate: row.target_date, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
        },
        courseId: row.course_id, courseTitle: row.course_title, citationCount: row.citation_count,
      }));
    },
    listScheduledLearningEventCourseIds(ownerId: string, localDate: string): Map<string, string> {
      const rows = database.prepare(`select event.id as event_id, learning_action.course_id
        from events as event
        join proposal_decisions as decision on decision.scheduled_event_id = event.id and decision.owner_id = event.owner_id
        join time_requests as request on request.id = decision.time_request_id and request.owner_id = decision.owner_id
        join learning_actions as learning_action on learning_action.action_id = request.origin_id and learning_action.owner_id = request.owner_id
        where event.owner_id = ? and event.local_date = ? and event.status = 'CONFIRMED'
          and request.origin_kind = 'ACTION'`).all(ownerId, localDate) as Array<{ event_id: string; course_id: string }>;
      return new Map(rows.map((row) => [row.event_id, row.course_id]));
    },
    claimSearchRun(ownerId: string, searchRunId: string, expectedVersion: number, timestamp: string): { run?: CourseResourceSearchRun; current?: CourseResourceSearchRun } {
      const current = readSearchRun(ownerId, searchRunId);
      if (!current) return {};
      if (current.version !== expectedVersion || current.status !== 'AWAITING_DISCLOSURE') return { current };
      database.prepare(`update course_resource_search_runs set status = 'SEARCHING', updated_at = ?, version = version + 1 where id = ? and owner_id = ? and version = ? and status = 'AWAITING_DISCLOSURE'`)
        .run(timestamp, searchRunId, ownerId, expectedVersion);
      const run = readSearchRun(ownerId, searchRunId);
      return run ? { run } : {};
    },
    finishSearchRun(ownerId: string, searchRunId: string, input: { citations: CitationDraft[]; rejectedCount: number; timestamp: string }): { run: CourseResourceSearchRun; citations: CourseResourceCitation[] } {
      for (const citation of input.citations) {
        database.prepare(`insert into course_resources (id, owner_id, course_id, title, url, source, created_at) values (?, ?, (select course_id from course_resource_search_runs where id = ? and owner_id = ?), ?, ?, 'PUBLIC_SEARCH', ?)`)
          .run(citation.courseResourceId, ownerId, searchRunId, ownerId, citation.title, citation.url, citation.createdAt);
        database.prepare(`insert into course_resource_citations (id, owner_id, course_id, course_resource_id, search_run_id, title, url, publisher, retrieved_at, content_hash, media_type, created_at) values (?, ?, (select course_id from course_resource_search_runs where id = ? and owner_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(citation.id, ownerId, searchRunId, ownerId, citation.courseResourceId, searchRunId, citation.title, citation.url, citation.publisher, citation.retrievedAt, citation.contentHash, citation.mediaType, citation.createdAt);
      }
      database.prepare(`update course_resource_search_runs set status = 'SUCCEEDED', citation_count = ?, rejected_count = ?, failure_code = null, updated_at = ?, version = version + 1 where id = ? and owner_id = ? and status = 'SEARCHING'`)
        .run(input.citations.length, input.rejectedCount, input.timestamp, searchRunId, ownerId);
      return { run: toSearchRun(findSearch.get(searchRunId, ownerId) as SearchRunRow), citations: (listCitations.all(searchRunId, ownerId) as CitationRow[]).map(toCitation) };
    },
    failSearchRun(ownerId: string, searchRunId: string, failureCode: string, timestamp: string): CourseResourceSearchRun {
      database.prepare(`update course_resource_search_runs set status = 'FAILED', failure_code = ?, updated_at = ?, version = version + 1 where id = ? and owner_id = ? and status = 'SEARCHING'`)
        .run(failureCode, timestamp, searchRunId, ownerId);
      return toSearchRun(findSearch.get(searchRunId, ownerId) as SearchRunRow);
    },
  };
}
