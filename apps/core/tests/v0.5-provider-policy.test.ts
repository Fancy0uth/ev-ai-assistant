import { describe, expect, it } from 'vitest';
import {
  PROVIDER_POLICY,
  ProviderPolicyError,
  providerTokenReservation,
  validateProviderResult,
} from '../src/modules/providers/provider-policy';

describe('v0.5 provider execution policy', () => {
  it('freezes the supported limits and fails closed for non-complete model results', () => {
    expect(PROVIDER_POLICY).toMatchObject({
      headerTimeoutMs: 5_000,
      totalTimeoutMs: 15_000,
      leaseMs: 20_000,
      maxInputChars: 20_000,
      maxOutputChars: 20_000,
      maxCallsPerRun: 2,
      maxCallsPerOwnerDay: 20,
      maxTokensPerOwnerDay: 100_000,
      maxCompletionTokens: 2_000,
    });

    expect(() =>
      validateProviderResult({
        output: { schemaVersion: 'DAILY_PLAN_MODEL_V1' },
        model: 'deepseek-v4-flash',
        finishReason: 'length',
        usage: { promptTokens: 1, completionTokens: 2_001, totalTokens: 2_002 },
        outputChars: 20,
      }),
    ).toThrow(ProviderPolicyError);
  });

  it('reserves a conservative input-token ceiling plus the full completion allowance', () => {
    expect(providerTokenReservation(100)).toBe(2_400);
    expect(providerTokenReservation(PROVIDER_POLICY.maxInputChars)).toBe(82_000);
    expect(providerTokenReservation(30_000)).toBe(PROVIDER_POLICY.maxTokensPerOwnerDay);
  });
});
