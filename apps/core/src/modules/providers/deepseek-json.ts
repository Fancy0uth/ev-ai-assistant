// Shared bounded transport for new structured capabilities. Existing released
// adapters retain their own contracts; this helper does not change their policy.
export interface DeepSeekJsonOptions {
  apiKey: string;
  system: string;
  input: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxResponseBytes?: number;
  maxTokens?: number;
  image?: { mediaType: string; bytes: Readonly<Uint8Array> };
  fetch?: typeof fetch;
}

export async function requestDeepSeekJson(options: DeepSeekJsonOptions): Promise<unknown> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  if (options.signal?.aborted) throw new Error('STRUCTURED_PROVIDER_ABORTED');
  options.signal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(relayAbort, options.timeoutMs ?? 8_000);
  let rejectAborted: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = () => reject(new Error('STRUCTURED_PROVIDER_ABORTED'));
    controller.signal.addEventListener('abort', rejectAborted, { once: true });
  });
  const wait = <T>(work: Promise<T>): Promise<T> => Promise.race([work, aborted]);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let consumed = false;
  try {
    const text = JSON.stringify(options.input);
    if (typeof text !== 'string') throw new Error('STRUCTURED_PROVIDER_INPUT_INVALID');
    const content = options.image
      ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${options.image.mediaType};base64,${Buffer.from(options.image.bytes).toString('base64')}` } }]
      : text;
    const body = JSON.stringify({ model: 'deepseek-flash', stream: false,
      thinking: { type: 'disabled' }, max_tokens: options.maxTokens ?? 2_000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: options.system }, { role: 'user', content }] });
    if (Buffer.byteLength(body) > (options.maxInputBytes ?? 24_000)) throw new Error('STRUCTURED_PROVIDER_INPUT_LIMIT');
    if (controller.signal.aborted) throw new Error('STRUCTURED_PROVIDER_ABORTED');
    response = await wait((options.fetch ?? fetch)('https://api.deepseek.com/chat/completions', {
      method: 'POST', redirect: 'error', credentials: 'omit',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body, signal: controller.signal,
    }));
    if (!response.ok || !response.body) throw new Error('STRUCTURED_PROVIDER_UNAVAILABLE');
    const maximum = options.maxResponseBytes ?? 64_000;
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new Error('STRUCTURED_PROVIDER_RESPONSE_LIMIT');
    reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await wait(reader.read());
      if (chunk.done) { consumed = true; break; }
      size += chunk.value.byteLength;
      if (size > maximum) throw new Error('STRUCTURED_PROVIDER_RESPONSE_LIMIT');
      chunks.push(chunk.value);
    }
    const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const choice = envelope?.choices?.[0];
    if (!Array.isArray(envelope?.choices) || envelope.choices.length !== 1
      || choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string'
      || choice.message.tool_calls !== undefined || choice.message.function_call !== undefined) {
      throw new Error('STRUCTURED_PROVIDER_RESPONSE_INVALID');
    }
    return JSON.parse(choice.message.content);
  } catch {
    // No SDK errors, URLs, credentials or provider-returned body in diagnostics.
    throw new Error('STRUCTURED_PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', relayAbort);
    if (rejectAborted) controller.signal.removeEventListener('abort', rejectAborted);
    controller.abort();
    if (!consumed) {
      try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => undefined); } catch { /* bounded cleanup */ }
    }
    try { reader?.releaseLock(); } catch { /* pending canceled reader */ }
  }
}
