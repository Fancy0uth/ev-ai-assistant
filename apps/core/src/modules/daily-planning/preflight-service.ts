import {
  type DailyPlanPreflight,
  type DailyPlanPreflightApproveInput,
  type DailyPlanRun,
  type DailyPlanTrigger,
} from '@ev/contracts';
import {
  buildApprovedDailyPlanningPacket,
  type ApprovedDailyPlanningPacket,
  type DailyPlanningContextService,
} from './context-service';
import {
  DailyPlanBaseVersionStaleError,
  type DailyPlanRunRepository,
} from './repository';
import { PROVIDER_POLICY } from '../providers/provider-policy';

type DailyPlanPreflightApprovalItem = DailyPlanPreflightApproveInput['items'][number];

export type DailyPlanPreflightErrorCode =
  | 'DAILY_PLAN_PREFLIGHT_NOT_FOUND'
  | 'DAILY_PLAN_PREFLIGHT_VERSION_CONFLICT'
  | 'DAILY_PLAN_PREFLIGHT_NOT_APPROVABLE'
  | 'DAILY_PLAN_PREFLIGHT_NOT_APPROVED'
  | 'DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH';

export class DailyPlanPreflightError extends Error {
  constructor(readonly code: DailyPlanPreflightErrorCode) {
    super(code);
    this.name = 'DailyPlanPreflightError';
  }
}

export interface ClaimedDailyPlanPreflight {
  preflight: DailyPlanPreflight;
  run: DailyPlanRun;
  packet: ApprovedDailyPlanningPacket;
}

export interface DailyPlanPreflightService {
  prepare(ownerId: string, localDate: string, trigger?: DailyPlanTrigger): DailyPlanPreflight;
  approve(
    ownerId: string,
    preflightId: string,
    expectedVersion: number,
    edits: DailyPlanPreflightApprovalItem[],
  ): DailyPlanPreflight;
  claimApproved(
    ownerId: string,
    preflightId: string,
    expectedVersion: number,
  ): ClaimedDailyPlanPreflight;
}

export interface DailyPlanPreflightServiceDependencies {
  contextService: DailyPlanningContextService;
  repository: DailyPlanRunRepository;
  newId?: () => string;
  now?: () => Date;
}

function preflightErrorFor(result: 'not_found' | 'version_conflict' | 'not_approvable' | 'not_approved') {
  switch (result) {
    case 'not_found':
      return new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_NOT_FOUND');
    case 'version_conflict':
      return new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_VERSION_CONFLICT');
    case 'not_approvable':
      return new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_NOT_APPROVABLE');
    case 'not_approved':
      return new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_NOT_APPROVED');
  }
}

function approvedItems(
  preflight: DailyPlanPreflight,
  edits: DailyPlanPreflightApprovalItem[],
) {
  if (edits.length !== preflight.items.length) {
    throw new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH');
  }
  const editsByContextRef = new Map(edits.map((item) => [item.contextRef, item]));
  if (editsByContextRef.size !== edits.length) {
    throw new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH');
  }

  return preflight.items.map((item) => {
    const edit = editsByContextRef.get(item.contextRef);
    if (!edit) {
      throw new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH');
    }
    return {
      ...item,
      safeTitle: edit.safeTitle,
      domain: edit.domain,
      deadlineLocalDate: edit.deadlineLocalDate,
      included: edit.included,
    };
  });
}

export function createDailyPlanPreflightService(
  dependencies: DailyPlanPreflightServiceDependencies,
): DailyPlanPreflightService {
  const newId = dependencies.newId ?? crypto.randomUUID;
  const now = dependencies.now ?? (() => new Date());

  return {
    prepare(ownerId, localDate, trigger = 'MANUAL') {
      const draft = dependencies.contextService.prepareDraft(ownerId, localDate, trigger, now());
      if (draft.items.length > 24) {
        throw new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH');
      }
      return dependencies.repository.createContextReadyPreflight({
        run: draft.runInput,
        preflight: {
          id: newId(),
          runId: draft.runInput.id,
          ownerId,
          localDate,
          baseScheduleVersion: draft.packet.baseScheduleVersion,
          items: draft.items,
          createdAt: draft.runInput.createdAt,
        },
      }).preflight;
    },

    approve(ownerId, preflightId, expectedVersion, edits) {
      const current = dependencies.repository.getPreflight(ownerId, preflightId);
      if (!current) {
        throw new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_NOT_FOUND');
      }
      if (current.version !== expectedVersion) {
        throw new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_VERSION_CONFLICT');
      }
      if (current.status !== 'AWAITING_APPROVAL') {
        throw new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_NOT_APPROVABLE');
      }
      const result = dependencies.repository.approvePreflight({
        ownerId,
        preflightId,
        expectedVersion,
        items: approvedItems(current, edits),
        updatedAt: now().toISOString(),
      });
      if (result.kind === 'stale') {
        throw new DailyPlanBaseVersionStaleError();
      }
      if (result.kind !== 'approved') {
        throw preflightErrorFor(result.kind);
      }
      return result.preflight;
    },

    claimApproved(ownerId, preflightId, expectedVersion) {
      const result = dependencies.repository.claimApprovedPreflight({
        ownerId,
        preflightId,
        expectedVersion,
        claimedAt: now().toISOString(),
        execution: {
          leaseToken: newId(),
          leaseExpiresAt: new Date(now().getTime() + PROVIDER_POLICY.leaseMs).toISOString(),
          deadlineAt: new Date(now().getTime() + PROVIDER_POLICY.totalTimeoutMs).toISOString(),
          attemptCount: 1,
          idempotencyRecordId: null,
        },
      });
      if (result.kind === 'stale') {
        throw new DailyPlanBaseVersionStaleError();
      }
      if (result.kind !== 'claimed') {
        throw preflightErrorFor(result.kind);
      }

      try {
        return {
          preflight: result.preflight,
          run: result.run,
          packet: buildApprovedDailyPlanningPacket(
            result.context,
            result.preflight.items,
            result.preflight.baseScheduleVersion,
          ),
        };
      } catch (error) {
        dependencies.repository.failClaimedPreflight({
          ownerId,
          preflightId,
          expectedVersion: result.preflight.version,
          code: 'DAILY_PLAN_CONTEXT_INVALID',
          completedAt: now().toISOString(),
        });
        if (error instanceof DailyPlanPreflightError) {
          throw error;
        }
        throw new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH');
      }
    },
  };
}
