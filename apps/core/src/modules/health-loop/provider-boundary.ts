import { canonicalJson } from './repository';

export const V07_PROVIDER_DEADLINE_MS = 8_000;
export const V07_PROVIDER_MAX_INPUT_BYTES = 24_000;
export const V07_PROVIDER_MAX_OUTPUT_BYTES = 12_000;

export class V07ProviderBoundaryError extends Error {
  constructor(
    readonly kind: 'UNAVAILABLE' | 'INVALID_RESPONSE',
    readonly inputBytes: number | null = null,
    readonly outputBytes: number | null = null,
  ) {
    super(kind);
    this.name = 'V07ProviderBoundaryError';
  }
}

export interface V07ProviderBoundaryResult<T> {
  value: T;
  inputBytes: number;
  outputBytes: number;
}

export function canonicalUtf8Size(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).length;
}

export async function executeV07ProviderBoundary<TInput, TOutput>(options: {
  input: TInput;
  invoke: (input: TInput, signal: AbortSignal) => Promise<unknown>;
  parseOutput: (output: unknown) => TOutput;
  correlateOutput?: (output: TOutput, input: TInput) => void;
}): Promise<V07ProviderBoundaryResult<TOutput>> {
  let inputBytes: number;
  try {
    inputBytes = canonicalUtf8Size(options.input);
  } catch {
    throw new V07ProviderBoundaryError('INVALID_RESPONSE');
  }
  if (inputBytes > V07_PROVIDER_MAX_INPUT_BYTES) {
    throw new V07ProviderBoundaryError('INVALID_RESPONSE', inputBytes);
  }

  const controller = new AbortController();
  let providerCall: Promise<unknown>;
  try {
    providerCall = options.invoke(options.input, controller.signal);
  } catch {
    throw new V07ProviderBoundaryError('UNAVAILABLE', inputBytes);
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new V07ProviderBoundaryError('UNAVAILABLE', inputBytes));
    }, V07_PROVIDER_DEADLINE_MS);
  });

  let rawOutput: unknown;
  try {
    rawOutput = await Promise.race([providerCall, deadline]);
  } catch (error) {
    if (error instanceof V07ProviderBoundaryError) throw error;
    throw new V07ProviderBoundaryError('UNAVAILABLE', inputBytes);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }

  let outputBytes: number;
  try {
    outputBytes = canonicalUtf8Size(rawOutput);
  } catch {
    throw new V07ProviderBoundaryError('INVALID_RESPONSE', inputBytes);
  }
  if (outputBytes > V07_PROVIDER_MAX_OUTPUT_BYTES) {
    throw new V07ProviderBoundaryError('INVALID_RESPONSE', inputBytes, outputBytes);
  }

  try {
    const value = options.parseOutput(rawOutput);
    options.correlateOutput?.(value, options.input);
    return { value, inputBytes, outputBytes };
  } catch {
    throw new V07ProviderBoundaryError('INVALID_RESPONSE', inputBytes, outputBytes);
  }
}
