import {
  dailyPlanContextManifestSchema,
  type DailyPlanPreflightItem,
  type DailyPlanContextManifest,
  type DailyPlanRun,
  type DailyPlanTrigger,
  type LocalTime,
  type TimeRequestSource,
} from '@ev/contracts';
import type {
  DailyPlanRunRepository,
  DailyPlanningReadContext,
} from './repository';

type RecoveryLevel = 'NONE' | 'READY' | 'MODERATE' | 'LIMITED';
export type DailyPlanningDomain = 'WORK' | 'STUDY' | 'FITNESS' | 'NUTRITION' | 'LIFE';

export interface DailyPlanningPacket {
  baseScheduleVersion: number;
  timeBlocks: Array<{
    startLocalTime: LocalTime;
    endLocalTime: LocalTime;
    isHard: boolean;
  }>;
  timeRequests: Array<{
    contextRef: string;
    timeRequestId: string;
    timeRequestVersion: number;
    durationMinutes: number;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    earliestStartLocalTime: LocalTime | null;
    latestEndLocalTime: LocalTime | null;
    isFixed: boolean;
  }>;
  recoveryLevel: RecoveryLevel;
}

export interface ApprovedDailyPlanningPacket {
  baseScheduleVersion: number;
  timeBlocks: DailyPlanningPacket['timeBlocks'];
  timeRequests: Array<DailyPlanningPacket['timeRequests'][number] & {
    safeTitle: string;
    domain: DailyPlanningDomain;
    deadlineLocalDate: string | null;
    included: boolean;
  }>;
  recoveryLevel: RecoveryLevel;
}

export interface DailyPlanningContextDraft {
  runInput: {
    id: string;
    ownerId: string;
    localDate: string;
    trigger: DailyPlanTrigger;
    contextManifest: DailyPlanContextManifest;
    createdAt: string;
  };
  packet: DailyPlanningPacket;
  items: DailyPlanPreflightItem[];
}

export interface DailyPlanningContextService {
  prepareDraft(
    ownerId: string,
    localDate: string,
    trigger: DailyPlanTrigger,
    now?: Date,
  ): DailyPlanningContextDraft;
  prepare(
    ownerId: string,
    localDate: string,
    trigger: DailyPlanTrigger,
    now?: Date,
  ): { run: DailyPlanRun; packet: DailyPlanningPacket };
}

function domainForSource(source: TimeRequestSource): DailyPlanningDomain {
  switch (source) {
    case 'PROJECT_AGENT':
      return 'WORK';
    case 'LEARNING_AGENT':
      return 'STUDY';
    case 'FITNESS_AGENT':
      return 'FITNESS';
    case 'NUTRITION_AGENT':
      return 'NUTRITION';
    case 'SCHEDULE_COORDINATOR':
      return 'LIFE';
  }
}

export interface DailyPlanningContextServiceOptions {
  newId?: () => string;
}

function recoveryLevel(context: DailyPlanningReadContext): RecoveryLevel {
  const value = context.latestRecovery?.value;
  if (value === undefined) {
    return 'NONE';
  }
  if (value >= 70) {
    return 'READY';
  }
  if (value >= 40) {
    return 'MODERATE';
  }
  return 'LIMITED';
}

function assertActiveTimeRequestContext(context: DailyPlanningReadContext): void {
  if (context.timeRequests.some((request) => request.lifecycleStatus !== 'ACTIVE')) {
    throw new Error('DAILY_PLAN_CLOSED_TIME_REQUEST_CONTEXT');
  }
}

function buildManifest(
  context: DailyPlanningReadContext,
  localDate: string,
  createdAt: string,
): DailyPlanContextManifest {
  const fixedEvents = context.events.filter((event) => event.isHard).length;
  const softBlocks = context.events.length - fixedEvents;

  return dailyPlanContextManifestSchema.parse({
    contractVersion: 'DAILY_PLAN_V1',
    purpose: 'DAILY_PLAN_GENERATION',
    localDate,
    createdAt,
    sentAt: null,
    entries: [
      {
        category: 'FIXED_EVENTS',
        fieldCategories: ['LOCAL_DATE', 'TIME_RANGE', 'STATUS'],
        entityCount: fixedEvents,
      },
      {
        category: 'CONFIRMED_SOFT_BLOCKS',
        fieldCategories: ['LOCAL_DATE', 'TIME_RANGE', 'STATUS'],
        entityCount: softBlocks,
      },
      {
        category: 'OPEN_TIME_REQUESTS',
        fieldCategories: [
          'TARGET_DATE',
          'DURATION_MINUTES',
          'PRIORITY',
          'AVAILABILITY_WINDOW',
        ],
        entityCount: context.timeRequests.length,
      },
      {
        category: 'RECOVERY_CONSTRAINTS',
        fieldCategories: ['LOCAL_DATE', 'RECOVERY_LEVEL'],
        entityCount: context.latestRecovery ? 1 : 0,
      },
    ],
  });
}

function buildPacket(
  context: DailyPlanningReadContext,
  baseScheduleVersion: number,
): DailyPlanningPacket {
  return {
    baseScheduleVersion,
    timeBlocks: context.events.map((event) => ({
      startLocalTime: event.startLocalTime,
      endLocalTime: event.endLocalTime,
      isHard: event.isHard,
    })),
    timeRequests: context.timeRequests.map((request, index) => ({
      contextRef: `TIME_REQUEST_${index + 1}`,
      timeRequestId: request.id,
      timeRequestVersion: request.version,
      durationMinutes: request.durationMinutes,
      priority: request.priority,
      earliestStartLocalTime: request.earliestStartLocalTime,
      latestEndLocalTime: request.latestEndLocalTime,
      isFixed: request.isFixed,
    })),
    recoveryLevel: recoveryLevel(context),
  };
}

function buildPreflightItems(context: DailyPlanningReadContext): DailyPlanPreflightItem[] {
  return context.timeRequests.map((request, index) => {
    if (request.title === undefined) {
      throw new Error('DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH');
    }
    return {
      contextRef: `TIME_REQUEST_${index + 1}`,
      safeTitle: request.title,
      domain: domainForSource(request.source),
      deadlineLocalDate: request.targetDate,
      durationMinutes: request.durationMinutes,
      priority: request.priority,
      availability: {
        earliestStartLocalTime: request.earliestStartLocalTime,
        latestEndLocalTime: request.latestEndLocalTime,
      },
      isFixed: request.isFixed,
      included: true,
    };
  });
}

export function buildApprovedDailyPlanningPacket(
  context: DailyPlanningReadContext,
  preflightItems: DailyPlanPreflightItem[],
  baseScheduleVersion: number,
): ApprovedDailyPlanningPacket {
  const preparedItems = new Map(preflightItems.map((item) => [item.contextRef, item]));
  if (preparedItems.size !== preflightItems.length || context.timeRequests.length !== preflightItems.length) {
    throw new Error('DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH');
  }

  const timeRequests = context.timeRequests.map((request, index) => {
    const contextRef = `TIME_REQUEST_${index + 1}`;
    const item = preparedItems.get(contextRef);
    if (
      !item ||
      item.durationMinutes !== request.durationMinutes ||
      item.priority !== request.priority ||
      item.availability.earliestStartLocalTime !== request.earliestStartLocalTime ||
      item.availability.latestEndLocalTime !== request.latestEndLocalTime ||
      item.isFixed !== request.isFixed
    ) {
      throw new Error('DAILY_PLAN_PREFLIGHT_CONTEXT_MISMATCH');
    }

    return {
      contextRef,
      timeRequestId: request.id,
      timeRequestVersion: request.version,
      durationMinutes: request.durationMinutes,
      priority: request.priority,
      earliestStartLocalTime: request.earliestStartLocalTime,
      latestEndLocalTime: request.latestEndLocalTime,
      isFixed: request.isFixed,
      safeTitle: item.safeTitle,
      domain: item.domain,
      deadlineLocalDate: item.deadlineLocalDate,
      included: item.included,
    };
  });

  return {
    baseScheduleVersion,
    timeBlocks: context.events.map((event) => ({
      startLocalTime: event.startLocalTime,
      endLocalTime: event.endLocalTime,
      isHard: event.isHard,
    })),
    timeRequests,
    recoveryLevel: recoveryLevel(context),
  };
}

export function createDailyPlanningContextService(
  repository: DailyPlanRunRepository,
  options: DailyPlanningContextServiceOptions = {},
): DailyPlanningContextService {
  const newId = options.newId ?? crypto.randomUUID;
  const prepareDraft = (
    ownerId: string,
    localDate: string,
    trigger: DailyPlanTrigger,
    now = new Date(),
  ): DailyPlanningContextDraft => {
    const baseScheduleVersion = repository.readScheduleVersion(ownerId).version;
    const context = repository.readContext(ownerId, localDate);
    assertActiveTimeRequestContext(context);
    const createdAt = now.toISOString();
    const packet = buildPacket(context, baseScheduleVersion);

    return {
      runInput: {
        id: newId(),
        ownerId,
        localDate,
        trigger,
        contextManifest: buildManifest(context, localDate, createdAt),
        createdAt,
      },
      packet,
      items: buildPreflightItems(context),
    };
  };

  return {
    prepareDraft,

    prepare(ownerId, localDate, trigger, now = new Date()) {
      const draft = prepareDraft(ownerId, localDate, trigger, now);
      return { run: repository.createContextReady(draft.runInput), packet: draft.packet };
    },
  };
}
