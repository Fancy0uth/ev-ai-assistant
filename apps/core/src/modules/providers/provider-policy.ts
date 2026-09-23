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

export const CAPABILITY_POLICY = {
  maxCallsPerOwnerDay: 20,
  leaseGraceMs: 5_000,
  vision: {
    maxInputBytes: 5_000_000,
    maxOutputChars: 100_000,
    totalTimeoutMs: 30_000,
  },
  publicSearch: {
    maxInputChars: 300,
    maxOutputChars: 20_000,
    totalTimeoutMs: 15_000,
  },
  learningAdvice: {
    maxInputChars: 20_000,
    maxOutputChars: 8_000,
    totalTimeoutMs: 15_000,
  },
} as const;

export type CapabilityExecutionFailure =
  | 'CAPABILITY_INPUT_LIMIT_EXCEEDED'
  | 'CAPABILITY_OUTPUT_LIMIT_EXCEEDED'
  | 'CAPABILITY_OUTPUT_INVALID'
  | 'CAPABILITY_EXECUTION_TIMEOUT'
  | 'CAPABILITY_PROVIDER_UNAVAILABLE';

export class CapabilityExecutionError extends Error {
  constructor(
    readonly code: CapabilityExecutionFailure,
    readonly providerCallStarted: boolean,
    readonly outputChars = 0,
  ) {
    super(code);
    this.name = 'CapabilityExecutionError';
  }
}

export async function executeCapabilityAdapter<T>(input: {
  inputSize: number;
  maxInputSize: number;
  maxOutputChars: number;
  timeoutMs: number;
  invoke: () => Promise<T>;
}): Promise<{ output: T; outputChars: number }> {
  if (!Number.isSafeInteger(input.inputSize) || input.inputSize < 0 || input.inputSize > input.maxInputSize) {
    throw new CapabilityExecutionError('CAPABILITY_INPUT_LIMIT_EXCEEDED', false);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let providerCallStarted = false;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CapabilityExecutionError('CAPABILITY_EXECUTION_TIMEOUT', true)), input.timeoutMs);
    });
    providerCallStarted = true;
    const output = await Promise.race([Promise.resolve().then(input.invoke), timeout]);
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(output);
    } catch {
      throw new CapabilityExecutionError('CAPABILITY_OUTPUT_INVALID', true);
    }
    if (typeof serialized !== 'string') throw new CapabilityExecutionError('CAPABILITY_OUTPUT_INVALID', true);
    if (serialized.length > input.maxOutputChars) {
      throw new CapabilityExecutionError(
        'CAPABILITY_OUTPUT_LIMIT_EXCEEDED',
        true,
        Math.min(serialized.length, 100_000),
      );
    }
    return { output, outputChars: serialized.length };
  } catch (error) {
    if (error instanceof CapabilityExecutionError) throw error;
    throw new CapabilityExecutionError('CAPABILITY_PROVIDER_UNAVAILABLE', providerCallStarted);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
  // UTF-8 bytes are a conservative upper bound for tokenizer output. Four
  // bytes per JavaScript code unit intentionally over-reserves multilingual
  // input instead of assuming one character is one token.
  return Math.min(
    PROVIDER_POLICY.maxTokensPerOwnerDay,
    inputChars * 4 + PROVIDER_POLICY.maxCompletionTokens,
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
