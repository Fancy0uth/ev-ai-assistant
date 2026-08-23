import {
  APP_VERSION,
  dailyPlanPreflightSchema,
  dailyPlanReviewSchema,
  dailyPlanProposalSchema,
  dailyPlanRunSchema,
  type DailyPlanContextManifest,
  type DailyPlanDecisionInput,
  type DailyPlanDecisionRecord,
  type DailyPlanFailureCode,
  type DailyPlanPreflight,
  type DailyPlanPreflightItem,
  type DailyPlanProposalItem,
  type DailyPlanProposal,
  type DailyPlanReview,
  type DailyPlanRun,
  type DailyPlanTrigger,
  type Event,
  type LocalTime,
  type TimeRequestLifecycleStatus,
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
  title?: string;
  version: number;
  source: TimeRequestSource;
  targetDate: string;
  durationMinutes: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  earliestStartLocalTime: LocalTime | null;
  latestEndLocalTime: LocalTime | null;
  isFixed: boolean;
  lifecycleStatus: TimeRequestLifecycleStatus;
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

export interface NewDailyPlanPreflight {
  id: string;
  runId: string;
  ownerId: string;
  localDate: string;
  baseScheduleVersion: number;
  items: DailyPlanPreflightItem[];
  createdAt: string;
}

export type DailyPlanPreflightApprovalResult =
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'not_approvable' }
  | { kind: 'stale'; preflight: DailyPlanPreflight }
  | { kind: 'approved'; preflight: DailyPlanPreflight };

export type DailyPlanPreflightClaimResult =
  | { kind: 'not_found' }
  | { kind: 'version_conflict' }
  | { kind: 'not_approved' }
  | { kind: 'stale'; preflight: DailyPlanPreflight }
  | {
      kind: 'claimed';
      preflight: DailyPlanPreflight;
      run: DailyPlanRun;
      context: DailyPlanningReadContext;
    };

export type DailyPlanPreflightCompletionResult =
  | { kind: 'completed'; proposal: DailyPlanProposal }
  | { kind: 'stale' };

export interface DailyPlanProviderExecutionLease {
  leaseToken: string;
  leaseExpiresAt: string;
  deadlineAt: string;
  attemptCount: number;
  idempotencyRecordId: string | null;
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

export type DailyPlanReviewDecisionCommitResult =
  | { kind: 'committed'; review: DailyPlanReview }
  | { kind: 'stale'; review: DailyPlanReview };

export interface DailyPlanRunRepository {
  readContext(ownerId: string, localDate: string): DailyPlanningReadContext;
  readScheduleVersion(ownerId: string): { version: number };
  createContextReady(input: NewContextReadyDailyPlanRun): DailyPlanRun;
  createContextReadyPreflight(input: {
    run: NewContextReadyDailyPlanRun;
    preflight: NewDailyPlanPreflight;
  }): { run: DailyPlanRun; preflight: DailyPlanPreflight };
  getPreflight(ownerId: string, preflightId: string): DailyPlanPreflight | undefined;
  approvePreflight(input: {
    ownerId: string;
    preflightId: string;
    expectedVersion: number;
    items: DailyPlanPreflightItem[];
    updatedAt: string;
  }): DailyPlanPreflightApprovalResult;
  claimApprovedPreflight(input: {
    ownerId: string;
    preflightId: string;
    expectedVersion: number;
    claimedAt: string;
    execution: DailyPlanProviderExecutionLease;
  }): DailyPlanPreflightClaimResult;
  recoverClaimedPreflight(input: {
    ownerId: string;
    preflightId: string;
    expectedVersion: number;
    claimedAt: string;
    execution: DailyPlanProviderExecutionLease;
  }): DailyPlanPreflightClaimResult;
  completeClaimedPreflight(input: {
    ownerId: string;
    preflightId: string;
    expectedVersion: number;
    proposal: DailyPlanProposal;
    completedAt: string;
    leaseToken?: string;
  }): DailyPlanProposal;
  commitClaimedPreflight(input: {
    ownerId: string;
    preflightId: string;
    expectedVersion: number;
    proposal: DailyPlanProposal;
    completedAt: string;
    leaseToken?: string;
  }): DailyPlanPreflightCompletionResult;
  failClaimedPreflight(input: {
    ownerId: string;
    preflightId: string;
    expectedVersion: number;
    code: DailyPlanFailureCode;
    completedAt: string;
    leaseToken?: string;
    terminalReason?: string;
  }): DailyPlanPreflight;
  getRun(ownerId: string, runId: string): DailyPlanRun | undefined;
  findLatestRunForDate(ownerId: string, localDate: string): DailyPlanRun | undefined;
  markRunGenerating(ownerId: string, runId: string): DailyPlanRun;
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
  ): DailyPlanReviewDecisionCommitResult;
  completeWithProposal(
    ownerId: string,
    runId: string,
    baseScheduleVersion: number,
    proposal: DailyPlanProposal,
  ): DailyPlanProposal;
  failRun(ownerId: string, runId: string, code: DailyPlanFailureCode): DailyPlanRun;
}

export class DailyPlanBaseVersionStaleError extends Error {
  constructor(readonly executionFinalized = false) {
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
  title: string;
  version: number;
  source: TimeRequestSource;
  target_date: string;
  duration_minutes: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  earliest_start_local_time: LocalTime | null;
  latest_end_local_time: LocalTime | null;
  is_fixed: number;
  lifecycle_status: TimeRequestLifecycleStatus;
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
  attempt_count: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  deadline_at: string | null;
  terminal_reason: string | null;
  app_version: string | null;
  idempotency_record_id: string | null;
}

interface DailyPlanPreflightRow {
  id: string;
  run_id: string;
  contract_version: 'DAILY_PLAN_PREFLIGHT_V1';
  local_date: string;
  status: DailyPlanPreflight['status'];
  base_schedule_version: number;
  items_json: string;
  version: number;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  claimed_at: string | null;
  consumed_at: string | null;
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
    attemptCount: row.attempt_count,
    leaseExpiresAt: row.lease_expires_at,
    deadlineAt: row.deadline_at,
    terminalReason: row.terminal_reason,
    appVersion: row.app_version,
    idempotencyRecordId: row.idempotency_record_id,
  });
}

function toDailyPlanPreflight(row: DailyPlanPreflightRow): DailyPlanPreflight {
  return dailyPlanPreflightSchema.parse({
    id: row.id,
    runId: row.run_id,
    contractVersion: row.contract_version,
    localDate: row.local_date,
    status: row.status,
    baseScheduleVersion: row.base_schedule_version,
    items: JSON.parse(row.items_json) as unknown,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    claimedAt: row.claimed_at,
    consumedAt: row.consumed_at,
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
    `select id, title, version, source, target_date, duration_minutes, priority,
            earliest_start_local_time, latest_end_local_time, is_fixed, lifecycle_status
     from time_requests as request
     where request.owner_id = ? and request.target_date = ? and request.lifecycle_status = 'ACTIVE'
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
            proposal_id, failure_code, created_at, completed_at, attempt_count, lease_token,
            lease_expires_at, deadline_at, terminal_reason, app_version, idempotency_record_id
     from daily_plan_runs
     where id = ? and owner_id = ?`,
  );
  const findPreflight = database.prepare(
    `select id, run_id, contract_version, local_date, status, base_schedule_version, items_json,
            version, created_at, updated_at, approved_at, claimed_at, consumed_at
     from daily_plan_preflights
     where id = ? and owner_id = ?`,
  );
  const insertContextReadyRun = database.prepare(
    `insert into daily_plan_runs (
       id, owner_id, contract_version, local_date, trigger, status, context_manifest_json,
       proposal_id, failure_code, created_at, completed_at, attempt_count, lease_token,
       lease_expires_at, deadline_at, terminal_reason, app_version, idempotency_record_id
     ) values (?, ?, 'DAILY_PLAN_V1', ?, ?, 'CONTEXT_READY', ?, null, null, ?, null,
       0, null, null, null, null, ?, null)`,
  );
  const insertPreflight = database.prepare(
    `insert into daily_plan_preflights (
       id, owner_id, run_id, contract_version, local_date, status, base_schedule_version,
       items_json, version, created_at, updated_at, approved_at, claimed_at, consumed_at
     ) values (?, ?, ?, 'DAILY_PLAN_PREFLIGHT_V1', ?, 'AWAITING_APPROVAL', ?, ?, 1, ?, ?, null, null, null)`,
  );
  const approvePreflight = database.prepare(
    `update daily_plan_preflights
     set status = 'APPROVED', items_json = ?, version = version + 1, updated_at = ?, approved_at = ?
     where id = ? and owner_id = ? and version = ? and status = 'AWAITING_APPROVAL'`,
  );
  const claimPreflight = database.prepare(
    `update daily_plan_preflights
     set status = 'CLAIMED', version = version + 1, updated_at = ?, claimed_at = ?
     where id = ? and owner_id = ? and version = ? and status = 'APPROVED'`,
  );
  const recoverPreflight = database.prepare(
    `update daily_plan_preflights
     set version = version + 1, updated_at = ?, claimed_at = ?
     where id = ? and owner_id = ? and version = ? and status = 'CLAIMED'`,
  );
  const consumePreflight = database.prepare(
    `update daily_plan_preflights
     set status = 'CONSUMED', version = version + 1, updated_at = ?, consumed_at = ?
     where id = ? and owner_id = ? and version = ? and status = 'CLAIMED'`,
  );
  const stalePreflight = database.prepare(
    `update daily_plan_preflights
     set status = 'STALE', version = version + 1, updated_at = ?
     where id = ? and owner_id = ? and version = ? and status in ('AWAITING_APPROVAL', 'APPROVED', 'CLAIMED')`,
  );
  const findLatestRunForDate = database.prepare(
    `select id, contract_version, local_date, trigger, status, context_manifest_json,
            proposal_id, failure_code, created_at, completed_at, attempt_count, lease_token,
            lease_expires_at, deadline_at, terminal_reason, app_version, idempotency_record_id
     from daily_plan_runs
     where owner_id = ? and local_date = ?
     order by created_at desc, id asc
     limit 1`,
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
            earliest_start_local_time, latest_end_local_time, is_fixed, lifecycle_status
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

  function readContextSnapshot(ownerId: string, localDate: string): DailyPlanningReadContext {
    const events = (readEvents.all(ownerId, localDate) as EventContextRow[]).map((row) => ({
      startLocalTime: row.start_local_time,
      endLocalTime: row.end_local_time,
      isHard: row.is_hard === 1,
    }));
    const timeRequests = (readTimeRequests.all(ownerId, localDate) as TimeRequestContextRow[]).map(
      (row) => ({
        id: row.id,
        title: row.title,
        version: row.version,
        source: row.source,
        targetDate: row.target_date,
        durationMinutes: row.duration_minutes,
        priority: row.priority,
        earliestStartLocalTime: row.earliest_start_local_time,
        latestEndLocalTime: row.latest_end_local_time,
        isFixed: row.is_fixed === 1,
        lifecycleStatus: row.lifecycle_status,
      }),
    );
    const latestRecovery = readLatestRecovery.get(ownerId, localDate) as RecoveryContextRow | undefined;
    return {
      events,
      timeRequests,
      latestRecovery: latestRecovery ? { value: latestRecovery.value } : undefined,
    };
  }

  function timestampAtLeast(timestamp: string, lowerBound: string): string {
    return timestamp >= lowerBound ? timestamp : lowerBound;
  }

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
     set status = 'SUCCEEDED', proposal_id = ?, failure_code = null, completed_at = ?,
         lease_token = null, lease_expires_at = null, terminal_reason = null
     where id = ? and owner_id = ? and status in ('CONTEXT_READY', 'GENERATING')
       and (? is null or lease_token = ?)`,
  );
  const failContextReadyRun = database.prepare(
    `update daily_plan_runs
     set status = 'FAILED', proposal_id = null, failure_code = ?, completed_at = ?,
         lease_token = null, lease_expires_at = null, terminal_reason = ?
     where id = ? and owner_id = ? and status in ('CONTEXT_READY', 'GENERATING')
       and (? is null or lease_token = ?)`,
  );
  const claimGeneratingRun = database.prepare(
    `update daily_plan_runs
     set status = 'GENERATING', attempt_count = ?, lease_token = ?, lease_expires_at = ?,
         deadline_at = ?, terminal_reason = null, app_version = ?, idempotency_record_id = ?
     where id = ? and owner_id = ? and status = 'CONTEXT_READY'`,
  );
  const recoverGeneratingRun = database.prepare(
    `update daily_plan_runs
     set attempt_count = ?, lease_token = ?, lease_expires_at = ?, deadline_at = ?,
         terminal_reason = null, app_version = ?, idempotency_record_id = ?
     where id = ? and owner_id = ? and status = 'GENERATING' and attempt_count = 1
       and lease_expires_at <= ?`,
  );
  const markGeneratingRun = database.prepare(
    `update daily_plan_runs
     set status = 'GENERATING'
     where id = ? and owner_id = ? and status = 'CONTEXT_READY'`,
  );
  const failActiveRun = database.prepare(
    `update daily_plan_runs
     set status = 'FAILED', proposal_id = null, failure_code = ?, completed_at = ?
     where id = ? and owner_id = ? and status in ('CREATED', 'CONTEXT_READY', 'GENERATING')`,
  );

  const createContextReadyPreflightTransaction = database.transaction(
    (input: { run: NewContextReadyDailyPlanRun; preflight: NewDailyPlanPreflight }) => {
      insertContextReadyRun.run(
        input.run.id,
        input.run.ownerId,
        input.run.localDate,
        input.run.trigger,
        JSON.stringify(input.run.contextManifest),
        input.run.createdAt,
        APP_VERSION,
      );
      insertPreflight.run(
        input.preflight.id,
        input.preflight.ownerId,
        input.preflight.runId,
        input.preflight.localDate,
        input.preflight.baseScheduleVersion,
        JSON.stringify(input.preflight.items),
        input.preflight.createdAt,
        input.preflight.createdAt,
      );

      const run = findRun.get(input.run.id, input.run.ownerId) as DailyPlanRunRow | undefined;
      const preflight = findPreflight.get(input.preflight.id, input.preflight.ownerId) as
        | DailyPlanPreflightRow
        | undefined;
      if (!run || !preflight) {
        throw new DailyPlanRunStateConflictError();
      }
      return { run: toDailyPlanRun(run), preflight: toDailyPlanPreflight(preflight) };
    },
  );

  const approvePreflightTransaction = database.transaction(
    (input: {
      ownerId: string;
      preflightId: string;
      expectedVersion: number;
      items: DailyPlanPreflightItem[];
      updatedAt: string;
    }): DailyPlanPreflightApprovalResult => {
      const row = findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow | undefined;
      if (!row) return { kind: 'not_found' };
      const preflight = toDailyPlanPreflight(row);
      if (preflight.version !== input.expectedVersion) return { kind: 'version_conflict' };
      if (preflight.status !== 'AWAITING_APPROVAL') return { kind: 'not_approvable' };

      const scheduleVersion = readScheduleVersion.get(input.ownerId) as ScheduleVersionRow | undefined;
      if (!scheduleVersion || scheduleVersion.version !== preflight.baseScheduleVersion) {
        const staleAt = timestampAtLeast(input.updatedAt, preflight.createdAt);
        const stale = stalePreflight.run(
          staleAt,
          input.preflightId,
          input.ownerId,
          input.expectedVersion,
        );
        const run = findRun.get(preflight.runId, input.ownerId) as DailyPlanRunRow | undefined;
        if (!run || stale.changes !== 1 || failContextReadyRun.run(
          'DAILY_PLAN_BASE_VERSION_STALE',
          timestampAtLeast(staleAt, run.created_at),
          'DAILY_PLAN_BASE_VERSION_STALE',
          preflight.runId,
          input.ownerId,
          null,
          null,
        ).changes !== 1) {
          throw new DailyPlanRunStateConflictError();
        }
        return {
          kind: 'stale',
          preflight: toDailyPlanPreflight(
            findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow,
          ),
        };
      }

      const approvedAt = timestampAtLeast(input.updatedAt, preflight.createdAt);
      if (
        approvePreflight.run(
          JSON.stringify(input.items),
          approvedAt,
          approvedAt,
          input.preflightId,
          input.ownerId,
          input.expectedVersion,
        ).changes !== 1
      ) {
        throw new DailyPlanRunStateConflictError();
      }
      return {
        kind: 'approved',
        preflight: toDailyPlanPreflight(
          findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow,
        ),
      };
    },
  );

  const claimApprovedPreflightTransaction = database.transaction(
    (input: {
      ownerId: string;
      preflightId: string;
      expectedVersion: number;
      claimedAt: string;
      execution: DailyPlanProviderExecutionLease;
    }): DailyPlanPreflightClaimResult => {
      const row = findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow | undefined;
      if (!row) return { kind: 'not_found' };
      const preflight = toDailyPlanPreflight(row);
      if (preflight.version !== input.expectedVersion) return { kind: 'version_conflict' };
      if (preflight.status !== 'APPROVED') return { kind: 'not_approved' };
      const run = findRun.get(preflight.runId, input.ownerId) as DailyPlanRunRow | undefined;
      if (!run || run.status !== 'CONTEXT_READY') throw new DailyPlanRunStateConflictError();

      const scheduleVersion = readScheduleVersion.get(input.ownerId) as ScheduleVersionRow | undefined;
      if (!scheduleVersion || scheduleVersion.version !== preflight.baseScheduleVersion) {
        const staleAt = timestampAtLeast(input.claimedAt, preflight.approvedAt ?? preflight.createdAt);
        if (
          stalePreflight.run(
            staleAt,
            input.preflightId,
            input.ownerId,
            input.expectedVersion,
          ).changes !== 1 ||
          failContextReadyRun.run(
            'DAILY_PLAN_BASE_VERSION_STALE',
            timestampAtLeast(staleAt, run.created_at),
            'DAILY_PLAN_BASE_VERSION_STALE',
            preflight.runId,
            input.ownerId,
            null,
            null,
          ).changes !== 1
        ) {
          throw new DailyPlanRunStateConflictError();
        }
        return {
          kind: 'stale',
          preflight: toDailyPlanPreflight(
            findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow,
          ),
        };
      }

      const context = readContextSnapshot(input.ownerId, preflight.localDate);
      const claimedAt = timestampAtLeast(input.claimedAt, preflight.approvedAt ?? preflight.createdAt);
      if (
        claimPreflight.run(
          claimedAt,
          claimedAt,
          input.preflightId,
          input.ownerId,
          input.expectedVersion,
        ).changes !== 1 ||
        claimGeneratingRun.run(
          input.execution.attemptCount,
          input.execution.leaseToken,
          input.execution.leaseExpiresAt,
          input.execution.deadlineAt,
          APP_VERSION,
          input.execution.idempotencyRecordId,
          preflight.runId,
          input.ownerId,
        ).changes !== 1
      ) {
        throw new DailyPlanRunStateConflictError();
      }
      return {
        kind: 'claimed',
        preflight: toDailyPlanPreflight(
          findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow,
        ),
        run: toDailyPlanRun(findRun.get(preflight.runId, input.ownerId) as DailyPlanRunRow),
        context,
      };
    },
  );

  const recoverClaimedPreflightTransaction = database.transaction(
    (input: {
      ownerId: string;
      preflightId: string;
      expectedVersion: number;
      claimedAt: string;
      execution: DailyPlanProviderExecutionLease;
    }): DailyPlanPreflightClaimResult => {
      const row = findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow | undefined;
      if (!row) return { kind: 'not_found' };
      const preflight = toDailyPlanPreflight(row);
      if (preflight.version !== input.expectedVersion) return { kind: 'version_conflict' };
      if (preflight.status !== 'CLAIMED') return { kind: 'not_approved' };
      const run = findRun.get(preflight.runId, input.ownerId) as DailyPlanRunRow | undefined;
      if (!run || run.status !== 'GENERATING') throw new DailyPlanRunStateConflictError();
      const context = readContextSnapshot(input.ownerId, preflight.localDate);
      const claimedAt = timestampAtLeast(input.claimedAt, preflight.claimedAt ?? preflight.createdAt);
      if (
        recoverPreflight.run(
          claimedAt,
          claimedAt,
          input.preflightId,
          input.ownerId,
          input.expectedVersion,
        ).changes !== 1 ||
        recoverGeneratingRun.run(
          input.execution.attemptCount,
          input.execution.leaseToken,
          input.execution.leaseExpiresAt,
          input.execution.deadlineAt,
          APP_VERSION,
          input.execution.idempotencyRecordId,
          preflight.runId,
          input.ownerId,
          input.claimedAt,
        ).changes !== 1
      ) {
        throw new DailyPlanRunStateConflictError();
      }
      return {
        kind: 'claimed',
        preflight: toDailyPlanPreflight(
          findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow,
        ),
        run: toDailyPlanRun(findRun.get(preflight.runId, input.ownerId) as DailyPlanRunRow),
        context,
      };
    },
  );

  const completeClaimedPreflightTransaction = database.transaction(
    (input: {
      ownerId: string;
      preflightId: string;
      expectedVersion: number;
      proposal: DailyPlanProposal;
      completedAt: string;
      leaseToken?: string;
    }): { proposal: DailyPlanProposal } | { stale: true } => {
      const row = findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow | undefined;
      if (!row) throw new DailyPlanRunStateConflictError();
      const preflight = toDailyPlanPreflight(row);
      const run = findRun.get(preflight.runId, input.ownerId) as DailyPlanRunRow | undefined;
      if (
        preflight.version !== input.expectedVersion ||
        preflight.status !== 'CLAIMED' ||
        !run ||
        run.status !== 'GENERATING' ||
        input.proposal.status !== 'PENDING_REVIEW'
      ) {
        throw new DailyPlanRunStateConflictError();
      }
      const completedAt = timestampAtLeast(input.completedAt, preflight.claimedAt ?? preflight.createdAt);
      const scheduleVersion = readScheduleVersion.get(input.ownerId) as ScheduleVersionRow | undefined;
      if (!scheduleVersion || scheduleVersion.version !== preflight.baseScheduleVersion) {
        if (
          stalePreflight.run(
            completedAt,
            input.preflightId,
            input.ownerId,
            input.expectedVersion,
          ).changes !== 1 ||
          failContextReadyRun.run(
            'DAILY_PLAN_BASE_VERSION_STALE',
            timestampAtLeast(completedAt, run.created_at),
            'DAILY_PLAN_BASE_VERSION_STALE',
            preflight.runId,
            input.ownerId,
            input.leaseToken ?? null,
            input.leaseToken ?? null,
          ).changes !== 1
        ) {
          throw new DailyPlanRunStateConflictError();
        }
        return { stale: true };
      }
      insertProposal.run(
        input.proposal.id,
        input.ownerId,
        preflight.runId,
        input.proposal.localDate,
        preflight.baseScheduleVersion,
        input.proposal.summary,
        JSON.stringify(input.proposal.items),
        input.proposal.version,
        input.proposal.createdAt,
        input.proposal.updatedAt,
      );
      if (
        completeRun.run(
          input.proposal.id,
          timestampAtLeast(completedAt, run.created_at),
          preflight.runId,
          input.ownerId,
          input.leaseToken ?? null,
          input.leaseToken ?? null,
        ).changes !== 1 ||
        consumePreflight.run(
          completedAt,
          completedAt,
          input.preflightId,
          input.ownerId,
          input.expectedVersion,
        ).changes !== 1
      ) {
        throw new DailyPlanRunStateConflictError();
      }
      return {
        proposal: toDailyPlanProposal(
          findProposalByRun.get(preflight.runId, input.ownerId) as DailyPlanProposalRow,
        ),
      };
    },
  );

  const failClaimedPreflightTransaction = database.transaction(
    (input: {
      ownerId: string;
      preflightId: string;
      expectedVersion: number;
      code: DailyPlanFailureCode;
      completedAt: string;
      leaseToken?: string;
      terminalReason?: string;
    }): DailyPlanPreflight => {
      const row = findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow | undefined;
      if (!row) throw new DailyPlanRunStateConflictError();
      const preflight = toDailyPlanPreflight(row);
      const run = findRun.get(preflight.runId, input.ownerId) as DailyPlanRunRow | undefined;
      if (
        preflight.version !== input.expectedVersion ||
        preflight.status !== 'CLAIMED' ||
        !run ||
        run.status !== 'GENERATING'
      ) {
        throw new DailyPlanRunStateConflictError();
      }
      const completedAt = timestampAtLeast(input.completedAt, preflight.claimedAt ?? preflight.createdAt);
      if (
        failContextReadyRun.run(
          input.code,
          timestampAtLeast(completedAt, run.created_at),
          input.terminalReason ?? input.code,
          preflight.runId,
          input.ownerId,
          input.leaseToken ?? null,
          input.leaseToken ?? null,
        ).changes !== 1 ||
        consumePreflight.run(
          completedAt,
          completedAt,
          input.preflightId,
          input.ownerId,
          input.expectedVersion,
        ).changes !== 1
      ) {
        throw new DailyPlanRunStateConflictError();
      }
      return toDailyPlanPreflight(
        findPreflight.get(input.preflightId, input.ownerId) as DailyPlanPreflightRow,
      );
    },
  );

  const completeWithProposalTransaction = database.transaction(
    (
      ownerId: string,
      runId: string,
      baseScheduleVersion: number,
      proposal: DailyPlanProposal,
    ): { proposal: DailyPlanProposal } | { stale: true } => {
      const run = findRun.get(runId, ownerId) as DailyPlanRunRow | undefined;
      if (!run || !['CONTEXT_READY', 'GENERATING'].includes(run.status)) {
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
          'DAILY_PLAN_BASE_VERSION_STALE',
          runId,
          ownerId,
          null,
          null,
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
      completeRun.run(proposal.id, completionTimestamp(run.created_at), runId, ownerId, null, null);

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
  ): DailyPlanReviewDecisionCommitResult {
    const result = commitReviewDecisionsTransaction(ownerId, proposalId, input);
    if ('stale' in result) {
      return { kind: 'stale', review: result.stale };
    }
    return { kind: 'committed', review: result.review };
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
      return readContextSnapshot(ownerId, localDate);
    },

    readScheduleVersion(ownerId) {
      const row = readScheduleVersion.get(ownerId) as ScheduleVersionRow | undefined;
      if (!row) {
        throw new Error('daily planning schedule version is missing');
      }
      return { version: row.version };
    },

    createContextReady(input) {
      insertContextReadyRun.run(
        input.id,
        input.ownerId,
        input.localDate,
        input.trigger,
        JSON.stringify(input.contextManifest),
        input.createdAt,
        APP_VERSION,
      );

      return toDailyPlanRun(
        findRun.get(input.id, input.ownerId) as DailyPlanRunRow,
      );
    },

    createContextReadyPreflight(input) {
      return createContextReadyPreflightTransaction(input);
    },

    getPreflight(ownerId, preflightId) {
      const row = findPreflight.get(preflightId, ownerId) as DailyPlanPreflightRow | undefined;
      return row ? toDailyPlanPreflight(row) : undefined;
    },

    approvePreflight(input) {
      return approvePreflightTransaction(input);
    },

    claimApprovedPreflight(input) {
      return claimApprovedPreflightTransaction(input);
    },

    recoverClaimedPreflight(input) {
      return recoverClaimedPreflightTransaction(input);
    },

    completeClaimedPreflight(input) {
      const result = completeClaimedPreflightTransaction(input);
      if ('stale' in result) {
        throw new DailyPlanBaseVersionStaleError();
      }
      return result.proposal;
    },

    commitClaimedPreflight(input) {
      const result = completeClaimedPreflightTransaction(input);
      return 'stale' in result
        ? { kind: 'stale' }
        : { kind: 'completed', proposal: result.proposal };
    },

    failClaimedPreflight(input) {
      return failClaimedPreflightTransaction(input);
    },

    getRun(ownerId, runId) {
      const row = findRun.get(runId, ownerId) as DailyPlanRunRow | undefined;
      return row ? toDailyPlanRun(row) : undefined;
    },

    findLatestRunForDate(ownerId, localDate) {
      const row = findLatestRunForDate.get(ownerId, localDate) as DailyPlanRunRow | undefined;
      return row ? toDailyPlanRun(row) : undefined;
    },

    markRunGenerating(ownerId, runId) {
      const result = markGeneratingRun.run(runId, ownerId);
      if (result.changes !== 1) {
        throw new DailyPlanRunStateConflictError();
      }
      return toDailyPlanRun(findRun.get(runId, ownerId) as DailyPlanRunRow);
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
        lifecycleStatus: request.lifecycle_status,
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
