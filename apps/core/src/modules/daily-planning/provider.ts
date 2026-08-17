import type { LocalTime } from '@ev/contracts';

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
    durationMinutes: number;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    availability: {
      earliestStartLocalTime: LocalTime | null;
      latestEndLocalTime: LocalTime | null;
    };
  }>;
  recoveryLevel: 'NONE' | 'READY' | 'MODERATE' | 'LIMITED';
}

export interface DailyPlanningProvider {
  generate(apiKey: string, input: DailyPlanningProviderInput): Promise<unknown>;
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
