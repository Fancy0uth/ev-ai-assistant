import type {
  DailyPlanDecisionInput,
  DailyPlanProposalItem,
  DailyPlanReview,
  EventKind,
  LocalTime,
  TimeRequestSource,
} from '@ev/contracts';
import type {
  DailyPlanProposalList,
  DailyPlanProposalListQuery,
  DailyPlanRunRepository,
  DailyPlanReviewExecutionContext,
  PreparedDailyPlanReviewDecision,
} from './repository';
import { DailyPlanValidationError, validateDailyPlanPlacements } from './validator';

type ScheduledProposalItem = Extract<
  DailyPlanProposalItem,
  { operation: 'SCHEDULE_TIME_REQUEST' }
>;

interface DailyPlanDecisionBatchInput {
  expectedProposalVersion: number;
  decisions: DailyPlanDecisionInput[];
}

export interface DailyPlanReviewService {
  getReview(ownerId: string, proposalId: string): DailyPlanReview;
  listProposals(ownerId: string, query: DailyPlanProposalListQuery): DailyPlanProposalList;
  submitDecisions(
    ownerId: string,
    proposalId: string,
    input: DailyPlanDecisionBatchInput,
  ): DailyPlanReview;
}

export interface DailyPlanReviewServiceOptions {
  repository: DailyPlanRunRepository;
  newId?: () => string;
  now?: () => Date;
}

export class DailyPlanProposalNotFoundError extends Error {
  readonly code = 'DAILY_PLAN_PROPOSAL_NOT_FOUND';

  constructor() {
    super('DAILY_PLAN_PROPOSAL_NOT_FOUND');
    this.name = 'DailyPlanProposalNotFoundError';
  }
}

export class DailyPlanProposalVersionConflictError extends Error {
  readonly code = 'DAILY_PLAN_PROPOSAL_VERSION_CONFLICT';

  constructor(readonly review: DailyPlanReview) {
    super('DAILY_PLAN_PROPOSAL_VERSION_CONFLICT');
    this.name = 'DailyPlanProposalVersionConflictError';
  }
}

interface ScheduledDecision {
  itemId: string;
  startLocalTime: LocalTime;
  endLocalTime: LocalTime;
  kind: EventKind;
}

function eventKindFor(source: TimeRequestSource): EventKind {
  switch (source) {
    case 'PROJECT_AGENT':
      return 'WORK_BLOCK';
    case 'LEARNING_AGENT':
      return 'STUDY';
    case 'FITNESS_AGENT':
      return 'WORKOUT';
    case 'NUTRITION_AGENT':
    case 'SCHEDULE_COORDINATOR':
      return 'PERSONAL';
  }
}

function toMinutes(localTime: LocalTime): number {
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3, 5));
}

function hasTimeOverride(decision: DailyPlanDecisionInput): boolean {
  const input = decision as unknown as Record<string, unknown>;
  return input.startLocalTime !== undefined || input.endLocalTime !== undefined;
}

function invalid(message: string): never {
  throw new DailyPlanValidationError(message);
}

function isReviewable(execution: DailyPlanReviewExecutionContext): boolean {
  return ['PENDING_REVIEW', 'PARTIALLY_APPLIED'].includes(execution.review.proposal.status);
}

function validateDecisions(
  execution: DailyPlanReviewExecutionContext,
  input: DailyPlanDecisionBatchInput,
): ScheduledDecision[] {
  const { review } = execution;
  if (input.expectedProposalVersion !== review.proposal.version || !isReviewable(execution)) {
    throw new DailyPlanProposalVersionConflictError(review);
  }

  const itemsById = new Map(review.proposal.items.map((item) => [item.id, item]));
  const requestsById = new Map(execution.timeRequests.map((request) => [request.id, request]));
  const seenItemIds = new Set<string>();
  const scheduledDecisions: ScheduledDecision[] = [];

  for (const decision of input.decisions) {
    if (seenItemIds.has(decision.itemId)) {
      throw new DailyPlanProposalVersionConflictError(review);
    }
    seenItemIds.add(decision.itemId);

    const item = itemsById.get(decision.itemId);
    if (!item || item.status !== 'PENDING_REVIEW') {
      throw new DailyPlanProposalVersionConflictError(review);
    }

    const request = requestsById.get(item.timeRequestId);
    if (!request || request.version !== item.timeRequestVersion) {
      throw new DailyPlanProposalVersionConflictError(review);
    }

    if (decision.decision === 'REJECT') {
      if (hasTimeOverride(decision)) {
        invalid('rejected items cannot include a time override');
      }
      continue;
    }

    if (item.operation === 'MARK_TIME_REQUEST_UNSCHEDULABLE') {
      if (hasTimeOverride(decision)) {
        invalid('unschedulable items cannot include a time override');
      }
      continue;
    }

    const hasStartLocalTime = decision.startLocalTime !== undefined;
    const hasEndLocalTime = decision.endLocalTime !== undefined;
    if (hasStartLocalTime !== hasEndLocalTime) {
      invalid('scheduled item time overrides require both start and end times');
    }

    const scheduledItem = item as ScheduledProposalItem;
    scheduledDecisions.push({
      itemId: scheduledItem.id,
      startLocalTime: decision.startLocalTime ?? scheduledItem.startLocalTime,
      endLocalTime: decision.endLocalTime ?? scheduledItem.endLocalTime,
      kind: eventKindFor(request.source),
    });
  }

  return scheduledDecisions;
}

function validatePlacements(
  execution: DailyPlanReviewExecutionContext,
  scheduledDecisions: ScheduledDecision[],
): void {
  const itemsById = new Map(execution.review.proposal.items.map((item) => [item.id, item]));
  const requestsById = new Map(execution.timeRequests.map((request) => [request.id, request]));

  validateDailyPlanPlacements({
    placements: scheduledDecisions.map((decision) => {
      const item = itemsById.get(decision.itemId) as ScheduledProposalItem | undefined;
      const request = item ? requestsById.get(item.timeRequestId) : undefined;
      if (!item || !request) {
        return invalid('scheduled review item is no longer available');
      }
      return {
        timeRequestId: request.id,
        durationMinutes: request.durationMinutes,
        earliestStartLocalTime: request.earliestStartLocalTime,
        latestEndLocalTime: request.latestEndLocalTime,
        startLocalTime: decision.startLocalTime,
        endLocalTime: decision.endLocalTime,
      };
    }),
    occupiedIntervals: execution.events.map(({ startLocalTime, endLocalTime }) => ({
      startLocalTime,
      endLocalTime,
    })),
    existingPlannedMinutes: execution.events
      .filter((event) => !event.isHard)
      .reduce(
        (minutes, event) => minutes + toMinutes(event.endLocalTime) - toMinutes(event.startLocalTime),
        0,
      ),
  });
}

function preparedDecisions(
  input: DailyPlanDecisionBatchInput,
  scheduledDecisions: ScheduledDecision[],
  newId: () => string,
  now: string,
): PreparedDailyPlanReviewDecision[] {
  const scheduledByItemId = new Map(scheduledDecisions.map((decision) => [decision.itemId, decision]));

  return input.decisions.map((decision) => {
    const scheduled = scheduledByItemId.get(decision.itemId);
    return {
      id: newId(),
      input: decision,
      ...(scheduled
        ? {
            scheduledEvent: {
              id: newId(),
              kind: scheduled.kind,
              startLocalTime: scheduled.startLocalTime,
              endLocalTime: scheduled.endLocalTime,
              createdAt: now,
              updatedAt: now,
            },
          }
        : {}),
    };
  });
}

export function createDailyPlanReviewService(
  options: DailyPlanReviewServiceOptions,
): DailyPlanReviewService {
  const newId = options.newId ?? crypto.randomUUID;
  const now = options.now ?? (() => new Date());

  function getExecutionContext(ownerId: string, proposalId: string): DailyPlanReviewExecutionContext {
    const execution = options.repository.getReviewExecutionContext(ownerId, proposalId);
    if (!execution) {
      throw new DailyPlanProposalNotFoundError();
    }
    return execution;
  }

  return {
    getReview(ownerId, proposalId) {
      const review = options.repository.getReview(ownerId, proposalId);
      if (!review) {
        throw new DailyPlanProposalNotFoundError();
      }
      return review;
    },

    listProposals(ownerId, query) {
      return options.repository.listProposals(ownerId, query);
    },

    submitDecisions(ownerId, proposalId, input) {
      const execution = getExecutionContext(ownerId, proposalId);
      const scheduledDecisions = validateDecisions(execution, input);
      const updatedAt = now().toISOString();

      if (execution.scheduleVersion !== execution.review.proposal.baseScheduleVersion) {
        return options.repository.commitReviewDecisions(ownerId, proposalId, {
          expectedProposalVersion: input.expectedProposalVersion,
          decisions: preparedDecisions(input, [], newId, updatedAt),
          updatedAt,
        });
      }

      validatePlacements(execution, scheduledDecisions);

      return options.repository.commitReviewDecisions(ownerId, proposalId, {
        expectedProposalVersion: input.expectedProposalVersion,
        decisions: preparedDecisions(input, scheduledDecisions, newId, updatedAt),
        updatedAt,
      });
    },
  };
}
