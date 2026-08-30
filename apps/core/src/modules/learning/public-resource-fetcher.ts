import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import {
  PublicResourceFetchError,
  type PublicDnsAnswer,
  resolvePinnedPublicUrl,
} from './public-url-policy';

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_NORMALIZED_CHARS = 24_000;
const MAX_REDIRECTS = 3;

export { PublicResourceFetchError } from './public-url-policy';

export interface PublicResourceFetchRequest {
  url: URL;
  headers: { accept: 'text/html,text/plain'; 'accept-encoding': 'identity' };
  lookup: (hostname: string, options: unknown, callback: (error: Error | null, address: string, family: 4 | 6) => void) => void;
}

export interface PublicResourceFetchResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
}

export type PublicResourceTransport = (request: PublicResourceFetchRequest) => Promise<PublicResourceFetchResponse>;

export interface NodeHttpsIncomingResponse {
  readonly statusCode?: number;
  readonly headers: Record<string, string | string[] | undefined>;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'end', listener: () => void): unknown;
}

export interface NodeHttpsOutgoingRequest {
  setTimeout(delayMilliseconds: number, callback: () => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  destroy(error: Error): unknown;
  end(): unknown;
}

export type NodeHttpsRequest = (
  options: {
    protocol: 'https:';
    hostname: string;
    port: 443;
    path: string;
    method: 'GET';
    headers: PublicResourceFetchRequest['headers'];
    lookup: PublicResourceFetchRequest['lookup'];
  },
  onHeaders: (response: NodeHttpsIncomingResponse) => void,
) => NodeHttpsOutgoingRequest;

export interface PublicResourceFetcher {
  fetch(input: { url: string; expectedContentHash?: string }): Promise<{
    canonicalUrl: string;
    publisher: string;
    mediaType: 'text/html' | 'text/plain';
    retrievedAt: string;
    contentHash: string;
    normalizedText: string;
  }>;
}

function headerValue(headers: PublicResourceFetchResponse['headers'], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(',') : value;
}

function asciiHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function parseMediaType(headers: PublicResourceFetchResponse['headers']): 'text/html' | 'text/plain' {
  const contentType = headerValue(headers, 'content-type');
  if (!contentType) throw new PublicResourceFetchError('PUBLIC_RESOURCE_MEDIA_TYPE_UNSAFE');
  const [rawMediaType, ...parameters] = contentType.split(';').map((part) => part.trim());
  if (rawMediaType !== 'text/html' && rawMediaType !== 'text/plain') {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_MEDIA_TYPE_UNSAFE');
  }
  const charset = parameters
    .map((parameter) => parameter.match(/^charset=(.+)$/i)?.[1]?.trim().replace(/^"|"$/g, '').toLowerCase())
    .find(Boolean);
  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_CHARSET_UNSAFE');
  }
  return rawMediaType;
}

function assertResponseHeaders(response: PublicResourceFetchResponse): 'text/html' | 'text/plain' {
  const encoding = headerValue(response.headers, 'content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_ENCODING_UNSAFE');
  }
  const contentLength = headerValue(response.headers, 'content-length');
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new PublicResourceFetchError('PUBLIC_RESOURCE_TOO_LARGE');
    }
  }
  return parseMediaType(response.headers);
}

export function createDefaultPublicResourceTransport(options: {
  request?: NodeHttpsRequest;
  schedule?: (callback: () => void, delayMilliseconds: number) => unknown;
  cancel?: (timer: unknown) => void;
} = {}): PublicResourceTransport {
  const request = options.request ?? (httpsRequest as unknown as NodeHttpsRequest);
  const schedule = options.schedule ?? ((callback: () => void, delayMilliseconds: number) => setTimeout(callback, delayMilliseconds));
  const cancel = options.cancel ?? ((timer: unknown) => clearTimeout(timer as NodeJS.Timeout));
  return async (input) => new Promise((resolve, reject) => {
    let settled = false;
    const requestSlot: { outgoing?: NodeHttpsOutgoingRequest } = {};
    let headerTimer: unknown;
    let totalTimer: unknown;
    let headersReceived = false;
    const clearTimers = () => {
      if (headerTimer !== undefined) {
        cancel(headerTimer);
        headerTimer = undefined;
      }
      if (totalTimer !== undefined) {
        cancel(totalTimer);
        totalTimer = undefined;
      }
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimers();
      callback();
    };
    const fail = (error: PublicResourceFetchError) => {
      requestSlot.outgoing?.destroy(error);
      finish(() => reject(error));
    };
    const requestOptions: Parameters<NodeHttpsRequest>[0] = {
      protocol: 'https:',
      hostname: asciiHostname(input.url),
      port: 443,
      path: `${input.url.pathname}${input.url.search}`,
      method: 'GET',
      headers: input.headers,
      lookup: input.lookup,
    };
    const outgoing = request(requestOptions, (incoming) => {
      headersReceived = true;
      if (headerTimer !== undefined) {
        cancel(headerTimer);
        headerTimer = undefined;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      incoming.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_RESPONSE_BYTES) {
          fail(new PublicResourceFetchError('PUBLIC_RESOURCE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.once('error', (error) => finish(() => reject(error)));
      incoming.once('end', () => finish(() => resolve({
        statusCode: incoming.statusCode ?? 0,
        headers: incoming.headers,
        body: Readable.from([Buffer.concat(chunks)]),
      })));
    });
    requestSlot.outgoing = outgoing;
    outgoing.once('error', (error) => finish(() => reject(error)));
    if (!headersReceived && !settled) {
      headerTimer = schedule(() => fail(new PublicResourceFetchError('PUBLIC_RESOURCE_TIMEOUT')), 5_000);
    }
    if (!settled) totalTimer = schedule(() => fail(new PublicResourceFetchError('PUBLIC_RESOURCE_TIMEOUT')), 15_000);
    outgoing.setTimeout(5_000, () => fail(new PublicResourceFetchError('PUBLIC_RESOURCE_TIMEOUT')));
    if (!settled) outgoing.end();
  });
}

const defaultTransport = createDefaultPublicResourceTransport();

function normalizeHtmlOrText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NORMALIZED_CHARS);
}

export function createPublicResourceFetcher(options: {
  resolveAll?: (hostname: string) => Promise<PublicDnsAnswer[]>;
  transport?: PublicResourceTransport;
  now?: () => Date;
} = {}): PublicResourceFetcher {
  const resolveAll = options.resolveAll ?? (async (hostname: string) => {
    const answers = await dnsLookup(hostname, { all: true, verbatim: true });
    return answers.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
  });
  const transport = options.transport ?? defaultTransport;
  const now = options.now ?? (() => new Date());

  return {
    async fetch(input) {
      let currentUrl = input.url;
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const { url, addresses } = await resolvePinnedPublicUrl(currentUrl, resolveAll);
        const response = await transport({
          url,
          headers: { accept: 'text/html,text/plain', 'accept-encoding': 'identity' },
          lookup(_hostname, _options, callback) {
            const pinned = addresses[0];
            if (!pinned) {
              callback(new PublicResourceFetchError('PUBLIC_RESOURCE_DNS_UNSAFE'), '', 4);
              return;
            }
            callback(null, pinned.address, pinned.family);
          },
        }).catch((error: unknown) => {
          if (error instanceof PublicResourceFetchError) throw error;
          throw new PublicResourceFetchError('PUBLIC_RESOURCE_UNAVAILABLE');
        });
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          if (redirects === MAX_REDIRECTS) throw new PublicResourceFetchError('PUBLIC_RESOURCE_REDIRECT_LIMIT');
          const location = headerValue(response.headers, 'location');
          if (!location) throw new PublicResourceFetchError('PUBLIC_RESOURCE_REDIRECT_UNSAFE');
          currentUrl = new URL(location, url).toString();
          continue;
        }
        if (response.statusCode !== 200) throw new PublicResourceFetchError('PUBLIC_RESOURCE_HTTP_STATUS');
        const mediaType = assertResponseHeaders(response);
        const chunks: Buffer[] = [];
        let byteLength = 0;
        for await (const chunk of response.body) {
          const bytes = Buffer.from(chunk);
          byteLength += bytes.byteLength;
          if (byteLength > MAX_RESPONSE_BYTES) throw new PublicResourceFetchError('PUBLIC_RESOURCE_TOO_LARGE');
          chunks.push(bytes);
        }
        const content = Buffer.concat(chunks);
        let decoded: string;
        try {
          decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
        } catch {
          throw new PublicResourceFetchError('PUBLIC_RESOURCE_CHARSET_UNSAFE');
        }
        const contentHash = createHash('sha256').update(content).digest('hex');
        if (input.expectedContentHash && input.expectedContentHash !== contentHash) {
          throw new PublicResourceFetchError('CITATION_CONTENT_CHANGED');
        }
        return {
          canonicalUrl: url.toString(),
          publisher: asciiHostname(url),
          mediaType,
          retrievedAt: now().toISOString(),
          contentHash,
          normalizedText: normalizeHtmlOrText(decoded),
        };
      }
      throw new PublicResourceFetchError('PUBLIC_RESOURCE_REDIRECT_LIMIT');
    },
  };
}
