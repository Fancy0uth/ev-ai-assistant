import { randomUUID } from 'node:crypto';
import type { Proposal } from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type { CalendarRepository } from '../calendar/repository';

interface StoredLearningRun {
  id: string;
  course_id: string;
  search_run_id: string;
  citation_ids_json: string;
  status: string;
  proposal_id: string | null;
}

function selectedCitationIds(value: string): string[] {
  const parsed = JSON.parse(value) as { citationIds?: unknown };
  if (!parsed || !Array.isArray(parsed.citationIds) || parsed.citationIds.some((citationId) => typeof citationId !== 'string')) {
    throw new ApiError(422, 'PROPOSAL_CANNOT_APPLY', '学习提案引用已损坏');
  }
  return parsed.citationIds;
}

function cannotApply(message: string): never {
  throw new ApiError(422, 'PROPOSAL_CANNOT_APPLY', message);
}

export function createLearningProposalApplier(
  database: Database.Database,
  calendarRepository: CalendarRepository,
  options: { now?: () => Date; newId?: () => string } = {},
) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;

  return {
    applyAccepted(ownerId: string, proposal: Proposal): void {
      if (proposal.kind !== 'LEARNING' || proposal.source !== 'LEARNING_AGENT' || proposal.changes.length !== 1) {
        cannotApply('当前学习提案不可应用');
      }
      const change = proposal.changes[0];
      if (!change || change.operation !== 'CREATE_LEARNING_ACTION') cannotApply('当前学习提案不可应用');
      const run = database.prepare(`select id, course_id, search_run_id, citation_ids_json, status, proposal_id
        from learning_runs where owner_id = ? and proposal_id = ?`).get(ownerId, proposal.id) as StoredLearningRun | undefined;
      if (!run || run.status !== 'PROPOSAL_PENDING' || run.course_id !== change.action.courseId) {
        cannotApply('学习提案关联的运行已变化或不可访问');
      }
      const selected = selectedCitationIds(run.citation_ids_json);
      if (change.citationIds.some((citationId) => !selected.includes(citationId))) {
        cannotApply('学习提案包含未选择的引用');
      }
      const citationRows = database.prepare(`select id from course_resource_citations
        where owner_id = ? and course_id = ? and search_run_id = ? and id in (${change.citationIds.map(() => '?').join(',')})`)
        .all(ownerId, run.course_id, run.search_run_id, ...change.citationIds) as Array<{ id: string }>;
      if (citationRows.length !== change.citationIds.length) cannotApply('学习提案引用已变化或不可访问');
      const course = database.prepare('select id from courses where owner_id = ? and id = ?').get(ownerId, run.course_id) as { id: string } | undefined;
      if (!course) cannotApply('学习提案课程已变化或不可访问');
      const duplicate = database.prepare('select id from actions where owner_id = ? and id = ?').get(ownerId, change.action.id);
      if (duplicate) cannotApply('学习提案 Action 已存在');

      database.prepare(`insert into actions (id, owner_id, event_id, title, kind, status, target_date, version, created_at, updated_at)
        values (?, ?, null, ?, 'STUDY', 'OPEN', ?, 1, ?, ?)`)
        .run(change.action.id, ownerId, change.action.title, change.action.targetDate, change.action.createdAt, change.action.updatedAt);
      database.prepare('insert into learning_actions (owner_id, action_id, course_id, learning_run_id, created_at) values (?, ?, ?, ?, ?)')
        .run(ownerId, change.action.id, run.course_id, run.id, change.action.createdAt);
      const insertCitation = database.prepare('insert into learning_action_citations (owner_id, action_id, citation_id, created_at) values (?, ?, ?, ?)');
      for (const citationId of change.citationIds) insertCitation.run(ownerId, change.action.id, citationId, change.action.createdAt);
      calendarRepository.createActiveTimeRequest({
        id: change.scheduling.timeRequestId,
        ownerId,
        source: 'LEARNING_AGENT',
        title: change.action.title,
        targetDate: change.action.targetDate,
        durationMinutes: change.scheduling.durationMinutes,
        priority: change.scheduling.priority,
        earliestStartLocalTime: change.scheduling.earliestStartLocalTime,
        latestEndLocalTime: change.scheduling.latestEndLocalTime,
        isFixed: false,
        origin: { kind: 'ACTION', entityId: change.action.id, entityVersion: 1 },
        version: 1,
        createdAt: change.action.createdAt,
        updatedAt: change.action.updatedAt,
      });
      const changed = database.prepare(`update learning_runs set status = 'ACCEPTED', updated_at = ?, version = version + 1
        where owner_id = ? and id = ? and status = 'PROPOSAL_PENDING'`).run(now().toISOString(), ownerId, run.id);
      if (changed.changes !== 1) cannotApply('学习提案运行已变化');
      database.prepare(`insert into audit_events (id, owner_id, event_type, entity_type, entity_id, metadata_json, created_at)
        values (?, ?, 'LEARNING_PROPOSAL_MATERIALIZED', 'LEARNING_RUN', ?, ?, ?)`)
        .run(newId(), ownerId, run.id, JSON.stringify({ proposalId: proposal.id, actionId: change.action.id, timeRequestId: change.scheduling.timeRequestId }), now().toISOString());
    },
    applyRejected(ownerId: string, proposal: Proposal): void {
      if (proposal.kind !== 'LEARNING' || proposal.source !== 'LEARNING_AGENT') cannotApply('当前学习提案不可拒绝');
      const changed = database.prepare(`update learning_runs set status = 'REJECTED', updated_at = ?, version = version + 1
        where owner_id = ? and proposal_id = ? and status = 'PROPOSAL_PENDING'`)
        .run(now().toISOString(), ownerId, proposal.id);
      if (changed.changes !== 1) cannotApply('学习提案运行已变化或不可访问');
    },
  };
}
