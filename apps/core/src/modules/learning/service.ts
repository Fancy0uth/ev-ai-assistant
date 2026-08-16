import { randomUUID } from 'node:crypto';
import type { Course, CourseResource, CreateCourseInput, CreateCourseResourceInput } from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type { CalendarRepository } from '../calendar/repository';

interface CourseRow {
  id: string;
  term_id: string;
  title: string;
  course_code: string | null;
  official_url: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export function createLearningService(database: Database.Database, calendar: CalendarRepository, options: { now?: () => Date; newId?: () => string } = {}) {
  const now = options.now ?? (() => new Date()); const newId = options.newId ?? randomUUID;
  const courseColumns = 'id, term_id, title, course_code, official_url, version, created_at, updated_at';
  const toCourse = (row: CourseRow): Course => ({ id: row.id, termId: row.term_id, title: row.title, courseCode: row.course_code, officialUrl: row.official_url, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
  return {
    createCourse(ownerId: string, input: CreateCourseInput): Course {
      if (!calendar.findTerm(ownerId, input.termId)) throw new ApiError(404, 'TERM_NOT_FOUND', '学期不存在');
      const timestamp = now().toISOString(); const id = newId();
      database.prepare(`insert into courses (id, owner_id, term_id, title, course_code, official_url, version, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, ownerId, input.termId, input.title, input.courseCode ?? null, input.officialUrl ?? null, 1, timestamp, timestamp);
      return toCourse(
        database
          .prepare(`select ${courseColumns} from courses where id = ? and owner_id = ?`)
          .get(id, ownerId) as CourseRow,
      );
    },
    listCourses(ownerId: string): Course[] { return (database.prepare(`select ${courseColumns} from courses where owner_id = ? order by created_at asc, id asc`).all(ownerId) as CourseRow[]).map(toCourse); },
    addResource(ownerId: string, courseId: string, input: CreateCourseResourceInput): CourseResource {
      const exists = database.prepare('select 1 from courses where id = ? and owner_id = ?').get(courseId, ownerId); if (!exists) throw new ApiError(404, 'COURSE_NOT_FOUND', '课程不存在');
      const resource: CourseResource = { id: newId(), courseId, title: input.title, url: input.url, source: 'USER_PROVIDED', createdAt: now().toISOString() };
      database.prepare('insert into course_resources (id, owner_id, course_id, title, url, source, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(resource.id, ownerId, courseId, resource.title, resource.url, resource.source, resource.createdAt); return resource;
    },
  };
}
