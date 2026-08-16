import { createHash, randomUUID } from 'node:crypto';
import {
  courseImportRunSchema,
  courseScheduleExtractionSchema,
  type CourseImportRun,
  type CreateCourseImportInput,
  type Proposal,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type { CourseScheduleVisionProvider } from '../agents/provider';
import type { ProposalRepository } from '../proposals/repository';
import type { CalendarRepository } from './repository';

const LOW_CONFIDENCE_THRESHOLD = 0.75;
const MAX_IMAGE_BYTES = 5_000_000;

interface CourseImportRunRow {
  id: string;
  term_id: string;
  status: CourseImportRun['status'];
  image_mime_type: CourseImportRun['imageMimeType'];
  image_byte_size: number;
  image_sha256: string;
  candidates_json: string;
  proposal_id: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

interface CourseImportServiceOptions {
  now?: () => Date;
  newId?: () => string;
  provider?: CourseScheduleVisionProvider;
}

export interface CourseImportResult {
  run: CourseImportRun;
  proposal: Proposal | null;
}

export interface CourseImportService {
  create(ownerId: string, input: CreateCourseImportInput): Promise<CourseImportResult>;
  findById(ownerId: string, runId: string): CourseImportResult;
}

function toRun(row: CourseImportRunRow): CourseImportRun {
  return courseImportRunSchema.parse({
    id: row.id,
    termId: row.term_id,
    status: row.status,
    imageMimeType: row.image_mime_type,
    imageByteSize: row.image_byte_size,
    imageSha256: row.image_sha256,
    candidates: JSON.parse(row.candidates_json),
    candidateCount: JSON.parse(row.candidates_json).length,
    proposalId: row.proposal_id,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const runColumns = `
  id, term_id, status, image_mime_type, image_byte_size, image_sha256, candidates_json,
  proposal_id, failure_code, created_at, updated_at
`;

export function createCourseImportService(
  database: Database.Database,
  calendarRepository: CalendarRepository,
  proposalRepository: ProposalRepository,
  options: CourseImportServiceOptions = {},
): CourseImportService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const findRunStatement = database.prepare(
    `select ${runColumns} from course_import_runs where id = ? and owner_id = ?`,
  );
  const updateRunStatement = database.prepare(
    `update course_import_runs
     set status = ?, candidates_json = ?, proposal_id = ?, failure_code = ?, updated_at = ?
     where id = ? and owner_id = ?`,
  );

  function findRun(ownerId: string, runId: string): CourseImportRun | undefined {
    const row = findRunStatement.get(runId, ownerId) as CourseImportRunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  function updateRun(
    ownerId: string,
    runId: string,
    status: CourseImportRun['status'],
    candidates: CourseImportRun['candidates'],
    proposalId: string | null,
    failureCode: string | null,
  ): CourseImportRun {
    updateRunStatement.run(
      status,
      JSON.stringify(candidates),
      proposalId,
      failureCode,
      now().toISOString(),
      runId,
      ownerId,
    );
    const run = findRun(ownerId, runId);
    if (!run) throw new Error('course import run disappeared');
    return run;
  }

  function result(ownerId: string, run: CourseImportRun): CourseImportResult {
    return {
      run,
      proposal: run.proposalId ? proposalRepository.findById(ownerId, run.proposalId) ?? null : null,
    };
  }

  return {
    async create(ownerId, input) {
      if (!calendarRepository.findTerm(ownerId, input.termId)) {
        throw new ApiError(404, 'TERM_NOT_FOUND', '学期不存在');
      }
      const image = Buffer.from(input.image.base64, 'base64');
      if (image.byteLength > MAX_IMAGE_BYTES) {
        throw new ApiError(422, 'VALIDATION_ERROR', '课表截图不能超过 5MB');
      }

      const timestamp = now().toISOString();
      const runId = newId();
      database
        .prepare(
          `insert into course_import_runs (
             id, owner_id, term_id, status, image_mime_type, image_byte_size, image_sha256,
             candidates_json, proposal_id, failure_code, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          ownerId,
          input.termId,
          'BLOCKED',
          input.image.mimeType,
          image.byteLength,
          createHash('sha256').update(image).digest('hex'),
          '[]',
          null,
          null,
          timestamp,
          timestamp,
        );

      if (!options.provider) {
        updateRun(ownerId, runId, 'BLOCKED', [], null, 'VISION_PROVIDER_NOT_CONFIGURED');
        throw new ApiError(
          503,
          'COURSE_IMPORT_PROVIDER_NOT_CONFIGURED',
          '课表识别 Provider 尚未配置',
        );
      }

      let extraction: ReturnType<typeof courseScheduleExtractionSchema.parse>;
      try {
        extraction = courseScheduleExtractionSchema.parse(
          await options.provider.extract({ image: input.image }),
        );
      } catch {
        updateRun(ownerId, runId, 'FAILED', [], null, 'VISION_PROVIDER_RESPONSE_INVALID');
        throw new ApiError(422, 'COURSE_IMPORT_RESPONSE_INVALID', '课表识别结果不符合要求');
      }

      if (extraction.candidates.some((candidate) => candidate.confidence < LOW_CONFIDENCE_THRESHOLD)) {
        const run = updateRun(
          ownerId,
          runId,
          'REVIEW_REQUIRED',
          extraction.candidates,
          null,
          null,
        );
        return result(ownerId, run);
      }

      const proposalId = newId();
      const proposal = proposalRepository.create({
        id: proposalId,
        ownerId,
        kind: 'SCHEDULE',
        status: 'PENDING',
        source: 'COURSE_IMPORT',
        title: '确认导入课表',
        changes: extraction.candidates.map((candidate) => ({
          operation: 'CREATE_CALENDAR_RULE' as const,
          rule: {
            id: newId(),
            termId: input.termId,
            title: candidate.title.trim(),
            weekday: candidate.weekday,
            startLocalTime: candidate.startLocalTime,
            endLocalTime: candidate.endLocalTime,
            weekStart: candidate.weekStart,
            weekEnd: candidate.weekEnd,
            weekPattern: candidate.weekPattern,
            isHard: true,
            version: 1,
          },
        })),
        version: 1,
        createdAt: timestamp,
        expiresAt: null,
      });
      const run = updateRun(ownerId, runId, 'PROPOSED', extraction.candidates, proposal.id, null);
      return { run, proposal };
    },

    findById(ownerId, runId) {
      const run = findRun(ownerId, runId);
      if (!run) throw new ApiError(404, 'COURSE_IMPORT_NOT_FOUND', '课表导入记录不存在');
      return result(ownerId, run);
    },
  };
}
