import { randomUUID } from 'node:crypto';
import type { Proposal } from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type { CalendarRepository } from '../calendar/repository';

function cannotApply(message: string): never {
  throw new ApiError(422, 'PROPOSAL_CANNOT_APPLY', message);
}

export function createWorkoutProposalApplier(
  database: Database.Database,
  calendarRepository: CalendarRepository,
  options: { now?: () => Date; newId?: () => string } = {},
) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const appendAudit = database.prepare(`insert into v07_audit_events (
    id, owner_id, event_type, entity_type, entity_id, entity_version, metadata_json, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?)`);

  return {
    applyAccepted(ownerId: string, proposal: Proposal): void {
      if (proposal.kind !== 'WORKOUT' || proposal.source !== 'FITNESS_AGENT' || proposal.changes.length !== 1) {
        cannotApply('当前训练提案不可应用');
      }
      const change = proposal.changes[0];
      if (!change || change.operation !== 'CREATE_WORKOUT_ACTION') cannotApply('当前训练提案不可应用');
      const workout = database.prepare(`select w.id, w.check_in_id, w.state, w.current_revision_id, w.version,
        w.proposal_id, c.safety_json from workouts_v2 w join fitness_check_ins_v2 c
        on c.id = w.check_in_id and c.owner_id = w.owner_id
        where w.owner_id = ? and w.id = ?`).get(ownerId, change.workout.workoutId) as {
        id: string; check_in_id: string; state: string; current_revision_id: string; version: number;
        proposal_id: string | null; safety_json: string;
      } | undefined;
      if (!workout || workout.state !== 'PROPOSAL_PENDING' || workout.proposal_id !== proposal.id
        || workout.current_revision_id !== change.workout.revisionId || workout.version !== change.workout.expectedWorkoutVersion) {
        cannotApply('训练草稿已变化或不可访问');
      }
      const safety = JSON.parse(workout.safety_json) as { eligibility?: unknown };
      if (safety.eligibility !== 'ELIGIBLE') cannotApply('训练状态不允许安排训练');
      const revision = database.prepare(`select content_hash from workout_revisions_v2
        where owner_id = ? and id = ? and workout_id = ?`).get(ownerId, change.workout.revisionId, workout.id) as { content_hash: string } | undefined;
      if (!revision || revision.content_hash !== change.workout.contentHash) cannotApply('训练修订已变化或不可访问');
      const citationIds = (database.prepare(`select citation_id from workout_revision_citations_v2
        where owner_id = ? and revision_id = ? order by position asc`).all(ownerId, revision ? change.workout.revisionId : '') as Array<{ citation_id: string }>)
        .map((row) => row.citation_id);
      if (citationIds.length !== change.citationIds.length || citationIds.some((id, index) => id !== change.citationIds[index])) {
        cannotApply('训练提案引用已变化或不可访问');
      }
      if (database.prepare('select id from actions where owner_id = ? and id = ?').get(ownerId, change.action.id)) {
        cannotApply('训练 Action 已存在');
      }
      if (database.prepare('select id from time_requests where owner_id = ? and id = ?').get(ownerId, change.scheduling.timeRequestId)) {
        cannotApply('训练时间请求已存在');
      }
      database.prepare(`insert into actions (id, owner_id, event_id, title, kind, status, target_date, version, created_at, updated_at)
        values (?, ?, null, ?, 'FITNESS', 'OPEN', ?, 1, ?, ?)`)
        .run(change.action.id, ownerId, change.action.title, change.action.targetDate, change.action.createdAt, change.action.updatedAt);
      database.prepare(`insert into workout_actions_v2 (id, owner_id, workout_id, revision_id, action_id, created_at)
        values (?, ?, ?, ?, ?, ?)`)
        .run(newId(), ownerId, workout.id, change.workout.revisionId, change.action.id, change.action.createdAt);
      calendarRepository.createActiveTimeRequest({
        id: change.scheduling.timeRequestId, ownerId, source: 'FITNESS_AGENT', title: change.action.title,
        targetDate: change.action.targetDate, durationMinutes: change.scheduling.durationMinutes,
        priority: change.scheduling.priority, earliestStartLocalTime: change.scheduling.earliestStartLocalTime,
        latestEndLocalTime: change.scheduling.latestEndLocalTime, isFixed: false,
        origin: { kind: 'ACTION', entityId: change.action.id, entityVersion: 1 }, version: 1,
        createdAt: change.action.createdAt, updatedAt: change.action.updatedAt,
      });
      const changed = database.prepare(`update workouts_v2
        set state = 'ACCEPTED', action_id = ?, time_request_id = ?, updated_at = ?, version = version + 1
        where owner_id = ? and id = ? and state = 'PROPOSAL_PENDING' and proposal_id = ? and version = ?`)
        .run(change.action.id, change.scheduling.timeRequestId, now().toISOString(), ownerId, workout.id, proposal.id, workout.version);
      if (changed.changes !== 1) cannotApply('训练草稿已变化');
      appendAudit.run(newId(), ownerId, 'WORKOUT_PROPOSAL_ACCEPTED', 'WORKOUT', workout.id, workout.version + 1,
        JSON.stringify({ actionId: change.action.id, proposalId: proposal.id, timeRequestId: change.scheduling.timeRequestId }), now().toISOString());
    },
    applyRejected(ownerId: string, proposal: Proposal): void {
      if (proposal.kind !== 'WORKOUT' || proposal.source !== 'FITNESS_AGENT') cannotApply('当前训练提案不可拒绝');
      const changed = database.prepare(`update workouts_v2 set state = 'REJECTED', updated_at = ?, version = version + 1
        where owner_id = ? and proposal_id = ? and state = 'PROPOSAL_PENDING'`)
        .run(now().toISOString(), ownerId, proposal.id);
      if (changed.changes !== 1) cannotApply('训练草稿已变化或不可访问');
      const workout = database.prepare('select id, version from workouts_v2 where owner_id = ? and proposal_id = ?').get(ownerId, proposal.id) as { id: string; version: number };
      appendAudit.run(newId(), ownerId, 'WORKOUT_PROPOSAL_REJECTED', 'WORKOUT', workout.id, workout.version,
        JSON.stringify({ proposalId: proposal.id }), now().toISOString());
    },
  };
}
