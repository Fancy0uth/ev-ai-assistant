import { createHash } from 'node:crypto';
import { PublicResourceFetchError, type PublicResourceFetcher } from './public-resource-fetcher';

// Search-generated page identities use the already approved fixed Wikipedia API.
// Arbitrary URLs continue through the generic DNS-pinned resource policy.
export function createWikipediaResourceFetcher(
  fallback: PublicResourceFetcher,
  options: { fetch?: typeof globalThis.fetch; now?: () => Date } = {},
): PublicResourceFetcher {
  const request = options.fetch ?? globalThis.fetch;
  return {
    async fetch(input) {
      const match = /^https:\/\/(en|zh)\.wikipedia\.org\/\?curid=([1-9][0-9]{0,14})$/.exec(input.url);
      if (!match) return fallback.fetch(input);
      const pageId = Number(match[2]);
      if (!Number.isSafeInteger(pageId)) return fallback.fetch(input);
      const endpoint = new URL(`https://${match[1]}.wikipedia.org/w/api.php`);
      endpoint.search = new URLSearchParams({ action: 'query', pageids: String(pageId), prop: 'extracts', explaintext: '1', exintro: '1', format: 'json', formatversion: '2' }).toString();
      const controller = new AbortController();
      let rejectTimeout: (() => void) | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        rejectTimeout = () => { controller.abort(); reject(new PublicResourceFetchError('PUBLIC_RESOURCE_TIMEOUT')); };
      });
      const timer = setTimeout(() => rejectTimeout?.(), 8_000);
      const wait = <T>(value: Promise<T>): Promise<T> => Promise.race([value, timeout]);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let response: Response | undefined;
      try {
        response = await wait(request(endpoint.toString(), { method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
          headers: { accept: 'application/json', 'user-agent': 'EV AI Assistant/0.9 (+https://github.com/Fancy0uth/ev-ai-assistant)' } }));
        if (response.status !== 200 || !response.body) throw new PublicResourceFetchError('PUBLIC_RESOURCE_HTTP_STATUS');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > 131_072)) throw new PublicResourceFetchError('PUBLIC_RESOURCE_TOO_LARGE');
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await wait(reader.read());
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 131_072) throw new PublicResourceFetchError('PUBLIC_RESOURCE_TOO_LARGE');
          chunks.push(part.value);
        }
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as {
          query?: { pages?: Array<{ pageid?: number; title?: string; extract?: string; missing?: boolean }> };
        };
        const pages = body.query?.pages;
        const page = Array.isArray(pages) && pages.length === 1 ? pages[0] : undefined;
        if (!page || page.pageid !== pageId || page.missing || typeof page.title !== 'string'
          || typeof page.extract !== 'string' || !page.extract.trim() || page.extract.length > 24_000 || page.title.length > 500) {
          throw new PublicResourceFetchError('PUBLIC_RESOURCE_UNAVAILABLE');
        }
        const normalizedText = `${page.title}\n${page.extract.trim()}`;
        const contentHash = createHash('sha256').update(normalizedText).digest('hex');
        if (input.expectedContentHash && input.expectedContentHash !== contentHash) throw new PublicResourceFetchError('CITATION_CONTENT_CHANGED');
        return { canonicalUrl: input.url, publisher: `${match[1]}.wikipedia.org`, mediaType: 'text/plain' as const,
          retrievedAt: (options.now?.() ?? new Date()).toISOString(), contentHash, normalizedText };
      } catch (error) {
        if (error instanceof PublicResourceFetchError) throw error;
        throw new PublicResourceFetchError('PUBLIC_RESOURCE_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
        controller.abort();
        try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => undefined); } catch { /* bounded cleanup */ }
        try { reader?.releaseLock(); } catch { /* canceled pending reader */ }
      }
    },
  };
}
