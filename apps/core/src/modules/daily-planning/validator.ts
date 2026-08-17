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

export function validateDailyPlanOutput(
  packet: DailyPlanningPacket,
  output: DailyPlanModelOutput,
): ValidatedDailyPlanItem[] {
  const requestsByContextRef = new Map(
    packet.timeRequests.map((request) => [request.contextRef, request]),
  );
  const hardBlocks = packet.timeBlocks
    .filter((block) => block.isHard)
    .map((block) => ({
      start: toMinutes(block.startLocalTime),
      end: toMinutes(block.endLocalTime),
    }));
  const consumedContextRefs = new Set<string>();
  const scheduledIntervals: ScheduledInterval[] = [];
  let scheduledMinutes = 0;

  return output.actions.map((action, index): ValidatedDailyPlanItem => {
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

    const interval = {
      start: toMinutes(action.startLocalTime),
      end: toMinutes(action.endLocalTime),
    };
    const durationMinutes = interval.end - interval.start;

    if (interval.start < earliestScheduleMinute || interval.end > latestScheduleMinute) {
      return invalid('scheduled item is outside the supported daily planning window');
    }
    if (durationMinutes !== request.durationMinutes) {
      return invalid('scheduled item duration differs from its time request');
    }
    if (
      (request.earliestStartLocalTime !== null &&
        interval.start < toMinutes(request.earliestStartLocalTime)) ||
      (request.latestEndLocalTime !== null && interval.end > toMinutes(request.latestEndLocalTime))
    ) {
      return invalid('scheduled item is outside its availability window');
    }
    if (hardBlocks.some((block) => overlaps(interval, block))) {
      return invalid('scheduled item overlaps a hard fixed block');
    }
    if (scheduledIntervals.some((scheduled) => overlaps(interval, scheduled))) {
      return invalid('scheduled proposal items overlap');
    }

    scheduledMinutes += durationMinutes;
    if (scheduledMinutes > maximumScheduledMinutes) {
      return invalid('scheduled proposal items exceed the daily capacity limit');
    }
    scheduledIntervals.push(interval);

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
}
