import type { DailyPlanModelOutput, DailyPlanProposalItem, LocalTime } from '@ev/contracts';
import type { DailyPlanningPacket } from './context-service';

type ScheduledProposalItem = Extract<
  DailyPlanProposalItem,
  { operation: 'SCHEDULE_TIME_REQUEST' }
>;
type UnschedulableProposalItem = Extract<
  DailyPlanProposalItem,
  { operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE' }
>;

export type ValidatedDailyPlanItem =
  | Omit<ScheduledProposalItem, 'id'>
  | Omit<UnschedulableProposalItem, 'id'>;

export class DailyPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyPlanValidationError';
  }
}

interface ScheduledInterval {
  start: number;
  end: number;
}

export interface DailyPlanPlacement {
  timeRequestId: string;
  durationMinutes: number;
  earliestStartLocalTime: LocalTime | null;
  latestEndLocalTime: LocalTime | null;
  startLocalTime: LocalTime;
  endLocalTime: LocalTime;
}

export interface DailyPlanPlacementValidationInput {
  placements: DailyPlanPlacement[];
  occupiedIntervals: Array<{
    startLocalTime: LocalTime;
    endLocalTime: LocalTime;
  }>;
  existingPlannedMinutes?: number;
}

const earliestScheduleMinute = 5 * 60;
const latestScheduleMinute = 23 * 60;
const maximumScheduledMinutes = 16 * 60;

function toMinutes(localTime: LocalTime): number {
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3, 5));
}

function overlaps(first: ScheduledInterval, second: ScheduledInterval): boolean {
  return first.start < second.end && first.end > second.start;
}

function invalid(message: string): never {
  throw new DailyPlanValidationError(message);
}

export function validateDailyPlanPlacements(input: DailyPlanPlacementValidationInput): void {
  const consumedTimeRequestIds = new Set<string>();
  const occupiedIntervals = input.occupiedIntervals.map((interval) => ({
    start: toMinutes(interval.startLocalTime),
    end: toMinutes(interval.endLocalTime),
  }));
  const scheduledIntervals: ScheduledInterval[] = [];
  let scheduledMinutes = input.existingPlannedMinutes ?? 0;

  for (const placement of input.placements) {
    if (consumedTimeRequestIds.has(placement.timeRequestId)) {
      invalid('duplicate daily planning time request reference');
    }
    consumedTimeRequestIds.add(placement.timeRequestId);

    const interval = {
      start: toMinutes(placement.startLocalTime),
      end: toMinutes(placement.endLocalTime),
    };
    const durationMinutes = interval.end - interval.start;

    if (interval.start < earliestScheduleMinute || interval.end > latestScheduleMinute) {
      invalid('scheduled item is outside the supported daily planning window');
    }
    if (durationMinutes !== placement.durationMinutes) {
      invalid('scheduled item duration differs from its time request');
    }
    if (
      (placement.earliestStartLocalTime !== null &&
        interval.start < toMinutes(placement.earliestStartLocalTime)) ||
      (placement.latestEndLocalTime !== null &&
        interval.end > toMinutes(placement.latestEndLocalTime))
    ) {
      invalid('scheduled item is outside its availability window');
    }
    if (occupiedIntervals.some((occupied) => overlaps(interval, occupied))) {
      invalid('scheduled item overlaps an existing confirmed event');
    }
    if (scheduledIntervals.some((scheduled) => overlaps(interval, scheduled))) {
      invalid('scheduled proposal items overlap');
    }

    scheduledMinutes += durationMinutes;
    if (scheduledMinutes > maximumScheduledMinutes) {
      invalid('scheduled proposal items exceed the daily capacity limit');
    }
    scheduledIntervals.push(interval);
  }
}

export function validateDailyPlanOutput(
  packet: DailyPlanningPacket,
  output: DailyPlanModelOutput,
): ValidatedDailyPlanItem[] {
  const requestsByContextRef = new Map(
    packet.timeRequests.map((request) => [request.contextRef, request]),
  );
  const consumedContextRefs = new Set<string>();

  const items = output.actions.map((action, index): ValidatedDailyPlanItem => {
    const request = requestsByContextRef.get(action.contextRef);
    if (!request) {
      return invalid(`unknown daily planning context reference: ${action.contextRef}`);
    }
    if (consumedContextRefs.has(action.contextRef)) {
      return invalid(`duplicate daily planning context reference: ${action.contextRef}`);
    }
    consumedContextRefs.add(action.contextRef);

    if (action.operation === 'MARK_TIME_REQUEST_UNSCHEDULABLE') {
      return {
        ordinal: index + 1,
        status: 'PENDING_REVIEW',
        operation: action.operation,
        timeRequestId: request.timeRequestId,
        timeRequestVersion: request.timeRequestVersion,
        startLocalTime: null,
        endLocalTime: null,
        reasonCode: action.reasonCode,
        rationale: action.rationale,
      };
    }

    return {
      ordinal: index + 1,
      status: 'PENDING_REVIEW',
      operation: action.operation,
      timeRequestId: request.timeRequestId,
      timeRequestVersion: request.timeRequestVersion,
      startLocalTime: action.startLocalTime,
      endLocalTime: action.endLocalTime,
      reasonCode: null,
      rationale: action.rationale,
    };
  });

  validateDailyPlanPlacements({
    placements: items
      .filter(
        (item): item is Extract<ValidatedDailyPlanItem, { operation: 'SCHEDULE_TIME_REQUEST' }> =>
          item.operation === 'SCHEDULE_TIME_REQUEST',
      )
      .map((item) => {
        const request = packet.timeRequests.find((candidate) => candidate.timeRequestId === item.timeRequestId);
        if (!request) {
          return invalid(`unknown daily planning time request: ${item.timeRequestId}`);
        }
        return {
          timeRequestId: item.timeRequestId,
          durationMinutes: request.durationMinutes,
          earliestStartLocalTime: request.earliestStartLocalTime,
          latestEndLocalTime: request.latestEndLocalTime,
          startLocalTime: item.startLocalTime,
          endLocalTime: item.endLocalTime,
        };
      }),
    occupiedIntervals: packet.timeBlocks
      .filter((block) => block.isHard)
      .map(({ startLocalTime, endLocalTime }) => ({ startLocalTime, endLocalTime })),
  });

  return items;
}
