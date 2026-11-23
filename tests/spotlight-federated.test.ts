import { describe, expect, it } from 'bun:test';
import {
  combineSpotlight, fromFederatedVideos, fromMastodonLinks, spotlightUrlKey,
  type SpotlightItem,
} from '../src/lib/spotlight';
import { fetchFixedFedizenJson } from '../src/lib/spotlight-federated.server';

const item = (url: string, id: string): SpotlightItem => ({
  id, source: 'Bonfire', url, title: id, description: '', provider: 'example.org',
});

describe('Spotlight instance scope and honest ranking signals', () => {
  it('attributes trends to the serving Bonfire instance, never mastodon.social', () => {
    const result = fromMastodonLinks([{
      url: 'https://example.org/article', title: 'Article', history: [{ uses: '3' }],
      authors: [{ name: 'Writer', account: { acct: 'writer', url: 'https://fedizen.net/@writer' } }],
    }], { source: 'Bonfire', observedBy: 'fedizen.net' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: 'Bonfire', observedBy: 'fedizen.net', kind: 'link',
      reason: 'trending', shares: 3,
    });
    expect(result[0].authorAccount?.acct).toBe('@writer@fedizen.net');
  });

  it('does not infer unique talkers from Bonfire synthetic history', () => {
    const result = fromMastodonLinks([{
      url: 'https://example.org/news', title: 'News',
      history: [{ uses: '5' }, { uses: '-2' }, { uses: 'bad' }],
    }], { source: 'Bonfire' });
    expect(result[0].shares).toBe(5);
    expect(result[0]).not.toHaveProperty('uniquePeople');
  });

  it('discards malformed or unsafe preview cards without crashing', () => {
    const result = fromMastodonLinks([
      null, false, { url: 'https://example.org/ok', title: 'OK', authors: 'not-array', history: 'bad' },
      { url: 'http://localhost/private', title: 'No' },
      { url: 'https://example.org/missing' }, { title: 'No URL' },
    ] as never, { source: 'Bonfire' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('OK');
  });

  it('does not infer podcasts from generic attached media or keywords', () => {
    const result = fromFederatedVideos([
      { id: 'audio', url: 'https://fedizen.net/post/audio', visibility: 'public',
        content: 'My podcast', media_attachments: [{ type: 'audio', url: 'https://cdn.example.org/audio.mp3' }] },
      { id: 'video', url: 'https://fedizen.net/post/video', visibility: 'public',
        content: 'A video', media_attachments: [{ type: 'video', url: 'https://cdn.example.org/video.mp4', preview_url: 'https://cdn.example.org/poster.jpg' }] },
      { id: 'private', url: 'https://fedizen.net/post/private', visibility: 'private',
        content: 'Hidden', media_attachments: [{ type: 'video', url: 'https://cdn.example.org/secret.mp4' }] },
      { id: 'direct', url: 'https://fedizen.net/post/direct', visibility: 'direct',
        content: 'Hidden', media_attachments: [{ type: 'video', url: 'https://cdn.example.org/secret.mp4' }] },
      { id: 'cw', url: 'https://fedizen.net/post/cw', visibility: 'public',
        spoiler_text: 'Sensitive', content: 'Hidden', media_attachments: [{ type: 'video', url: 'https://cdn.example.org/cw.mp4' }] },
      { id: 'sensitive', url: 'https://fedizen.net/post/sensitive', visibility: 'public',
        sensitive: true, content: 'Hidden', media_attachments: [{ type: 'video', url: 'https://cdn.example.org/sensitive.mp4' }] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'video', reason: 'recent', observedBy: 'fedizen.net' });
    expect(result[0].url).toBe('https://fedizen.net/post/video');
  });

  it('deduplicates safe tracking aliases but preserves meaningful query arguments', () => {
    expect(spotlightUrlKey('https://example.org/post?ref=article&utm_source=atlas#comments'))
      .toBe(spotlightUrlKey('https://example.org/post?ref=article'));
    expect(spotlightUrlKey('https://example.org/post?ref=other')).not.toBe(spotlightUrlKey('https://example.org/post?ref=article'));
    expect(spotlightUrlKey('http://example.org/post')).toBeNull();
    expect(combineSpotlight(
      [item('https://example.org/post?utm_source=one', 'trending')],
      [item('https://example.org/post', 'recent'), item('https://example.org/other', 'other')],
    ).map(x => x.id)).toEqual(['trending', 'other']);
  });
});

describe('bounded Fedizen public REST transport', () => {
  it('uses only fixed Fedizen paths without credentials or redirects', async () => {
    let called = 0;
    const mock: typeof fetch = async (url, init) => {
      called++;
      expect(url).toBe('https://fedizen.net/api/v1/trends/links?limit=12');
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('manual');
      expect(JSON.stringify(init?.headers)).not.toContain('authorization');
      return Response.json([{ url: 'https://example.org/article' }]);
    };
    expect(await fetchFixedFedizenJson('trends', mock)).toHaveLength(1);
    expect(called).toBe(1);
  });

  it('rejects HTTP redirects, wrong content types, huge bodies and non-array shapes', async () => {
    const make = (response: Response): typeof fetch => async () => response;
    expect(await fetchFixedFedizenJson('trends', make(new Response('redirect', { status: 302, headers: { location: 'https://attacker.example' } })))).toEqual([]);
    expect(await fetchFixedFedizenJson('trends', make(new Response('html', { headers: { 'content-type': 'text/html' } })))).toEqual([]);
    expect(await fetchFixedFedizenJson('trends', make(Response.json({ items: [] })))).toEqual([]);
    expect(await fetchFixedFedizenJson('trends', make(new Response('x', { headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) } })))).toEqual([]);
    expect(await fetchFixedFedizenJson('trends', make(Response.json(['x'.repeat(1024 * 1024 + 20)])))).toEqual([]);
  });

  it('never enables anonymous federated public reads in a shared cache', async () => {
    let requests = 0;
    const mock: typeof fetch = async () => { requests++; return Response.json([]); };
    expect(await fetchFixedFedizenJson('federated' as never, mock)).toEqual([]);
    expect(requests).toBe(0);
  });
});
