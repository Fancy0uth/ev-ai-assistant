import type {
  DailyPlanReviewExplanation,
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
  getExplanation(ownerId: string, proposalId: string): DailyPlanReviewExplanation;
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

function overlaps(
  first: { startLocalTime: LocalTime; endLocalTime: LocalTime },
  second: { startLocalTime: LocalTime; endLocalTime: LocalTime },
): boolean {
  return (
    toMinutes(first.startLocalTime) < toMinutes(second.endLocalTime) &&
    toMinutes(first.endLocalTime) > toMinutes(second.startLocalTime)
  );
}

function verificationFor(
  execution: DailyPlanReviewExecutionContext,
  item: DailyPlanProposalItem,
): DailyPlanReviewExplanation['items'][number]['verification'] {
  const request = execution.timeRequests.find((candidate) => candidate.id === item.timeRequestId);
  if (!request) return { status: 'TIME_REQUEST_MISSING', conflicts: [] };
  if (request.version !== item.timeRequestVersion) {
    return { status: 'TIME_REQUEST_VERSION_CHANGED', conflicts: [] };
  }

  if (item.operation === 'SCHEDULE_TIME_REQUEST') {
    const placement = {
      startLocalTime: item.startLocalTime,
      endLocalTime: item.endLocalTime,
    };
    if (toMinutes(placement.endLocalTime) - toMinutes(placement.startLocalTime) !== request.durationMinutes) {
      return { status: 'DURATION_MISMATCH', conflicts: [] };
    }
    if (
      (request.earliestStartLocalTime !== null &&
        toMinutes(placement.startLocalTime) < toMinutes(request.earliestStartLocalTime)) ||
      (request.latestEndLocalTime !== null &&
        toMinutes(placement.endLocalTime) > toMinutes(request.latestEndLocalTime))
    ) {
      return { status: 'OUTSIDE_AVAILABILITY', conflicts: [] };
    }

    const ownScheduledEventIds = new Set(
      execution.review.decisions
        .filter((decision) => decision.itemId === item.id && decision.scheduledEventId !== null)
        .map((decision) => decision.scheduledEventId),
    );
    const conflicts = execution.events
      .filter((event) => !ownScheduledEventIds.has(event.id) && overlaps(placement, event))
      .map((event) => ({
        eventId: event.id,
        kind: event.isHard ? ('HARD_EVENT' as const) : ('CONFIRMED_EVENT' as const),
        startLocalTime: event.startLocalTime,
        endLocalTime: event.endLocalTime,
      }));
    if (conflicts.length > 0) {
      return {
        status: conflicts.some((conflict) => conflict.kind === 'HARD_EVENT')
          ? 'HARD_EVENT_CONFLICT'
          : 'CONFIRMED_EVENT_CONFLICT',
        conflicts,
      };
    }
  }

  return {
    status:
      execution.scheduleVersion === execution.review.proposal.baseScheduleVersion
        ? 'CURRENT'
        : 'SCHEDULE_VERSION_CHANGED',
    conflicts: [],
  };
}

function explanationFor(execution: DailyPlanReviewExecutionContext): DailyPlanReviewExplanation {
  const requestsById = new Map(execution.timeRequests.map((request) => [request.id, request]));
  const { proposal } = execution.review;

  return {
    proposalId: proposal.id,
    localDate: proposal.localDate,
    baseScheduleVersion: proposal.baseScheduleVersion,
    currentScheduleVersion: execution.scheduleVersion,
    contextManifest: execution.contextManifest,
    items: proposal.items.map((item) => {
      const request = requestsById.get(item.timeRequestId);
      return {
        itemId: item.id,
        ordinal: item.ordinal,
        timeRequest: request
          ? {
              id: request.id,
              title: request.title,
              source: request.source,
              durationMinutes: request.durationMinutes,
              priority: request.priority,
              earliestStartLocalTime: request.earliestStartLocalTime,
              latestEndLocalTime: request.latestEndLocalTime,
              isFixed: request.isFixed,
              version: request.version,
            }
          : null,
        verification: verificationFor(execution, item),
      };
    }),
  };
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

    getExplanation(ownerId, proposalId) {
      return explanationFor(getExecutionContext(ownerId, proposalId));
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
