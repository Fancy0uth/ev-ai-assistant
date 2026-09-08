import type { DailyPlanPreflight, DailyPlanTrigger } from '@ev/contracts';

const shanghaiTimeZone = 'Asia/Shanghai';
const dailyPlanHour = 7;
const oneDayMilliseconds = 24 * 60 * 60 * 1000;
type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface DailyPlanAutomationPreflightPort {
  prepare(ownerId: string, localDate: string, trigger: DailyPlanTrigger): DailyPlanPreflight;
}

export interface DailyPlanAutomationRunRepository {
  findLatestRunForDate(ownerId: string, localDate: string): { status: string } | undefined;
}

export type DailyPlanAutomationResult =
  | 'NOT_DUE'
  | 'EXISTING_RUN'
  | 'AWAITING_CONTEXT_APPROVAL'
  | 'PREPARATION_FAILED';

export interface DailyPlanAutomationService {
  ensureForFirstVisit(ownerId: string, requestedDate: string): DailyPlanAutomationResult;
  runScheduled(): DailyPlanAutomationResult;
  scheduleNextRun(): void;
  stop(): void;
}

export interface DailyPlanAutomationServiceOptions {
  dailyPlanPreflightService: DailyPlanAutomationPreflightPort;
  dailyPlanRunRepository: DailyPlanAutomationRunRepository;
  findOwnerId: () => string | undefined;
  now?: () => Date;
  schedule?: (callback: () => void, delayMilliseconds: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
  onEvent?: (event: {
    event: 'daily_plan_automation_failed';
    trigger: DailyPlanTrigger;
    failureCode: 'DAILY_PLAN_CONTEXT_INVALID';
  }) => void;
}

interface ShanghaiDateTime {
  localDate: string;
  hour: number;
}

function shanghaiDateTime(date: Date): ShanghaiDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: shanghaiTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const fields = new Map(parts.map((part) => [part.type, part.value]));
  const year = fields.get('year');
  const month = fields.get('month');
  const day = fields.get('day');
  const hour = fields.get('hour');
  if (!year || !month || !day || !hour) {
    throw new Error('unable to derive Asia/Shanghai local time');
  }
  return {
    localDate: `${year}-${month}-${day}`,
    hour: Number(hour),
  };
}

function nextShanghaiSeven(now: Date): Date {
  const { localDate } = shanghaiDateTime(now);
  const todayAtSeven = new Date(`${localDate}T07:00:00+08:00`);
  if (todayAtSeven.getTime() > now.getTime()) return todayAtSeven;
  return new Date(todayAtSeven.getTime() + oneDayMilliseconds);
}

export function createDailyPlanAutomationService(
  options: DailyPlanAutomationServiceOptions,
): DailyPlanAutomationService {
  const now = options.now ?? (() => new Date());
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle));
  let timerHandle: TimerHandle | undefined;

  function prepare(
    ownerId: string,
    localDate: string,
    trigger: DailyPlanTrigger,
  ): DailyPlanAutomationResult {
    if (options.dailyPlanRunRepository.findLatestRunForDate(ownerId, localDate)) {
      return 'EXISTING_RUN';
    }
    try {
      options.dailyPlanPreflightService.prepare(ownerId, localDate, trigger);
      return 'AWAITING_CONTEXT_APPROVAL';
    } catch {
      options.onEvent?.({
        event: 'daily_plan_automation_failed',
        trigger,
        failureCode: 'DAILY_PLAN_CONTEXT_INVALID',
      });
      return 'PREPARATION_FAILED';
    }
  }

  function runScheduled(): DailyPlanAutomationResult {
    const current = shanghaiDateTime(now());
    if (current.hour < dailyPlanHour) return 'NOT_DUE';
    const ownerId = options.findOwnerId();
    if (!ownerId) return 'NOT_DUE';
    return prepare(ownerId, current.localDate, 'SCHEDULED_0700');
  }

  function scheduleNextRun(): void {
    if (timerHandle !== undefined) cancel(timerHandle);
    const current = now();
    const next = nextShanghaiSeven(current);
    timerHandle = schedule(() => {
      timerHandle = undefined;
      runScheduled();
      scheduleNextRun();
    }, Math.max(0, next.getTime() - current.getTime()));
  }

  return {
    ensureForFirstVisit(ownerId, requestedDate) {
      const current = shanghaiDateTime(now());
      if (current.hour < dailyPlanHour || requestedDate !== current.localDate) return 'NOT_DUE';
      return prepare(ownerId, requestedDate, 'FIRST_VISIT_RECOVERY');
    },

    runScheduled,

    scheduleNextRun,

    stop() {
      if (timerHandle !== undefined) cancel(timerHandle);
      timerHandle = undefined;
    },
  };
}
