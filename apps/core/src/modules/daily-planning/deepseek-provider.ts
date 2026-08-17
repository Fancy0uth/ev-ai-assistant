import {
  DailyPlanningProviderModelOutputError,
  DailyPlanningProviderUnavailableError,
  type DailyPlanningProvider,
  type DailyPlanningProviderInput,
} from './provider';

const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const REQUEST_TIMEOUT_MS = 5_000;
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
  timeoutMs?: number;
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

function assistantContent(response: unknown): string {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw unavailable();
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) throw unavailable();

  const choice = choices[0];
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) throw unavailable();
  const message = (choice as { message?: unknown }).message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw unavailable();
  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string' || content.length === 0) throw unavailable();
  return content;
}

function requestBody(input: DailyPlanningProviderInput): string {
  return JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(input) },
    ],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    max_tokens: 2_000,
  });
}

export function createDeepSeekDailyPlanningProvider(
  options: DeepSeekDailyPlanningProviderOptions = {},
): DailyPlanningProvider {
  const fetchRequest = options.fetch ?? fetchDeepSeek;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return {
    async generate(apiKey, input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchRequest(DEEPSEEK_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: requestBody(input),
          signal: controller.signal,
        });
        if (response.status < 200 || response.status >= 300 || controller.signal.aborted) {
          throw unavailable();
        }

        const content = assistantContent(await response.json());
        if (controller.signal.aborted) throw unavailable();
        try {
          return JSON.parse(content) as unknown;
        } catch {
          throw new DailyPlanningProviderModelOutputError();
        }
      } catch (error) {
        if (
          error instanceof DailyPlanningProviderUnavailableError ||
          error instanceof DailyPlanningProviderModelOutputError
        ) {
          throw error;
        }
        throw unavailable();
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
