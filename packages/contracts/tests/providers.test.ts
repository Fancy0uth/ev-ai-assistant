import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  deepSeekFinishReasonSchema,
  deepSeekModelSchema,
  deepSeekUsageSchema,
  deepSeekConnectionTestResultSchema,
  deepSeekCredentialDeleteInputSchema,
  deepSeekCredentialStatusResponseSchema,
  deepSeekCredentialWriteInputSchema,
  capabilityMatrixResponseSchema,
  capabilityDisclosureVersionSchema,
} from '../src/index';

const publicCredentialStatus = {
  data: {
    providerKey: 'DEEPSEEK',
    state: 'CONFIGURED',
    updatedAt: '2026-08-17T05:30:00.000Z',
    lastConnectionTest: { status: 'SUCCEEDED' },
  },
};

describe('DeepSeek credential contracts', () => {
  it('freezes the disclosure version used before a public-search request', () => {
    expect(capabilityDisclosureVersionSchema.parse('CAPABILITY_DISCLOSURE_V1')).toBe('CAPABILITY_DISCLOSURE_V1');
    expect(capabilityDisclosureVersionSchema.safeParse('CAPABILITY_DISCLOSURE_V2').success).toBe(false);
  });

  it('describes capability availability and evidence without exposing a credential', () => {
    const parsed = capabilityMatrixResponseSchema.parse({
      data: [
        {
          capability: 'COURSE_SCHEDULE_VISION',
          providerId: null,
          providerLabel: '未配置',
          adapterKind: 'NONE',
          evidenceKind: 'NONE',
          availability: 'BLOCKED_PROVIDER',
        },
        {
          capability: 'PUBLIC_LEARNING_SEARCH',
          providerId: null,
          providerLabel: '未配置',
          adapterKind: 'NONE',
          evidenceKind: 'NONE',
          availability: 'BLOCKED_PROVIDER',
        },
        {
          capability: 'LEARNING_TEXT_ANALYSIS',
          providerId: null,
          providerLabel: '未配置',
          adapterKind: 'NONE',
          evidenceKind: 'NONE',
          availability: 'BLOCKED_PROVIDER',
        },
      ],
    });

    expect(parsed.data[0]).toMatchObject({
      capability: 'COURSE_SCHEDULE_VISION',
      adapterKind: 'NONE',
      evidenceKind: 'NONE',
      availability: 'BLOCKED_PROVIDER',
    });
    expect(JSON.stringify(parsed)).not.toMatch(/api.?key|secret|credential/i);
  });

  it('freezes the v0.6 reliability version and DeepSeek allowlists', () => {
    expect(APP_VERSION).toBe('0.6.0');
    expect(deepSeekModelSchema.safeParse('deepseek-v4-flash').success).toBe(true);
    expect(deepSeekModelSchema.safeParse('deepseek-v4-pro').success).toBe(true);
    expect(deepSeekModelSchema.safeParse('deepseek-chat').success).toBe(false);
    expect(deepSeekFinishReasonSchema.safeParse('stop').success).toBe(true);
    expect(deepSeekFinishReasonSchema.safeParse('unexpected').success).toBe(false);
    expect(
      deepSeekUsageSchema.parse({
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
      }),
    ).toEqual({ promptTokens: 12, completionTokens: 5, totalTokens: 17 });
  });

  it('accepts a trimmed valid key write so usable DeepSeek credentials are not rejected', () => {
    expect(deepSeekCredentialWriteInputSchema.parse({ apiKey: '  ds-test-key  ' })).toEqual({
      apiKey: 'ds-test-key',
    });
  });

  it('rejects unknown credential write fields so storage records cannot enter the API input', () => {
    expect(
      deepSeekCredentialWriteInputSchema.safeParse({
        apiKey: 'ds-test-key',
        encryptedApiKey: 'ciphertext',
      }).success,
    ).toBe(false);
  });

  it('requires the exact delete confirmation so a mistyped request cannot remove a credential', () => {
    expect(deepSeekCredentialDeleteInputSchema.parse({ confirmation: 'DELETE' })).toEqual({
      confirmation: 'DELETE',
    });
    expect(deepSeekCredentialDeleteInputSchema.safeParse({ confirmation: 'delete' }).success).toBe(
      false,
    );
  });

  it('rejects unknown deletion fields so removal stays limited to exact confirmation', () => {
    expect(
      deepSeekCredentialDeleteInputSchema.safeParse({
        confirmation: 'DELETE',
        apiKey: 'ds-test-key',
      }).success,
    ).toBe(false);
  });

  it('accepts non-sensitive public status so settings can render credential state without a secret', () => {
    expect(deepSeekCredentialStatusResponseSchema.parse(publicCredentialStatus)).toEqual(
      publicCredentialStatus,
    );
  });

  it('rejects keys and key-derived fields from public status so a storage DTO cannot leak a credential', () => {
    const leakedStatuses = [
      { data: { ...publicCredentialStatus.data, apiKey: 'ds-test-key' } },
      { data: { ...publicCredentialStatus.data, encryptedApiKey: 'ciphertext' } },
      { data: { ...publicCredentialStatus.data, apiKeySuffix: '1234' } },
      { data: { ...publicCredentialStatus.data, apiKeyFingerprint: 'derived-value' } },
      { ...publicCredentialStatus, apiKey: 'ds-test-key' },
    ];

    for (const leakedStatus of leakedStatuses) {
      expect(deepSeekCredentialStatusResponseSchema.safeParse(leakedStatus).success).toBe(false);
    }
  });

  it('rejects a key in successful connection status so nested public state cannot leak credentials', () => {
    expect(
      deepSeekCredentialStatusResponseSchema.safeParse({
        data: {
          ...publicCredentialStatus.data,
          lastConnectionTest: { status: 'SUCCEEDED', apiKey: 'ds-test-key' },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a key in failed connection status so nested error details cannot leak credentials', () => {
    expect(
      deepSeekCredentialStatusResponseSchema.safeParse({
        data: {
          ...publicCredentialStatus.data,
          lastConnectionTest: {
            status: 'FAILED',
            failureCode: 'NETWORK_ERROR',
            apiKey: 'ds-test-key',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('represents every provider failure category so callers retain actionable recovery guidance', () => {
    const failureCodes = [
      'AUTHENTICATION_FAILED',
      'RATE_LIMITED',
      'NETWORK_ERROR',
      'INVALID_RESPONSE',
      'PROVIDER_UNAVAILABLE',
    ] as const;

    for (const failureCode of failureCodes) {
      expect(
        deepSeekConnectionTestResultSchema.parse({ status: 'FAILED', failureCode }),
      ).toEqual({ status: 'FAILED', failureCode });
    }
  });

  it('rejects unknown failure categories so callers cannot rely on unsupported recovery guidance', () => {
    expect(
      deepSeekConnectionTestResultSchema.safeParse({
        status: 'FAILED',
        failureCode: 'UNKNOWN_ERROR',
      }).success,
    ).toBe(false);
  });

  it('rejects a failure code on success so stale errors cannot misrepresent a healthy connection', () => {
    expect(
      deepSeekConnectionTestResultSchema.safeParse({
        status: 'SUCCEEDED',
        failureCode: 'AUTHENTICATION_FAILED',
      }).success,
    ).toBe(false);
  });

  it('rejects a failed connection without its category so recovery guidance is not erased', () => {
    expect(deepSeekConnectionTestResultSchema.safeParse({ status: 'FAILED' }).success).toBe(false);
  });
});
