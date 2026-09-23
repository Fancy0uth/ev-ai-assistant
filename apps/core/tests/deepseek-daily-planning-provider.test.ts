import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  createDeepSeekDailyPlanningProvider,
} from '../src/modules/daily-planning/deepseek-provider';
import {
  DailyPlanningProviderTimeoutError,
} from '../src/modules/daily-planning/provider';

const input = {
  localDate: '2026-08-24',
  fixedBlocks: [],
  softBlocks: [],
  timeRequests: [],
  recoveryLevel: 'NONE' as const,
};

describe('DeepSeek Daily Planning provider', () => {
  it('uses the frozen non-streaming endpoint/model and returns only allowlisted metadata', async () => {
    let receivedBody = '';
    const provider = createDeepSeekDailyPlanningProvider({
      fetch: async (url, init) => {
        expect(url).toBe(DEEPSEEK_CHAT_COMPLETIONS_URL);
        receivedBody = init.body;
        return {
          status: 200,
          async json() {
            return {
              choices: [{ finish_reason: 'stop', message: { content: '{"schemaVersion":"DAILY_PLAN_MODEL_V1"}' } }],
              usage: {
                prompt_tokens: 11,
                completion_tokens: 7,
                total_tokens: 18,
                cache_hit_tokens: 99_999,
              },
            };
          },
        };
      },
    });

    await expect(provider.generate('test-key', input)).resolves.toEqual({
      output: { schemaVersion: 'DAILY_PLAN_MODEL_V1' },
      model: 'deepseek-v4-flash',
      finishReason: 'stop',
      usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      outputChars: '{"schemaVersion":"DAILY_PLAN_MODEL_V1"}'.length,
    });
    expect(JSON.parse(receivedBody)).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: false,
      max_tokens: 2_000,
    });
  });

  it('maps unknown finish reasons to the local allowlist rather than exposing a raw Provider value', async () => {
    const provider = createDeepSeekDailyPlanningProvider({
      fetch: async () => ({
        status: 200,
        async json() {
          return {
            choices: [{ finish_reason: 'vendor-private-value', message: { content: 'untrusted' } }],
            usage: {},
          };
        },
      }),
    });

    await expect(provider.generate('test-key', input)).resolves.toMatchObject({
      output: null,
      finishReason: 'unknown',
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
    });
  });

  it('aborts a request that has not produced headers within the policy timeout', async () => {
    const provider = createDeepSeekDailyPlanningProvider({
      headerTimeoutMs: 1,
      totalTimeoutMs: 10,
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });

    await expect(provider.generate('test-key', input)).rejects.toBeInstanceOf(
      DailyPlanningProviderTimeoutError,
    );
  });
});
