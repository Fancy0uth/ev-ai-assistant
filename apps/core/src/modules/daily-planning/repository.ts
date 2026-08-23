import {
  dailyPlanReviewSchema,
  dailyPlanProposalSchema,
  dailyPlanRunSchema,
  type DailyPlanContextManifest,
  type DailyPlanDecisionInput,
  type DailyPlanDecisionRecord,
  type DailyPlanFailureCode,
  type DailyPlanProposalItem,
  type DailyPlanProposal,
  type DailyPlanReview,
  type DailyPlanRun,
  type DailyPlanTrigger,
  type Event,
  type LocalTime,
  type TimeRequestSource,
} from '@ev/contracts';
import type Database from 'better-sqlite3';

export interface DailyPlanningEventContext {
  startLocalTime: LocalTime;
  endLocalTime: LocalTime;
  isHard: boolean;
}

export interface DailyPlanningTimeRequestContext {
  id: string;
  version: number;
  source: TimeRequestSource;
  targetDate: string;
  durationMinutes: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  earliestStartLocalTime: LocalTime | null;
  latestEndLocalTime: LocalTime | null;
  isFixed: boolean;
}

export interface DailyPlanningReviewEventContext extends DailyPlanningEventContext {
  id: string;
}

export interface DailyPlanningReviewTimeRequestContext extends DailyPlanningTimeRequestContext {
  title: string;
}

export interface DailyPlanningRecoveryContext {
  value: number;
}

export interface DailyPlanningReadContext {
  events: DailyPlanningEventContext[];
  timeRequests: DailyPlanningTimeRequestContext[];
  latestRecovery: DailyPlanningRecoveryContext | undefined;
}

export interface NewContextReadyDailyPlanRun {
  id: string;
  ownerId: string;
  localDate: string;
  trigger: DailyPlanTrigger;
  contextManifest: DailyPlanContextManifest;
  createdAt: string;
}

export interface DailyPlanProposalListQuery {
  localDate?: string;
  page: number;
  pageSize: number;
}

export interface DailyPlanProposalList {
  items: DailyPlanReview[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface DailyPlanReviewExecutionContext {
  review: DailyPlanReview;
  contextManifest: DailyPlanContextManifest;
  scheduleVersion: number;
  events: DailyPlanningReviewEventContext[];
  timeRequests: DailyPlanningReviewTimeRequestContext[];
}

export interface PreparedDailyPlanSoftEvent {
  id: string;
  kind: Event['kind'];
  startLocalTime: LocalTime;
  endLocalTime: LocalTime;
  createdAt: string;
  updatedAt: string;
}

export interface PreparedDailyPlanReviewDecision {
  id: string;
  input: DailyPlanDecisionInput;
  scheduledEvent?: PreparedDailyPlanSoftEvent;
}

export interface CommitReviewDecisionsInput {
  expectedProposalVersion: number;
  decisions: PreparedDailyPlanReviewDecision[];
  updatedAt?: string;
}

export interface DailyPlanRunRepository {
  readContext(ownerId: string, localDate: string): DailyPlanningReadContext;
  readScheduleVersion(ownerId: string): { version: number };
  createContextReady(input: NewContextReadyDailyPlanRun): DailyPlanRun;
  getRun(ownerId: string, runId: string): DailyPlanRun | undefined;
  findProposalByRun(ownerId: string, runId: string): DailyPlanProposal | undefined;
  listProposals(ownerId: string, query: DailyPlanProposalListQuery): DailyPlanProposalList;
  getReview(ownerId: string, proposalId: string): DailyPlanReview | undefined;
  getReviewExecutionContext(
    ownerId: string,
    proposalId: string,
  ): DailyPlanReviewExecutionContext | undefined;
  commitReviewDecisions(
    ownerId: string,
    proposalId: string,
    input: CommitReviewDecisionsInput,
  ): DailyPlanReview;
  completeWithProposal(
    ownerId: string,
    runId: string,
    baseScheduleVersion: number,
    proposal: DailyPlanProposal,
  ): DailyPlanProposal;
  failRun(ownerId: string, runId: string, code: DailyPlanFailureCode): DailyPlanRun;
}

export class DailyPlanBaseVersionStaleError extends Error {
  constructor() {
    super('DAILY_PLAN_BASE_VERSION_STALE');
    this.name = 'DailyPlanBaseVersionStaleError';
  }
}

export class DailyPlanReviewCommitConflictError extends Error {
  constructor() {
    super('DAILY_PLAN_REVIEW_COMMIT_CONFLICT');
    this.name = 'DailyPlanReviewCommitConflictError';
  }
}

export class DailyPlanReviewBaseVersionStaleError extends Error {
  constructor(readonly review: DailyPlanReview) {
    super('DAILY_PLAN_BASE_VERSION_STALE');
    this.name = 'DailyPlanReviewBaseVersionStaleError';
  }
}

class DailyPlanRunStateConflictError extends Error {
  constructor() {
    super('DAILY_PLAN_RUN_STATE_CONFLICT');
    this.name = 'DailyPlanRunStateConflictError';
  }
}

class DailyPlanProposalNotReviewableError extends Error {
  constructor() {
    super('DAILY_PLAN_PROPOSAL_NOT_REVIEWABLE');
    this.name = 'DailyPlanProposalNotReviewableError';
  }
}

interface EventContextRow {
  start_local_time: LocalTime;
  end_local_time: LocalTime;
  is_hard: number;
}

interface TimeRequestContextRow {
  id: string;
  version: number;
  source: TimeRequestSource;
  target_date: string;
  duration_minutes: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  earliest_start_local_time: LocalTime | null;
  latest_end_local_time: LocalTime | null;
  is_fixed: number;
}

interface ReviewTimeRequestContextRow extends TimeRequestContextRow {
  title: string;
}

interface ReviewEventContextRow extends EventContextRow {
  id: string;
}

interface RecoveryContextRow {
  value: number;
}

interface ScheduleVersionRow {
  version: number;
}

interface DailyPlanRunRow {
  id: string;
  contract_version: 'DAILY_PLAN_V1';
  local_date: string;
  trigger: DailyPlanTrigger;
  status: DailyPlanRun['status'];
  context_manifest_json: string;
  proposal_id: string | null;
  failure_code: DailyPlanFailureCode | null;
  created_at: string;
  completed_at: string | null;
}

interface DailyPlanProposalRow {
  id: string;
  contract_version: 'DAILY_PLAN_V1';
  run_id: string;
  local_date: string;
  status: DailyPlanProposal['status'];
  base_schedule_version: number;
  summary: string;
  items_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ProposalDecisionRow {
  proposal_item_id: string;
  decision: 'APPLY' | 'REJECT';
  scheduled_event_id: string | null;
  actual_start_local_time: LocalTime | null;
  actual_end_local_time: LocalTime | null;
  rejection_reason: string | null;
}

interface ProposalDecisionWithProposalRow extends ProposalDecisionRow {
  proposal_id: string;
}

interface ProposalCountRow {
  count: number;
}

interface TimeRequestTitleRow {
  title: string;
}

function toDailyPlanRun(row: DailyPlanRunRow): DailyPlanRun {
  return dailyPlanRunSchema.parse({
    id: row.id,
    contractVersion: row.contract_version,
    localDate: row.local_date,
    trigger: row.trigger,
    status: row.status,
    contextManifest: JSON.parse(row.context_manifest_json) as unknown,
    proposalId: row.proposal_id,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
}

function toDailyPlanProposal(row: DailyPlanProposalRow): DailyPlanProposal {
  return dailyPlanProposalSchema.parse({
    id: row.id,
    contractVersion: row.contract_version,
    runId: row.run_id,
    localDate: row.local_date,
    status: row.status,
    baseScheduleVersion: row.base_schedule_version,
    summary: row.summary,
    items: JSON.parse(row.items_json) as unknown,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toDailyPlanDecision(row: ProposalDecisionRow): DailyPlanDecisionRecord {
  if (row.decision === 'APPLY') {
    return {
      itemId: row.proposal_item_id,
      decision: 'APPLY',
      scheduledEventId: row.scheduled_event_id,
      startLocalTime: row.actual_start_local_time,
      endLocalTime: row.actual_end_local_time,
      reason: null,
    };
  }

  return {
    itemId: row.proposal_item_id,
    decision: 'REJECT',
    scheduledEventId: null,
    startLocalTime: null,
    endLocalTime: null,
    reason: row.rejection_reason,
  };
}

function toDailyPlanReview(
  proposalRow: DailyPlanProposalRow,
  decisionRows: ProposalDecisionRow[],
): DailyPlanReview {
  return dailyPlanReviewSchema.parse({
    proposal: toDailyPlanProposal(proposalRow),
    decisions: decisionRows.map(toDailyPlanDecision),
  });
}

function proposalStatus(items: DailyPlanProposalItem[]): DailyPlanProposal['status'] {
  if (items.some((item) => item.status === 'PENDING_REVIEW')) {
    return items.some((item) => item.status === 'APPLIED')
      ? 'PARTIALLY_APPLIED'
      : 'PENDING_REVIEW';
  }
  return items.every((item) => item.status === 'REJECTED') ? 'REJECTED' : 'APPLIED';
}

function completionTimestamp(createdAt: string): string {
  const now = new Date().toISOString();
  return now >= createdAt ? now : createdAt;
}

export function createDailyPlanRunRepository(database: Database.Database): DailyPlanRunRepository {
  const readEvents = database.prepare(
    `select start_local_time, end_local_time, is_hard
     from events
     where owner_id = ? and local_date = ? and status = 'CONFIRMED'
     order by start_local_time asc, end_local_time asc, id asc`,
  );
  const readTimeRequests = database.prepare(
    `select id, version, source, target_date, duration_minutes, priority,
            earliest_start_local_time, latest_end_local_time, is_fixed
     from time_requests as request
     where request.owner_id = ? and request.target_date = ?
       and not exists (
         select 1
         from proposal_decisions as decision
         left join events as scheduled_event
           on scheduled_event.id = decision.scheduled_event_id
          and scheduled_event.owner_id = request.owner_id
         where decision.owner_id = request.owner_id
           and decision.time_request_id = request.id
           and decision.decision = 'APPLY'
           and (
             decision.scheduled_event_id is null
             or scheduled_event.status = 'CONFIRMED'
           )
       )
     order by
       case priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,
       created_at asc,
       id asc`,
  );
  const readLatestRecovery = database.prepare(
    `select value
     from signals
     where owner_id = ? and local_date = ? and kind = 'RECOVERY'
     order by created_at desc, id desc
     limit 1`,
  );
  const readScheduleVersion = database.prepare(
    `select version
     from schedule_versions
     where owner_id = ?`,
  );
  const findRun = database.prepare(
    `select id, contract_version, local_date, trigger, status, context_manifest_json,
            proposal_id, failure_code, created_at, completed_at
     from daily_plan_runs
     where id = ? and owner_id = ?`,
  );
  const findProposalByRun = database.prepare(
    `select id, contract_version, run_id, local_date, status, base_schedule_version, summary,
            items_json, version, created_at, updated_at
     from daily_plan_proposals
     where run_id = ? and owner_id = ?`,
  );
  const findProposal = database.prepare(
    `select id, contract_version, run_id, local_date, status, base_schedule_version, summary,
            items_json, version, created_at, updated_at
     from daily_plan_proposals
     where id = ? and owner_id = ?`,
  );
  const findProposalDecisions = database.prepare(
    `select proposal_item_id, decision, scheduled_event_id, actual_start_local_time, actual_end_local_time,
            rejection_reason
     from proposal_decisions
     where proposal_id = ? and owner_id = ?
     order by created_at asc, id asc`,
  );
  const listProposalsForOwner = database.prepare(
    `select id, contract_version, run_id, local_date, status, base_schedule_version, summary,
            items_json, version, created_at, updated_at
     from daily_plan_proposals
     where owner_id = ?
     order by updated_at desc, id asc
     limit ? offset ?`,
  );
  const listProposalsForOwnerDate = database.prepare(
    `select id, contract_version, run_id, local_date, status, base_schedule_version, summary,
            items_json, version, created_at, updated_at
     from daily_plan_proposals
     where owner_id = ? and local_date = ?
     order by updated_at desc, id asc
     limit ? offset ?`,
  );
  const countProposalsForOwner = database.prepare(
    'select count(*) as count from daily_plan_proposals where owner_id = ?',
  );
  const countProposalsForOwnerDate = database.prepare(
    'select count(*) as count from daily_plan_proposals where owner_id = ? and local_date = ?',
  );
  const readReviewEvents = database.prepare(
    `select id, start_local_time, end_local_time, is_hard
     from events
     where owner_id = ? and local_date = ? and status = 'CONFIRMED'
     order by start_local_time asc, end_local_time asc, id asc`,
  );
  const readReviewTimeRequests = database.prepare(
    `select id, version, source, title, target_date, duration_minutes, priority,
            earliest_start_local_time, latest_end_local_time, is_fixed
     from time_requests
     where owner_id = ? and target_date = ?
     order by
       case priority when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,
       created_at asc,
       id asc`,
  );
  const findTimeRequestTitle = database.prepare(
    'select title from time_requests where id = ? and owner_id = ?',
  );
  const insertDecision = database.prepare(
    `insert into proposal_decisions (
       id, owner_id, proposal_id, proposal_item_id, time_request_id, decision,
       scheduled_event_id, actual_start_local_time, actual_end_local_time, rejection_reason,
       created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSoftEvent = database.prepare(
    `insert into events (
       id, owner_id, calendar_rule_id, title, kind, local_date, start_local_time,
       end_local_time, is_hard, status, version, created_at, updated_at
     ) values (?, ?, null, ?, ?, ?, ?, ?, 0, 'CONFIRMED', 1, ?, ?)`,
  );
  const updateProposalAfterDecisions = database.prepare(
    `update daily_plan_proposals
     set status = ?, base_schedule_version = ?, items_json = ?, version = ?, updated_at = ?
     where id = ? and owner_id = ? and version = ?`,
  );

  function decisionRowsByProposal(
    ownerId: string,
    proposalIds: string[],
  ): Map<string, ProposalDecisionRow[]> {
    if (proposalIds.length === 0) {
      return new Map();
    }
    const placeholders = proposalIds.map(() => '?').join(', ');
    const rows = database
      .prepare(
        `select proposal_id, proposal_item_id, decision, actual_start_local_time,
                scheduled_event_id, actual_end_local_time, rejection_reason
         from proposal_decisions
         where owner_id = ? and proposal_id in (${placeholders})
         order by proposal_id asc, created_at asc, id asc`,
      )
      .all(ownerId, ...proposalIds) as ProposalDecisionWithProposalRow[];
    const byProposal = new Map<string, ProposalDecisionRow[]>();
    for (const row of rows) {
      const decisions = byProposal.get(row.proposal_id);
      if (decisions) {
        decisions.push(row);
      } else {
        byProposal.set(row.proposal_id, [row]);
      }
    }
    return byProposal;
  }
  const insertProposal = database.prepare(
    `insert into daily_plan_proposals (
       id, owner_id, run_id, contract_version, local_date, status, base_schedule_version,
       summary, items_json, version, created_at, updated_at
     ) values (?, ?, ?, 'DAILY_PLAN_V1', ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?)`,
  );
  const completeRun = database.prepare(
    `update daily_plan_runs
     set status = 'SUCCEEDED', proposal_id = ?, failure_code = null, completed_at = ?
     where id = ? and owner_id = ? and status = 'CONTEXT_READY'`,
  );
  const failContextReadyRun = database.prepare(
    `update daily_plan_runs
     set status = 'FAILED', proposal_id = null, failure_code = ?, completed_at = ?
     where id = ? and owner_id = ? and status = 'CONTEXT_READY'`,
  );
  const failActiveRun = database.prepare(
    `update daily_plan_runs
     set status = 'FAILED', proposal_id = null, failure_code = ?, completed_at = ?
     where id = ? and owner_id = ? and status in ('CREATED', 'CONTEXT_READY', 'GENERATING')`,
  );

  const completeWithProposalTransaction = database.transaction(
    (
      ownerId: string,
      runId: string,
      baseScheduleVersion: number,
      proposal: DailyPlanProposal,
    ): { proposal: DailyPlanProposal } | { stale: true } => {
      const run = findRun.get(runId, ownerId) as DailyPlanRunRow | undefined;
      if (!run || run.status !== 'CONTEXT_READY') {
        throw new DailyPlanRunStateConflictError();
      }
      if (proposal.status !== 'PENDING_REVIEW') {
        throw new DailyPlanProposalNotReviewableError();
      }

      const scheduleVersion = readScheduleVersion.get(ownerId) as ScheduleVersionRow | undefined;
      if (!scheduleVersion || scheduleVersion.version !== baseScheduleVersion) {
        failContextReadyRun.run(
          'DAILY_PLAN_BASE_VERSION_STALE',
          completionTimestamp(run.created_at),
          runId,
          ownerId,
        );
        return { stale: true };
      }

      insertProposal.run(
        proposal.id,
        ownerId,
        runId,
        proposal.localDate,
        baseScheduleVersion,
        proposal.summary,
        JSON.stringify(proposal.items),
        proposal.version,
        proposal.createdAt,
        proposal.updatedAt,
      );
      completeRun.run(proposal.id, completionTimestamp(run.created_at), runId, ownerId);

      return {
        proposal: toDailyPlanProposal(
          findProposalByRun.get(runId, ownerId) as DailyPlanProposalRow,
        ),
      };
    },
  );

  function completeWithProposal(
    ownerId: string,
    runId: string,
    baseScheduleVersion: number,
    proposal: DailyPlanProposal,
  ): DailyPlanProposal {
    const result = completeWithProposalTransaction(
      ownerId,
      runId,
      baseScheduleVersion,
      proposal,
    );
    if ('stale' in result) {
      throw new DailyPlanBaseVersionStaleError();
    }
    return result.proposal;
  }

  const commitReviewDecisionsTransaction = database.transaction(
    (
      ownerId: string,
      proposalId: string,
      input: CommitReviewDecisionsInput,
    ): { review: DailyPlanReview } | { stale: DailyPlanReview } => {
      const proposalRow = findProposal.get(proposalId, ownerId) as DailyPlanProposalRow | undefined;
      if (!proposalRow) {
        throw new DailyPlanReviewCommitConflictError();
      }
      const proposal = toDailyPlanProposal(proposalRow);
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      if (
        input.decisions.length === 0 ||
        proposal.version !== input.expectedProposalVersion ||
        !['PENDING_REVIEW', 'PARTIALLY_APPLIED'].includes(proposal.status)
      ) {
        throw new DailyPlanReviewCommitConflictError();
      }

      const scheduleVersion = readScheduleVersion.get(ownerId) as ScheduleVersionRow | undefined;
      if (!scheduleVersion) {
        throw new DailyPlanReviewCommitConflictError();
      }
      if (scheduleVersion.version !== proposal.baseScheduleVersion) {
        const stale = updateProposalAfterDecisions.run(
          'STALE',
          proposal.baseScheduleVersion,
          JSON.stringify(proposal.items),
          proposal.version + 1,
          updatedAt,
          proposalId,
          ownerId,
          proposal.version,
        );
        if (stale.changes !== 1) {
          throw new DailyPlanReviewCommitConflictError();
        }
        const staleRow = findProposal.get(proposalId, ownerId) as DailyPlanProposalRow | undefined;
        if (!staleRow) {
          throw new DailyPlanReviewCommitConflictError();
        }
        return {
          stale: toDailyPlanReview(
            staleRow,
            findProposalDecisions.all(proposalId, ownerId) as ProposalDecisionRow[],
          ),
        };
      }

      const seenItemIds = new Set<string>();
      const updatedItems: DailyPlanProposalItem[] = proposal.items.map((item) => ({ ...item }));

      for (const decision of input.decisions) {
        if (seenItemIds.has(decision.input.itemId)) {
          throw new DailyPlanReviewCommitConflictError();
        }
        seenItemIds.add(decision.input.itemId);

        const item = updatedItems.find((candidate) => candidate.id === decision.input.itemId);
        if (!item || item.status !== 'PENDING_REVIEW') {
          throw new DailyPlanReviewCommitConflictError();
        }

        let scheduledEventId: string | null = null;
        let actualStartLocalTime: LocalTime | null = null;
        let actualEndLocalTime: LocalTime | null = null;
        let rejectionReason: string | null = null;

        if (decision.input.decision === 'APPLY') {
          if (item.operation === 'SCHEDULE_TIME_REQUEST') {
            const scheduledEvent = decision.scheduledEvent;
            if (!scheduledEvent) {
              throw new DailyPlanReviewCommitConflictError();
            }
            if (
              decision.input.startLocalTime !== undefined &&
              (decision.input.startLocalTime !== scheduledEvent.startLocalTime ||
                decision.input.endLocalTime !== scheduledEvent.endLocalTime)
            ) {
              throw new DailyPlanReviewCommitConflictError();
            }
            const timeRequest = findTimeRequestTitle.get(item.timeRequestId, ownerId) as
              | TimeRequestTitleRow
              | undefined;
            if (!timeRequest) {
              throw new DailyPlanReviewCommitConflictError();
            }
            insertSoftEvent.run(
              scheduledEvent.id,
              ownerId,
              timeRequest.title,
              scheduledEvent.kind,
              proposal.localDate,
              scheduledEvent.startLocalTime,
              scheduledEvent.endLocalTime,
              scheduledEvent.createdAt,
              scheduledEvent.updatedAt,
            );
            scheduledEventId = scheduledEvent.id;
            actualStartLocalTime = scheduledEvent.startLocalTime;
            actualEndLocalTime = scheduledEvent.endLocalTime;
            item.startLocalTime = scheduledEvent.startLocalTime;
            item.endLocalTime = scheduledEvent.endLocalTime;
          } else {
            if (
              decision.scheduledEvent !== undefined ||
              decision.input.startLocalTime !== undefined ||
              decision.input.endLocalTime !== undefined
            ) {
              throw new DailyPlanReviewCommitConflictError();
            }
          }
          item.status = 'APPLIED';
        } else {
          if (decision.scheduledEvent !== undefined) {
            throw new DailyPlanReviewCommitConflictError();
          }
          item.status = 'REJECTED';
          rejectionReason = decision.input.reason ?? null;
        }

        insertDecision.run(
          decision.id,
          ownerId,
          proposalId,
          item.id,
          item.timeRequestId,
          decision.input.decision,
          scheduledEventId,
          actualStartLocalTime,
          actualEndLocalTime,
          rejectionReason,
          updatedAt,
        );
      }

      const currentScheduleVersion = readScheduleVersion.get(ownerId) as ScheduleVersionRow | undefined;
      if (!currentScheduleVersion) {
        throw new DailyPlanReviewCommitConflictError();
      }
      const updated = updateProposalAfterDecisions.run(
        proposalStatus(updatedItems),
        currentScheduleVersion.version,
        JSON.stringify(updatedItems),
        proposal.version + 1,
        updatedAt,
        proposalId,
        ownerId,
        proposal.version,
      );
      if (updated.changes !== 1) {
        throw new DailyPlanReviewCommitConflictError();
      }
      const updatedRow = findProposal.get(proposalId, ownerId) as DailyPlanProposalRow | undefined;
      if (!updatedRow) {
        throw new DailyPlanReviewCommitConflictError();
      }
      return {
        review: toDailyPlanReview(
          updatedRow,
          findProposalDecisions.all(proposalId, ownerId) as ProposalDecisionRow[],
        ),
      };
    },
  );

  function commitReviewDecisions(
    ownerId: string,
    proposalId: string,
    input: CommitReviewDecisionsInput,
  ): DailyPlanReview {
    const result = commitReviewDecisionsTransaction(ownerId, proposalId, input);
    if ('stale' in result) {
      throw new DailyPlanReviewBaseVersionStaleError(result.stale);
    }
    return result.review;
  }

  const failRun = database.transaction(
    (ownerId: string, runId: string, code: DailyPlanFailureCode): DailyPlanRun => {
      const run = findRun.get(runId, ownerId) as DailyPlanRunRow | undefined;
      if (!run || !['CREATED', 'CONTEXT_READY', 'GENERATING'].includes(run.status)) {
        throw new DailyPlanRunStateConflictError();
      }

      failActiveRun.run(code, completionTimestamp(run.created_at), runId, ownerId);
      return toDailyPlanRun(findRun.get(runId, ownerId) as DailyPlanRunRow);
    },
  );

  return {
    readContext(ownerId, localDate) {
      const events = (readEvents.all(ownerId, localDate) as EventContextRow[]).map((row) => ({
        startLocalTime: row.start_local_time,
        endLocalTime: row.end_local_time,
        isHard: row.is_hard === 1,
      }));
      const timeRequests = (readTimeRequests.all(ownerId, localDate) as TimeRequestContextRow[]).map(
        (row) => ({
          id: row.id,
          version: row.version,
          source: row.source,
          targetDate: row.target_date,
          durationMinutes: row.duration_minutes,
          priority: row.priority,
          earliestStartLocalTime: row.earliest_start_local_time,
          latestEndLocalTime: row.latest_end_local_time,
          isFixed: row.is_fixed === 1,
        }),
      );
      const latestRecovery = readLatestRecovery.get(ownerId, localDate) as
        | RecoveryContextRow
        | undefined;

      return {
        events,
        timeRequests,
        latestRecovery: latestRecovery ? { value: latestRecovery.value } : undefined,
      };
    },

    readScheduleVersion(ownerId) {
      const row = readScheduleVersion.get(ownerId) as ScheduleVersionRow | undefined;
      if (!row) {
        throw new Error('daily planning schedule version is missing');
      }
      return { version: row.version };
    },

    createContextReady(input) {
      database
        .prepare(
          `insert into daily_plan_runs (
             id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
             proposal_id, failure_code, created_at, completed_at
           ) values (?, ?, 'DAILY_PLAN_V1', ?, ?, 'CONTEXT_READY', ?, null, null, ?, null)`,
        )
        .run(
          input.id,
          input.ownerId,
          input.localDate,
          input.trigger,
          JSON.stringify(input.contextManifest),
          input.createdAt,
        );

      return toDailyPlanRun(
        findRun.get(input.id, input.ownerId) as DailyPlanRunRow,
      );
    },

    getRun(ownerId, runId) {
      const row = findRun.get(runId, ownerId) as DailyPlanRunRow | undefined;
      return row ? toDailyPlanRun(row) : undefined;
    },

    findProposalByRun(ownerId, runId) {
      const row = findProposalByRun.get(runId, ownerId) as DailyPlanProposalRow | undefined;
      return row ? toDailyPlanProposal(row) : undefined;
    },

    listProposals(ownerId, query) {
      const offset = (query.page - 1) * query.pageSize;
      const rows = query.localDate === undefined
        ? (listProposalsForOwner.all(ownerId, query.pageSize, offset) as DailyPlanProposalRow[])
        : (listProposalsForOwnerDate.all(
            ownerId,
            query.localDate,
            query.pageSize,
            offset,
          ) as DailyPlanProposalRow[]);
      const count = query.localDate === undefined
        ? (countProposalsForOwner.get(ownerId) as ProposalCountRow)
        : (countProposalsForOwnerDate.get(ownerId, query.localDate) as ProposalCountRow);
      const decisionsByProposal = decisionRowsByProposal(
        ownerId,
        rows.map((row) => row.id),
      );

      return {
        items: rows.map((row) =>
          toDailyPlanReview(row, decisionsByProposal.get(row.id) ?? []),
        ),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: count.count,
          totalPages: Math.ceil(count.count / query.pageSize),
        },
      };
    },

    getReview(ownerId, proposalId) {
      const row = findProposal.get(proposalId, ownerId) as DailyPlanProposalRow | undefined;
      return row
        ? toDailyPlanReview(
            row,
            findProposalDecisions.all(proposalId, ownerId) as ProposalDecisionRow[],
          )
        : undefined;
    },

    getReviewExecutionContext(ownerId, proposalId) {
      const proposalRow = findProposal.get(proposalId, ownerId) as DailyPlanProposalRow | undefined;
      if (!proposalRow) {
        return undefined;
      }
      const runRow = findRun.get(proposalRow.run_id, ownerId) as DailyPlanRunRow | undefined;
      if (!runRow) {
        throw new Error('daily planning run is missing for proposal');
      }
      const scheduleVersion = readScheduleVersion.get(ownerId) as ScheduleVersionRow | undefined;
      if (!scheduleVersion) {
        throw new Error('daily planning schedule version is missing');
      }
      const events = (readReviewEvents.all(ownerId, proposalRow.local_date) as ReviewEventContextRow[]).map(
        (event) => ({
          id: event.id,
          startLocalTime: event.start_local_time,
          endLocalTime: event.end_local_time,
          isHard: event.is_hard === 1,
        }),
      );
      const timeRequests = (
        readReviewTimeRequests.all(ownerId, proposalRow.local_date) as ReviewTimeRequestContextRow[]
      ).map((request) => ({
        id: request.id,
        version: request.version,
        source: request.source,
        title: request.title,
        targetDate: request.target_date,
        durationMinutes: request.duration_minutes,
        priority: request.priority,
        earliestStartLocalTime: request.earliest_start_local_time,
        latestEndLocalTime: request.latest_end_local_time,
        isFixed: request.is_fixed === 1,
      }));

      return {
        review: toDailyPlanReview(
          proposalRow,
          findProposalDecisions.all(proposalId, ownerId) as ProposalDecisionRow[],
        ),
        contextManifest: toDailyPlanRun(runRow).contextManifest,
        scheduleVersion: scheduleVersion.version,
        events,
        timeRequests,
      };
    },

    commitReviewDecisions,

    completeWithProposal,

    failRun,
  };
}
