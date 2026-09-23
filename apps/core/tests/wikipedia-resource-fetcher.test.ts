import { createHash } from 'node:crypto';
import { it, expect, vi } from 'vitest';
import { createWikipediaResourceFetcher } from '../src/modules/learning/wikipedia-resource-fetcher';
it('reads a fixed Wikipedia page with stable provenance and rejects changed, redirected or oversized sources without relaxing arbitrary URL policy', async () => {
 const fallback = { fetch: vi.fn(async () => { throw new Error('PUBLIC_RESOURCE_DNS_UNSAFE'); }) };
 const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({query:{pages:[{pageid:157093,title:'Dot product',extract:'The dot product is a scalar operation.'}]}}),{status:200}));
 const fetcher=createWikipediaResourceFetcher(fallback,{fetch:request});
 const result=await fetcher.fetch({url:'https://en.wikipedia.org/?curid=157093'});
 expect(result.canonicalUrl).toBe('https://en.wikipedia.org/?curid=157093');expect(result.publisher).toBe('en.wikipedia.org');expect(result.normalizedText).toContain('scalar operation');
 expect(result.contentHash).toBe(createHash('sha256').update('Dot product\nThe dot product is a scalar operation.').digest('hex'));
 expect(new URL(String(request.mock.calls[0]?.[0])).pathname).toBe('/w/api.php');expect(request.mock.calls[0]?.[1]).toMatchObject({redirect:'error',credentials:'omit'});
 await expect(fetcher.fetch({url:result.canonicalUrl,expectedContentHash:'a'.repeat(64)})).rejects.toMatchObject({code:'CITATION_CONTENT_CHANGED'});
 for(const url of ['https://en.wikipedia.org/?curid=157093&url=http://127.0.0.1','https://evil.test/?curid=157093','https://en.wikipedia.org/wiki/Test']) await expect(fetcher.fetch({url})).rejects.toThrow('PUBLIC_RESOURCE_DNS_UNSAFE');
 expect(fallback.fetch).toHaveBeenCalledTimes(3);
 request.mockImplementationOnce(async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1'}}));await expect(fetcher.fetch({url:result.canonicalUrl})).rejects.toMatchObject({code:'PUBLIC_RESOURCE_HTTP_STATUS'});
 request.mockImplementationOnce(async()=>new Response('x'.repeat(150000)));await expect(fetcher.fetch({url:result.canonicalUrl})).rejects.toMatchObject({code:'PUBLIC_RESOURCE_TOO_LARGE'});
});
