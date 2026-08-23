import { dailyPlanFailureCodeSchema, type DailyPlanTrigger } from '@ev/contracts';

const shanghaiTimeZone = 'Asia/Shanghai';
const dailyPlanHour = 7;
const oneDayMilliseconds = 24 * 60 * 60 * 1000;

export interface DailyPlanAutomationGenerationPort {
  generateDailyPlan(input: {
    ownerId: string;
    localDate: string;
    trigger: DailyPlanTrigger;
  }): Promise<unknown>;
}

export interface DailyPlanAutomationRunRepository {
  findLatestRunForDate(ownerId: string, localDate: string): { status: string } | undefined;
}

export interface DailyPlanAutomationCredentialPort {
  getMetadata(ownerId: string): { state: 'CONFIGURED' | 'NOT_CONFIGURED' };
}

export type DailyPlanAutomationResult =
  | 'NOT_DUE'
  | 'NOT_CONFIGURED'
  | 'EXISTING_RUN'
  | 'IN_FLIGHT'
  | 'STARTED';

export interface DailyPlanAutomationService {
  ensureForFirstVisit(ownerId: string, requestedDate: string): DailyPlanAutomationResult;
  runScheduled(): DailyPlanAutomationResult;
  scheduleNextRun(): void;
  stop(): void;
  isGenerating(ownerId: string, localDate: string): boolean;
}

export interface DailyPlanAutomationServiceOptions {
  dailyPlanningService: DailyPlanAutomationGenerationPort;
  dailyPlanRunRepository: DailyPlanAutomationRunRepository;
  providerCredentialService: DailyPlanAutomationCredentialPort;
  findOwnerId: () => string | undefined;
  now?: () => Date;
  schedule?: (callback: () => void, delayMilliseconds: number) => unknown;
  cancel?: (handle: unknown) => void;
  onEvent?: (event: {
    event: 'daily_plan_automation_started' | 'daily_plan_automation_finished' | 'daily_plan_automation_failed';
    trigger: DailyPlanTrigger;
    failureCode?: string;
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

function failureCode(error: unknown): string {
  const parsed = error instanceof Error
    ? dailyPlanFailureCodeSchema.safeParse(error.message)
    : { success: false as const };
  return parsed.success ? parsed.data : 'DAILY_PLAN_PROVIDER_UNAVAILABLE';
}

function runKey(ownerId: string, localDate: string): string {
  return `${ownerId}:${localDate}`;
}

export function createDailyPlanAutomationService(
  options: DailyPlanAutomationServiceOptions,
): DailyPlanAutomationService {
  const now = options.now ?? (() => new Date());
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  const inFlight = new Set<string>();
  let timerHandle: unknown;

  function start(
    ownerId: string,
    localDate: string,
    trigger: DailyPlanTrigger,
  ): DailyPlanAutomationResult {
    const key = runKey(ownerId, localDate);
    if (inFlight.has(key)) return 'IN_FLIGHT';
    if (options.dailyPlanRunRepository.findLatestRunForDate(ownerId, localDate)) {
      return 'EXISTING_RUN';
    }
    if (options.providerCredentialService.getMetadata(ownerId).state !== 'CONFIGURED') {
      return 'NOT_CONFIGURED';
    }

    inFlight.add(key);
    options.onEvent?.({ event: 'daily_plan_automation_started', trigger });
    let generation: Promise<unknown>;
    try {
      generation = options.dailyPlanningService.generateDailyPlan({ ownerId, localDate, trigger });
    } catch (error) {
      inFlight.delete(key);
      options.onEvent?.({ event: 'daily_plan_automation_failed', trigger, failureCode: failureCode(error) });
      return 'STARTED';
    }
    void generation
      .then(() => {
        options.onEvent?.({ event: 'daily_plan_automation_finished', trigger });
      })
      .catch((error: unknown) => {
        options.onEvent?.({ event: 'daily_plan_automation_failed', trigger, failureCode: failureCode(error) });
      })
      .finally(() => {
        inFlight.delete(key);
      });
    return 'STARTED';
  }

  function runScheduled(): DailyPlanAutomationResult {
    const current = shanghaiDateTime(now());
    if (current.hour < dailyPlanHour) return 'NOT_DUE';
    const ownerId = options.findOwnerId();
    if (!ownerId) return 'NOT_DUE';
    return start(ownerId, current.localDate, 'SCHEDULED_0700');
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
      return start(ownerId, requestedDate, 'FIRST_VISIT_RECOVERY');
    },

    runScheduled,

    scheduleNextRun,

    stop() {
      if (timerHandle !== undefined) cancel(timerHandle);
      timerHandle = undefined;
    },

    isGenerating(ownerId, localDate) {
      return inFlight.has(runKey(ownerId, localDate));
    },
  };
}
