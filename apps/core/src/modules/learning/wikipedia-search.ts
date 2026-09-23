import { publicSearchResponseSchema } from '@ev/contracts';
import type { PublicSearchCapability } from '../providers/capabilities';
import { CAPABILITY_POLICY } from '../providers/provider-policy';

const ENGLISH_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const CHINESE_ENDPOINT = 'https://zh.wikipedia.org/w/api.php';
const MAX_RESPONSE_BYTES = 128 * 1024;
const USER_AGENT = 'EV AI Assistant/0.9 (+https://github.com/Fancy0uth/ev-ai-assistant)';

function failure(code: string): Error {
  return new Error(code);
}

function cleanupWithoutWaiting(cleanup: () => unknown): void {
  try {
    void Promise.resolve(cleanup()).catch(() => undefined);
  } catch {
    // A failed cleanup must not replace the original search failure.
  }
}

function awaitUntilAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => undefined);
    return Promise.reject(failure('WIKIPEDIA_SEARCH_TIMEOUT'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(failure('WIKIPEDIA_SEARCH_TIMEOUT'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

function cancelUnreadBody(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  cleanupWithoutWaiting(() => body.cancel());
}

async function readBoundedJson(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<unknown> {
  if (!body) throw failure('WIKIPEDIA_SEARCH_RESPONSE_INVALID');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let exhausted = false;
  try {
    while (true) {
      const next = await awaitUntilAbort(reader.read(), signal);
      if (next.done) {
        exhausted = true;
        break;
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) throw failure('WIKIPEDIA_SEARCH_RESPONSE_TOO_LARGE');
      chunks.push(next.value);
    }
  } finally {
    if (!exhausted) cleanupWithoutWaiting(() => reader.cancel());
    cleanupWithoutWaiting(() => reader.releaseLock());
  }
  const content = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as unknown;
  } catch {
    throw failure('WIKIPEDIA_SEARCH_RESPONSE_INVALID');
  }
}

function hasHanCharacter(query: string): boolean {
  return /\p{Script=Han}/u.test(query);
}

function endpointFor(query: string): URL {
  const endpoint = new URL(hasHanCharacter(query) ? CHINESE_ENDPOINT : ENGLISH_ENDPOINT);
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('list', 'search');
  endpoint.searchParams.set('srsearch', query);
  endpoint.searchParams.set('srlimit', '5');
  endpoint.searchParams.set('srprop', '');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('formatversion', '2');
  return endpoint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultUrl(hostname: string, pageId: number): string {
  const url = new URL(`https://${hostname}/`);
  url.searchParams.set('curid', String(pageId));
  return url.toString();
}

function parseResults(value: unknown, hostname: string): unknown {
  if (!isRecord(value) || !isRecord(value.query) || !Array.isArray(value.query.search) || value.query.search.length === 0) {
    throw failure('WIKIPEDIA_SEARCH_RESPONSE_INVALID');
  }
  const results = value.query.search.slice(0, 5).map((entry) => {
    if (!isRecord(entry)) {
      throw failure('WIKIPEDIA_SEARCH_RESPONSE_INVALID');
    }
    const pageId = entry.pageid;
    const rawTitle = entry.title;
    if (typeof pageId !== 'number' || !Number.isSafeInteger(pageId) || pageId <= 0 || typeof rawTitle !== 'string') {
      throw failure('WIKIPEDIA_SEARCH_RESPONSE_INVALID');
    }
    const title = rawTitle.trim();
    if (!title) throw failure('WIKIPEDIA_SEARCH_RESPONSE_INVALID');
    return {
      title,
      url: resultUrl(hostname, pageId),
      publisherHint: 'Wikipedia — public encyclopedia',
    };
  });
  const parsed = publicSearchResponseSchema.safeParse({ results });
  if (!parsed.success) throw failure('WIKIPEDIA_SEARCH_RESPONSE_INVALID');
  return parsed.data;
}

export interface WikipediaPublicSearchCapabilityOptions {
  fetch?: typeof globalThis.fetch;
}

export function createWikipediaPublicSearchCapability(
  options: WikipediaPublicSearchCapabilityOptions = {},
): PublicSearchCapability {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  return {
    descriptor: {
      providerId: 'wikipedia-public-search',
      providerLabel: 'Wikipedia 公开百科',
      adapterKind: 'PRODUCTION_ADAPTER',
    },
    async search(input) {
      const query = input.query.trim();
      if (!query || query.length > CAPABILITY_POLICY.publicSearch.maxInputChars || input.maxResults !== 5) {
        throw failure('WIKIPEDIA_SEARCH_INPUT_INVALID');
      }
      const endpoint = endpointFor(query);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CAPABILITY_POLICY.publicSearch.totalTimeoutMs);
      try {
        const response = await awaitUntilAbort(fetchRequest(endpoint.toString(), {
          method: 'GET',
          headers: { accept: 'application/json', 'user-agent': USER_AGENT },
          redirect: 'error',
          credentials: 'omit',
          signal: controller.signal,
        }), controller.signal);
        if (response.status < 200 || response.status >= 300) {
          cancelUnreadBody(response.body);
          throw failure('WIKIPEDIA_SEARCH_HTTP_STATUS');
        }
        const declaredLength = response.headers.get('content-length');
        if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
          cancelUnreadBody(response.body);
          throw failure('WIKIPEDIA_SEARCH_RESPONSE_TOO_LARGE');
        }
        const hostname = endpoint.hostname;
        return parseResults(await readBoundedJson(response.body, controller.signal), hostname);
      } catch (error) {
        if (controller.signal.aborted) throw failure('WIKIPEDIA_SEARCH_TIMEOUT');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
