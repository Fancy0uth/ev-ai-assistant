import type {
  DeepSeekFinishReason,
  DeepSeekModel,
  DeepSeekUsage,
  LocalTime,
} from '@ev/contracts';

export interface DailyPlanningProviderInput {
  localDate: string;
  fixedBlocks: Array<{
    startLocalTime: LocalTime;
    endLocalTime: LocalTime;
  }>;
  softBlocks: Array<{
    startLocalTime: LocalTime;
    endLocalTime: LocalTime;
  }>;
  timeRequests: Array<{
    contextRef: string;
    safeTitle: string;
    domain: 'WORK' | 'STUDY' | 'FITNESS' | 'NUTRITION' | 'LIFE';
    deadlineLocalDate: string | null;
    durationMinutes: number;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    availability: {
      earliestStartLocalTime: LocalTime | null;
      latestEndLocalTime: LocalTime | null;
    };
    isFixed: boolean;
  }>;
  recoveryLevel: 'NONE' | 'READY' | 'MODERATE' | 'LIMITED';
}

export interface DailyPlanningProvider {
  generate(apiKey: string, input: DailyPlanningProviderInput): Promise<DailyPlanningProviderResult>;
}

/**
 * The provider boundary intentionally carries only the parsed model output
 * plus the small, allowlisted transport metadata that v0.5 may persist.
 * Raw HTTP payloads, prompt text and credentials cannot cross this port.
 */
export interface DailyPlanningProviderResult {
  output: unknown;
  model: DeepSeekModel;
  finishReason: DeepSeekFinishReason;
  usage: DeepSeekUsage;
  outputChars: number;
}

export class DailyPlanningProviderUnavailableError extends Error {
  readonly code = 'DAILY_PLAN_PROVIDER_UNAVAILABLE';

  constructor() {
    super('Daily planning provider is unavailable');
    this.name = 'DailyPlanningProviderUnavailableError';
  }
}

export class DailyPlanningProviderModelOutputError extends Error {
  readonly code = 'DAILY_PLAN_MODEL_OUTPUT_INVALID';

  constructor() {
    super('Daily planning provider returned invalid model output');
    this.name = 'DailyPlanningProviderModelOutputError';
  }
}

export class DailyPlanningProviderTimeoutError extends Error {
  readonly code = 'DAILY_PLAN_PROVIDER_TIMEOUT';

  constructor() {
    super('Daily planning provider timed out');
    this.name = 'DailyPlanningProviderTimeoutError';
  }
}

export class DailyPlanningProviderQuotaError extends Error {
  readonly code = 'DAILY_PLAN_PROVIDER_QUOTA_EXCEEDED';

  constructor() {
    super('Daily planning provider quota is exhausted');
    this.name = 'DailyPlanningProviderQuotaError';
  }
}
