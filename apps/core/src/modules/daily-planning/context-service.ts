import {
  dailyPlanContextManifestSchema,
  type DailyPlanContextManifest,
  type DailyPlanRun,
  type DailyPlanTrigger,
  type LocalTime,
} from '@ev/contracts';
import type {
  DailyPlanRunRepository,
  DailyPlanningReadContext,
} from './repository';

type RecoveryLevel = 'NONE' | 'READY' | 'MODERATE' | 'LIMITED';

interface DailyPlanningPacket {
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

export interface DailyPlanningContextService {
  prepare(
    ownerId: string,
    localDate: string,
    trigger: DailyPlanTrigger,
    now?: Date,
  ): { run: DailyPlanRun; packet: DailyPlanningPacket };
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

function buildPacket(context: DailyPlanningReadContext): DailyPlanningPacket {
  return {
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

export function createDailyPlanningContextService(
  repository: DailyPlanRunRepository,
  options: DailyPlanningContextServiceOptions = {},
): DailyPlanningContextService {
  const newId = options.newId ?? crypto.randomUUID;

  return {
    prepare(ownerId, localDate, trigger, now = new Date()) {
      const context = repository.readContext(ownerId, localDate);
      const createdAt = now.toISOString();
      const manifest = buildManifest(context, localDate, createdAt);
      const run = repository.createContextReady({
        id: newId(),
        ownerId,
        localDate,
        trigger,
        contextManifest: manifest,
        createdAt,
      });

      return { run, packet: buildPacket(context) };
    },
  };
}
