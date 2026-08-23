import type { DeepSeekFinishReason, DeepSeekUsage } from '@ev/contracts';
import type { DailyPlanningProviderResult } from '../daily-planning/provider';

/**
 * Stable v0.5 limits for a single Daily Plan provider execution.  Keeping
 * them in one place makes the adapter, service and tests use the same facts.
 */
export const PROVIDER_POLICY = {
  deepSeekEndpoint: 'https://api.deepseek.com/chat/completions',
  headerTimeoutMs: 5_000,
  totalTimeoutMs: 15_000,
  leaseMs: 20_000,
  maxInputChars: 20_000,
  maxOutputChars: 20_000,
  maxCallsPerRun: 2,
  maxCallsPerOwnerDay: 20,
  maxTokensPerOwnerDay: 100_000,
  maxCompletionTokens: 2_000,
} as const;

const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function providerUsageLocalDate(instant: Date): string {
  const parts = Object.fromEntries(
    shanghaiDateFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function providerTokenReservation(inputChars: number): number {
  return Math.min(
    PROVIDER_POLICY.maxTokensPerOwnerDay,
    inputChars + PROVIDER_POLICY.maxCompletionTokens,
  );
}

export class ProviderPolicyError extends Error {
  constructor(readonly code: 'DAILY_PLAN_PROVIDER_QUOTA_EXCEEDED' | 'DAILY_PLAN_PROVIDER_RESPONSE_REJECTED') {
    super(code);
    this.name = 'ProviderPolicyError';
  }
}

export function emptyUsage(): DeepSeekUsage {
  return { promptTokens: null, completionTokens: null, totalTokens: null };
}

function isFinalUsableReason(reason: DeepSeekFinishReason): boolean {
  return reason === 'stop';
}

/**
 * Provider output is deliberately checked before the domain JSON parser.
 * An otherwise schema-valid payload with a truncated/filtered result is not
 * evidence that the model completed the requested plan.
 */
export function validateProviderResult(result: DailyPlanningProviderResult): void {
  if (!isFinalUsableReason(result.finishReason)) {
    throw new ProviderPolicyError('DAILY_PLAN_PROVIDER_RESPONSE_REJECTED');
  }
  if (result.outputChars > PROVIDER_POLICY.maxOutputChars) {
    throw new ProviderPolicyError('DAILY_PLAN_PROVIDER_RESPONSE_REJECTED');
  }
  if (
    result.usage.completionTokens !== null &&
    result.usage.completionTokens > PROVIDER_POLICY.maxCompletionTokens
  ) {
    throw new ProviderPolicyError('DAILY_PLAN_PROVIDER_RESPONSE_REJECTED');
  }
}
