import {
  deepSeekFinishReasonSchema,
  deepSeekModelSchema,
  deepSeekUsageSchema,
  type DeepSeekFinishReason,
  type DeepSeekModel,
  type DeepSeekUsage,
} from '@ev/contracts';
import { PROVIDER_POLICY } from '../providers/provider-policy';
import {
  DailyPlanningProviderModelOutputError,
  DailyPlanningProviderQuotaError,
  DailyPlanningProviderTimeoutError,
  DailyPlanningProviderUnavailableError,
  type DailyPlanningProvider,
  type DailyPlanningProviderInput,
  type DailyPlanningProviderResult,
} from './provider';

export const DEEPSEEK_CHAT_COMPLETIONS_URL = PROVIDER_POLICY.deepSeekEndpoint;
export const DEFAULT_DEEPSEEK_MODEL: DeepSeekModel = 'deepseek-v4-flash';
const SYSTEM_PROMPT = [
  'Return exactly one JSON object and no markdown.',
  'The object must match this schema:',
  '{"schemaVersion":"DAILY_PLAN_MODEL_V1","summary":"non-empty string up to 800 characters","actions":[{"operation":"SCHEDULE_TIME_REQUEST","contextRef":"TIME_REQUEST_N","startLocalTime":"HH:MM","endLocalTime":"HH:MM","rationale":"non-empty string up to 400 characters"}|{"operation":"MARK_TIME_REQUEST_UNSCHEDULABLE","contextRef":"TIME_REQUEST_N","reasonCode":"HARD_EVENT_CONFLICT|OUTSIDE_AVAILABILITY|INSUFFICIENT_TIME|CAPACITY_LIMIT","rationale":"non-empty string up to 240 characters"}]}.',
  'Use each contextRef at most once. Schedule only supplied contextRef values.',
].join(' ');

export interface DeepSeekDailyPlanningFetchResponse {
  status: number;
  json(): Promise<unknown>;
}

export interface DeepSeekDailyPlanningFetchInit {
  method: 'POST';
  headers: {
    authorization: string;
    'content-type': 'application/json';
  };
  body: string;
  signal: AbortSignal;
}

export type DeepSeekDailyPlanningFetch = (
  url: string,
  init: DeepSeekDailyPlanningFetchInit,
) => Promise<DeepSeekDailyPlanningFetchResponse>;

export interface DeepSeekDailyPlanningProviderOptions {
  fetch?: DeepSeekDailyPlanningFetch;
  model?: DeepSeekModel;
  headerTimeoutMs?: number;
  totalTimeoutMs?: number;
}

function fetchDeepSeek(
  url: string,
  init: DeepSeekDailyPlanningFetchInit,
): Promise<DeepSeekDailyPlanningFetchResponse> {
  return fetch(url, init);
}

function unavailable(): DailyPlanningProviderUnavailableError {
  return new DailyPlanningProviderUnavailableError();
}

function usageFrom(response: Record<string, unknown>): DeepSeekUsage {
  const raw = response.usage;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  const usage = raw as Record<string, unknown>;
  const value = (key: 'prompt_tokens' | 'completion_tokens' | 'total_tokens'): number | null => {
    const candidate = usage[key];
    return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0
      ? candidate
      : null;
  };
  return deepSeekUsageSchema.parse({
    promptTokens: value('prompt_tokens'),
    completionTokens: value('completion_tokens'),
    totalTokens: value('total_tokens'),
  });
}

function parsedResult(response: unknown, model: DeepSeekModel): DailyPlanningProviderResult {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw unavailable();
  const object = response as Record<string, unknown>;
  const choices = object.choices;
  if (!Array.isArray(choices) || choices.length !== 1) throw unavailable();
  const choice = choices[0];
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) throw unavailable();
  const choiceObject = choice as Record<string, unknown>;
  const finishReason: DeepSeekFinishReason = deepSeekFinishReasonSchema.safeParse(
    choiceObject.finish_reason,
  ).success
    ? (choiceObject.finish_reason as DeepSeekFinishReason)
    : 'unknown';
  const message = choiceObject.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw unavailable();
  const content = (message as Record<string, unknown>).content;

  if (finishReason !== 'stop') {
    return {
      output: null,
      model,
      finishReason,
      usage: usageFrom(object),
      outputChars: typeof content === 'string' ? content.length : 0,
    };
  }
  if (typeof content !== 'string' || content.length === 0) throw unavailable();
  try {
    return {
      output: JSON.parse(content) as unknown,
      model,
      finishReason,
      usage: usageFrom(object),
      outputChars: content.length,
    };
  } catch {
    throw new DailyPlanningProviderModelOutputError();
  }
}

function requestBody(input: DailyPlanningProviderInput, model: DeepSeekModel): string {
  return JSON.stringify({
    model,
    stream: false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(input) },
    ],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    max_tokens: PROVIDER_POLICY.maxCompletionTokens,
  });
}

export function createDeepSeekDailyPlanningProvider(
  options: DeepSeekDailyPlanningProviderOptions = {},
): DailyPlanningProvider {
  const fetchRequest = options.fetch ?? fetchDeepSeek;
  const model = deepSeekModelSchema.parse(options.model ?? DEFAULT_DEEPSEEK_MODEL);
  const headerTimeoutMs = options.headerTimeoutMs ?? PROVIDER_POLICY.headerTimeoutMs;
  const totalTimeoutMs = options.totalTimeoutMs ?? PROVIDER_POLICY.totalTimeoutMs;

  return {
    async generate(apiKey, input) {
      const controller = new AbortController();
      let headerTimedOut = false;
      let totalTimedOut = false;
      const headerTimer = setTimeout(() => {
        headerTimedOut = true;
        controller.abort();
      }, headerTimeoutMs);
      const totalTimer = setTimeout(() => {
        totalTimedOut = true;
        controller.abort();
      }, totalTimeoutMs);

      try {
        const response = await fetchRequest(DEEPSEEK_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: requestBody(input, model),
          signal: controller.signal,
        });
        clearTimeout(headerTimer);
        if (response.status === 429) throw new DailyPlanningProviderQuotaError();
        if (response.status < 200 || response.status >= 300 || controller.signal.aborted) {
          throw unavailable();
        }
        const result = parsedResult(await response.json(), model);
        if (controller.signal.aborted) throw new DailyPlanningProviderTimeoutError();
        return result;
      } catch (error) {
        if (
          error instanceof DailyPlanningProviderUnavailableError ||
          error instanceof DailyPlanningProviderModelOutputError ||
          error instanceof DailyPlanningProviderQuotaError ||
          error instanceof DailyPlanningProviderTimeoutError
        ) {
          throw error;
        }
        if (headerTimedOut || totalTimedOut || controller.signal.aborted) {
          throw new DailyPlanningProviderTimeoutError();
        }
        throw unavailable();
      } finally {
        clearTimeout(headerTimer);
        clearTimeout(totalTimer);
      }
    },
  };
}
