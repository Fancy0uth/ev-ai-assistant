import {
  dailyPlanProposalSchema,
  type DailyPlanProposal,
  type DailyPlanProposalItem,
  type LocalTime,
  type DailyPlanTrigger,
} from '@ev/contracts';
import { DailyPlanBaseVersionStaleError, type DailyPlanRunRepository } from './repository';
import type { DailyPlanningContextService, DailyPlanningPacket } from './context-service';
import { validateDailyPlanPlacements } from './validator';

const earliestScheduleMinute = 5 * 60;
const latestScheduleMinute = 23 * 60;
const maximumScheduledMinutes = 16 * 60;

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type CoordinatedItem = WithoutId<DailyPlanProposalItem>;

export interface DailyPlanCoordinationService {
  coordinateLocalRules(ownerId: string, localDate: string, trigger?: DailyPlanTrigger): DailyPlanProposal;
}

export interface DailyPlanCoordinationServiceOptions {
  contextService: DailyPlanningContextService;
  repository: DailyPlanRunRepository;
  newId?: () => string;
  now?: () => Date;
}

function toMinutes(value: LocalTime): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function toLocalTime(value: number): LocalTime {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` as LocalTime;
}

function priorityRank(priority: DailyPlanningPacket['timeRequests'][number]['priority']): number {
  switch (priority) {
    case 'HIGH':
      return 0;
    case 'MEDIUM':
      return 1;
    case 'LOW':
      return 2;
  }
}

function intervalFor(request: DailyPlanningPacket['timeRequests'][number]): { start: number; end: number } {
  return {
    start: Math.max(earliestScheduleMinute, request.earliestStartLocalTime === null
      ? earliestScheduleMinute
      : toMinutes(request.earliestStartLocalTime)),
    end: Math.min(latestScheduleMinute, request.latestEndLocalTime === null
      ? latestScheduleMinute
      : toMinutes(request.latestEndLocalTime)),
  };
}

function firstAvailableSlot(
  request: DailyPlanningPacket['timeRequests'][number],
  occupied: Array<{ start: number; end: number }>,
): { start: number; end: number } | null {
  const window = intervalFor(request);
  if (window.end - window.start < request.durationMinutes) return null;

  let candidate = window.start;
  for (const block of [...occupied].sort((left, right) => left.start - right.start || left.end - right.end)) {
    if (block.end <= candidate) continue;
    if (block.start >= window.end) break;
    if (candidate + request.durationMinutes <= Math.min(block.start, window.end)) {
      return { start: candidate, end: candidate + request.durationMinutes };
    }
    candidate = Math.max(candidate, block.end);
    if (candidate + request.durationMinutes > window.end) return null;
  }
  return candidate + request.durationMinutes <= window.end
    ? { start: candidate, end: candidate + request.durationMinutes }
    : null;
}

function unschedulableReason(
  request: DailyPlanningPacket['timeRequests'][number],
  plannedMinutes: number,
): 'OUTSIDE_AVAILABILITY' | 'CAPACITY_LIMIT' | 'INSUFFICIENT_TIME' {
  const window = intervalFor(request);
  if (window.end - window.start < request.durationMinutes) return 'OUTSIDE_AVAILABILITY';
  if (plannedMinutes + request.durationMinutes > maximumScheduledMinutes) return 'CAPACITY_LIMIT';
  return 'INSUFFICIENT_TIME';
}

function buildLocalRulesItems(packet: DailyPlanningPacket): CoordinatedItem[] {
  const orderedRequests = [...packet.timeRequests].sort((left, right) =>
    priorityRank(left.priority) - priorityRank(right.priority) || left.contextRef.localeCompare(right.contextRef));
  const occupied = packet.timeBlocks.map((block) => ({
    start: toMinutes(block.startLocalTime),
    end: toMinutes(block.endLocalTime),
  }));
  let plannedMinutes = packet.timeBlocks
    .filter((block) => !block.isHard)
    .reduce((total, block) => total + toMinutes(block.endLocalTime) - toMinutes(block.startLocalTime), 0);
  const items: CoordinatedItem[] = [];

  for (const [index, request] of orderedRequests.entries()) {
    const slot = plannedMinutes + request.durationMinutes > maximumScheduledMinutes
      ? null
      : firstAvailableSlot(request, occupied);
    if (slot) {
      const startLocalTime = toLocalTime(slot.start);
      const endLocalTime = toLocalTime(slot.end);
      items.push({
        ordinal: index + 1,
        status: 'PENDING_REVIEW',
        operation: 'SCHEDULE_TIME_REQUEST',
        timeRequestId: request.timeRequestId,
        timeRequestVersion: request.timeRequestVersion,
        startLocalTime,
        endLocalTime,
        reasonCode: null,
        rationale: 'LOCAL_RULES：按优先级在可用时间窗的首个无冲突时段安排。',
      });
      occupied.push(slot);
      plannedMinutes += request.durationMinutes;
      continue;
    }

    const reasonCode = unschedulableReason(request, plannedMinutes);
    items.push({
      ordinal: index + 1,
      status: 'PENDING_REVIEW',
      operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE',
      timeRequestId: request.timeRequestId,
      timeRequestVersion: request.timeRequestVersion,
      startLocalTime: null,
      endLocalTime: null,
      reasonCode,
      rationale: reasonCode === 'OUTSIDE_AVAILABILITY'
        ? 'LOCAL_RULES：可用时间窗不足以容纳该请求。'
        : reasonCode === 'CAPACITY_LIMIT'
          ? 'LOCAL_RULES：加入该请求会超过当日可安排时长上限。'
          : 'LOCAL_RULES：当前可用时间窗内无法避开全部已确认时间块。',
    });
  }

  validateDailyPlanPlacements({
    placements: items
      .filter((item): item is Extract<CoordinatedItem, { operation: 'SCHEDULE_TIME_REQUEST' }> =>
        item.operation === 'SCHEDULE_TIME_REQUEST')
      .map((item) => {
        const request = packet.timeRequests.find((candidate) => candidate.timeRequestId === item.timeRequestId);
        if (!request) throw new Error('DAILY_PLAN_COORDINATION_CONTEXT_MISMATCH');
        return {
          timeRequestId: request.timeRequestId,
          durationMinutes: request.durationMinutes,
          earliestStartLocalTime: request.earliestStartLocalTime,
          latestEndLocalTime: request.latestEndLocalTime,
          startLocalTime: item.startLocalTime,
          endLocalTime: item.endLocalTime,
        };
      }),
    occupiedIntervals: packet.timeBlocks.map(({ startLocalTime, endLocalTime }) => ({ startLocalTime, endLocalTime })),
    existingPlannedMinutes: packet.timeBlocks
      .filter((block) => !block.isHard)
      .reduce((total, block) => total + toMinutes(block.endLocalTime) - toMinutes(block.startLocalTime), 0),
  });

  return items;
}

export function createDailyPlanCoordinationService(
  options: DailyPlanCoordinationServiceOptions,
): DailyPlanCoordinationService {
  const newId = options.newId ?? crypto.randomUUID;
  const now = options.now ?? (() => new Date());

  return {
    coordinateLocalRules(ownerId, localDate, trigger = 'MANUAL') {
      const draft = options.contextService.prepareDraft(ownerId, localDate, trigger, now());
      const timestamp = draft.runInput.createdAt;
      const items = buildLocalRulesItems(draft.packet).map((item) => ({ id: newId(), ...item }));
      const scheduledCount = items.filter((item) => item.operation === 'SCHEDULE_TIME_REQUEST').length;
      const unscheduledCount = items.length - scheduledCount;
      const proposal = dailyPlanProposalSchema.parse({
        id: newId(),
        contractVersion: 'DAILY_PLAN_V1',
        mode: 'LOCAL_RULES',
        runId: draft.runInput.id,
        localDate,
        status: 'PENDING_REVIEW',
        baseScheduleVersion: draft.packet.baseScheduleVersion,
        summary: `LOCAL_RULES：按优先级和时间窗生成 ${scheduledCount} 项可审核安排；${unscheduledCount} 项保留未安排原因。`,
        items,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const run = options.repository.createContextReady(draft.runInput);
      if (run.localDate !== localDate) throw new Error('DAILY_PLAN_COORDINATION_CONTEXT_MISMATCH');
      try {
        return options.repository.completeWithProposal(
          ownerId,
          run.id,
          draft.packet.baseScheduleVersion,
          proposal,
        );
      } catch (error) {
        if (error instanceof DailyPlanBaseVersionStaleError) throw error;
        throw error;
      }
    },
  };
}
