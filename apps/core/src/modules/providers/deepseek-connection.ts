import type { DeepSeekConnectionTestResult } from '@ev/contracts';
import { PROVIDER_POLICY } from './provider-policy';

const DEEPSEEK_CHAT_COMPLETIONS_URL = PROVIDER_POLICY.deepSeekEndpoint;
const CONNECTION_TIMEOUT_MS = PROVIDER_POLICY.headerTimeoutMs;
const HEALTH_PROBE_BODY = JSON.stringify({
  model: 'deepseek-v4-flash',
  stream: false,
  messages: [{ role: 'user', content: 'Reply only with JSON: {"status":"ok"}.' }],
  response_format: { type: 'json_object' },
  thinking: { type: 'disabled' },
  max_tokens: 16,
});

export interface DeepSeekFetchResponse {
  status: number;
  json(): Promise<unknown>;
}

export interface DeepSeekFetchInit {
  method: 'POST';
  headers: {
    authorization: string;
    'content-type': 'application/json';
  };
  body: string;
  signal: AbortSignal;
}

export type DeepSeekFetch = (
  url: string,
  init: DeepSeekFetchInit,
) => Promise<DeepSeekFetchResponse>;

export interface DeepSeekConnectionTester {
  test(apiKey: string): Promise<DeepSeekConnectionTestResult>;
}

interface DeepSeekConnectionTesterOptions {
  fetch?: DeepSeekFetch;
  timeoutMs?: number;
}

function fetchDeepSeek(url: string, init: DeepSeekFetchInit): Promise<DeepSeekFetchResponse> {
  return fetch(url, init);
}

function failed(
  failureCode: Extract<DeepSeekConnectionTestResult, { status: 'FAILED' }>['failureCode'],
): DeepSeekConnectionTestResult {
  return { status: 'FAILED', failureCode };
}

function failureForStatus(status: number): DeepSeekConnectionTestResult | undefined {
  if (status === 401 || status === 403) return failed('AUTHENTICATION_FAILED');
  if (status === 429) return failed('RATE_LIMITED');
  if (status >= 500 && status <= 599) return failed('PROVIDER_UNAVAILABLE');
  if (status < 200 || status >= 300) return failed('INVALID_RESPONSE');
  return undefined;
}

function hasSuccessfulProbeContract(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as { choices?: unknown };
  if (!Array.isArray(response.choices) || response.choices.length !== 1) return false;

  const choice = response.choices[0];
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return false;
  if ((choice as { finish_reason?: unknown }).finish_reason !== 'stop') return false;
  const message = (choice as { message?: unknown }).message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const content = (message as { content?: unknown }).content;
  if (typeof content !== 'string' || content.length === 0) return false;

  try {
    const probe = JSON.parse(content) as unknown;
    return (
      !!probe &&
      typeof probe === 'object' &&
      !Array.isArray(probe) &&
      Object.keys(probe).length === 1 &&
      (probe as { status?: unknown }).status === 'ok'
    );
  } catch {
    return false;
  }
}

export function createDeepSeekConnectionTester(
  options: DeepSeekConnectionTesterOptions = {},
): DeepSeekConnectionTester {
  const fetchRequest = options.fetch ?? fetchDeepSeek;
  const timeoutMs = options.timeoutMs ?? CONNECTION_TIMEOUT_MS;

  return {
    async test(apiKey) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchRequest(DEEPSEEK_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: HEALTH_PROBE_BODY,
          signal: controller.signal,
        });

        const statusFailure = failureForStatus(response.status);
        if (statusFailure) return statusFailure;

        try {
          const responseBody = await response.json();
          if (controller.signal.aborted) return failed('NETWORK_ERROR');
          return hasSuccessfulProbeContract(responseBody)
            ? { status: 'SUCCEEDED' }
            : failed('INVALID_RESPONSE');
        } catch {
          return failed(controller.signal.aborted ? 'NETWORK_ERROR' : 'INVALID_RESPONSE');
        }
      } catch {
        return failed('NETWORK_ERROR');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
