import {
  courseDetailSchema,
  type CalendarRule,
  type Course,
  type CourseDetail,
  type CourseLearningContext,
  type CourseResource,
  type CourseResourceCitation,
  type CourseResourceSearchRun,
  type CreateCourseInput,
  type CreateCourseResourceInput,
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

export function createLearningRepository(database: Database.Database) {
  const findCourse = database.prepare(`select ${courseColumns} from courses where id = ? and owner_id = ?`);
  const findContext = database.prepare(`select ${contextColumns} from course_learning_contexts where course_id = ? and owner_id = ?`);
  const findSearch = database.prepare(`select ${searchRunColumns} from course_resource_search_runs where id = ? and owner_id = ?`);
  const listCitations = database.prepare(`select ${citationColumns} from course_resource_citations where search_run_id = ? and owner_id = ? order by created_at asc, id asc`);
  const readSearchRun = (ownerId: string, searchRunId: string): CourseResourceSearchRun | undefined => {
    const row = findSearch.get(searchRunId, ownerId) as SearchRunRow | undefined;
    return row ? toSearchRun(row) : undefined;
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
