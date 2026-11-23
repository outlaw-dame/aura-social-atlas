import { describe, expect, it } from 'bun:test';
import { allowedSpotlightItem, type SpotlightModeration } from '../src/lib/spotlight-curation';
import { collectPublicSpotlightCandidates } from '../src/lib/spotlight-personal.server';
import { fromFederatedLinkCards, fromFederatedVideos } from '../src/lib/spotlight';
import { fedizenGet } from '../src/lib/fedizen.server';

const policy: SpotlightModeration = {
  blockedHandles: [], mutedHandles: [], blockedIds: [], mutedIds: [],
  domainCoverage: 'unavailable', blockedDomains: [],
};
const preview = {
  url: 'https://example.org/public-report',
  title: 'Evidence based community report',
  description: 'An independently described report with a substantive public article summary.',
};
function status(id: string, acct: string, host = 'fedizen.net', extra: Record<string, unknown> = {}) {
  return {
    id, visibility: 'public', url: `https://fedizen.net/post/${id}`,
    account: { id: `user-${id}`, acct, url: `https://${host}/@example`, discoverable: true },
    card: preview, content: 'A useful public report',
    reblogs_count: 3, replies_count: 0, favourites_count: 1,
    ...extra,
  };
}
describe('owner-only bounded Spotlight source sampling', () => {
  it('reads one older public page if the first holds only blocked/unknown remote actors', async () => {
    let calls = 0;
    const result = await collectPublicSpotlightCandidates(
      { status: 200, data: [status('remote', 'remote@remote.example', 'remote.example')], next: 'opaque-cursor' },
      policy,
      async cursor => {
        calls++;
        expect(cursor).toBe('opaque-cursor');
        return { status: 200, data: [status('local', 'local', 'fedizen.net', {
          card: { ...preview, url: 'https://example.org/another-public-story' },
        })] };
      },
    );
    expect(calls).toBe(1);
    expect(result.pagesRead).toBe(2);
    expect(result.linked).toHaveLength(2);
    expect(result.linked.every(it => it.reason === 'recent')).toBe(true);
    const eligible = result.linked.filter(it => allowedSpotlightItem(it, policy));
    expect(eligible).toHaveLength(1);
    expect(eligible[0].url).toBe('https://example.org/another-public-story');
  });

  it('shows an eligible local source immediately, never fetching more pages', async () => {
    let calls = 0;
    const result = await collectPublicSpotlightCandidates(
      { status: 200, data: [status('one', 'local')], next: 'cursor' },
      policy,
      async () => { calls++; throw new Error('should not fetch'); },
    );
    expect(calls).toBe(0);
    expect(result.pagesRead).toBe(1);
    expect(result.linked).toHaveLength(1);
    expect(allowedSpotlightItem(result.linked[0], policy)).toBe(true);
  });

  it('does not allow private, direct, boosted, quoted or reply content from the second page', async () => {
    const second = [
      status('private', 'local', 'fedizen.net', { visibility: 'private' }),
      status('direct', 'local', 'fedizen.net', { visibility: 'direct' }),
      status('boost', 'local', 'fedizen.net', { reblog: { id: 'b' } }),
      status('quoted', 'local', 'fedizen.net', { quote: { id: 'q' } }),
      status('reply', 'local', 'fedizen.net', { in_reply_to_id: 'p' }),
      status('cw', 'local', 'fedizen.net', { spoiler_text: 'Warning' }),
      status('optout', 'local', 'fedizen.net', { account: { acct: 'local', url: 'https://fedizen.net/@local', discoverable: false } }),
      status('safe', 'local'),
    ];
    const result = await collectPublicSpotlightCandidates(
      { status: 200, data: [], next: 'opaque' },
      policy, async () => ({ status: 200, data: second }),
    );
    expect(result.posts).toHaveLength(1);
    expect(result.linked[0].sourceAccounts?.[0].handle).toBe('local');
  });

  it('does not retry on 429, 5xx, invalid cursor, or transport failure', async () => {
    let calls = 0;
    for (const next of ['cursor', 'x'.repeat(513), 'another']) {
      const result = await collectPublicSpotlightCandidates(
        { status: 200, data: [], next }, policy,
        async () => { calls++; return { status: 429, data: [] }; },
      );
      expect(result.posts).toEqual([]);
      expect(result.pagesRead).toBe(1);
    }
    expect(calls).toBe(2);
    const afterFailure = await collectPublicSpotlightCandidates(
      { status: 200, data: [], next: 'cursor' }, policy,
      async () => { throw new Error('offline'); },
    );
    expect(afterFailure.pagesRead).toBe(1);
    expect(afterFailure.linked).toEqual([]);
  });

  it('never admits a non-public first page nor fetches a continuation for it', async () => {
    const result = await collectPublicSpotlightCandidates(
      { status: 401, data: [status('private', 'local')], next: 'cursor' }, policy,
      async () => { throw new Error('should not fetch'); },
    );
    expect(result).toEqual({ posts: [], linked: [], videos: [], pagesRead: 0 });
  });

  it('accepts quality-gated link previews without images but keeps unsafe URLs out', () => {
    const linked = fromFederatedLinkCards([status('local', 'local')]);
    expect(linked).toHaveLength(1);
    expect(linked[0].image).toBeUndefined();
    expect(allowedSpotlightItem(linked[0], policy)).toBe(true);
    const malicious = fromFederatedLinkCards([status('unsafe', 'local', 'fedizen.net', {
      card: { ...preview, url: 'http://example.org/not-https' },
    })]);
    expect(malicious).toHaveLength(0);
    const video = fromFederatedVideos([status('v', 'local', 'fedizen.net', {
      card: undefined, media_attachments: [{ type: 'video', url: 'https://example.org/video.mp4', preview_url: 'https://example.org/p.jpg' }],
    })]);
    expect(video).toHaveLength(1);
  });

  it('accepts exactly the fixed public next-page route and refuses arbitrary hosts or query keys', async () => {
    const savedFetch = globalThis.fetch;
    const requested: string[] = [];
    try {
      globalThis.fetch = (async (url) => {
        requested.push(String(url));
        return Response.json([]);
      }) as typeof fetch;
      const cursor = encodeURIComponent('next:opaque%');
      const ok = await fedizenGet('spotlight-pagination-fixture', `/api/v1/timelines/public?limit=20&max_id=${cursor}`);
      expect(ok.status).toBe(200);
      expect(ok.data).toEqual([]);
      expect(requested).toEqual([`https://fedizen.net/api/v1/timelines/public?limit=20&max_id=${cursor}`]);
      await expect(fedizenGet('spotlight-pagination-fixture', '/api/v1/timelines/home?limit=999')).rejects.toThrow('Unsupported');
      await expect(fedizenGet('spotlight-pagination-fixture', '/api/v1/timelines/public?limit=20&max_id=https://evil.example')).rejects.toThrow('Unsupported');
      expect(requested).toHaveLength(1);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('does not label one sampled public source as a network trend', () => {
    const results = fromFederatedLinkCards([status('a', 'local')]);
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe('recent');
    expect(results[0].shares).toBe(1);
  });
});
