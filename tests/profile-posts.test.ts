import { describe, expect, test } from 'bun:test';
import { mergeProfilePosts } from '../src/lib/profile-posts';
import { postsFromOutbox, type FediProfilePost } from '../src/lib/fedi-profile';
import type { FedizenPost } from '../src/lib/fedizen-feed';

// Invented accounts and posts.
const fz = (id: string, date: string, uri?: string): FedizenPost => ({ id, statusId: id, author: 'Ann', handle: '@ann@example.social', paragraphs: ['hi'], url: `https://fedizen.net/post/${id}`, ...(uri ? { uri } : {}), date });
const og = (id: string, date: string): FediProfilePost => ({ id: `https://example.social/users/ann/statuses/${id}`, url: `https://example.social/@ann/${id}`, date, paragraphs: ['hi'] });

describe('a profile: Fedizen first, its own server for what Fedizen lacks', () => {
  test('a post Fedizen has is shown once, as the Fedizen card (matched by ActivityPub id)', () => {
    const items = mergeProfilePosts([fz('1', '2026-11-20T10:00:00Z', 'https://example.social/users/ann/statuses/a')], [og('a', '2026-11-20T10:00:00Z')], false);
    expect(items.map(x => x.kind)).toEqual(['fedizen']);
  });
  test("the newest posts Fedizen hasn't received yet come first, read-only", () => {
    const items = mergeProfilePosts([fz('1', '2026-11-20T10:00:00Z')], [og('new', '2026-11-24T10:00:00Z')], true);
    expect(items.map(x => `${x.kind}:${x.post.id}`)).toEqual(['origin:https://example.social/users/ann/statuses/new', 'fedizen:1']);
  });
  test('origin posts older than what Fedizen loaded wait while Fedizen has more pages', () => {
    const fedizen = [fz('1', '2026-11-20T10:00:00Z')], origin = [og('old', '2026-11-01T10:00:00Z')];
    expect(mergeProfilePosts(fedizen, origin, true).map(x => x.kind)).toEqual(['fedizen']);
    expect(mergeProfilePosts(fedizen, origin, false).map(x => x.kind)).toEqual(['fedizen', 'origin']);
  });
  test('a post listed twice shows once (no two list items share a key)', () => {
    expect(mergeProfilePosts([fz('1', '2026-11-20T10:00:00Z'), fz('1', '2026-11-20T10:00:00Z')], [og('a', '2026-11-01T10:00:00Z'), og('a', '2026-11-01T10:00:00Z')], false)).toHaveLength(2);
  });
  test('with nothing on Fedizen, every origin post shows', () => {
    expect(mergeProfilePosts([], [og('a', '2026-11-01T10:00:00Z'), og('b', '2026-11-02T10:00:00Z')], false).map(x => x.post.id.slice(-1))).toEqual(['b', 'a']);
  });
});

describe("an origin post's counts", () => {
  const actor = 'https://example.social/users/ann';
  const page = (o: Record<string, unknown>) => ({ orderedItems: [{ type: 'Create', to: ['https://www.w3.org/ns/activitystreams#Public'], object: {
    id: `${actor}/statuses/1`, type: 'Note', attributedTo: actor, to: ['https://www.w3.org/ns/activitystreams#Public'], content: '<p>hi</p>', ...o } }] });
  test("read from the post's replies, shares and likes collections", () => {
    const [p] = postsFromOutbox(page({ replies: { type: 'Collection', totalItems: 3 }, shares: { totalItems: 5 }, likes: { totalItems: 12 } }), actor);
    expect(p.counts).toEqual({ replies: 3, boosts: 5, likes: 12 });
  });
  test('left out when the server gives none, and nonsense ignored', () => {
    expect(postsFromOutbox(page({}), actor)[0].counts).toBeUndefined();
    expect(postsFromOutbox(page({ likes: { totalItems: -1 }, shares: { totalItems: 'x' } }), actor)[0].counts).toBeUndefined();
  });
});

describe("someone's statuses on Fedizen", () => {
  test('the first page and older pages are allowed reads; other queries are not', async () => {
    const { fedizenGet } = await import('../src/lib/fedizen.server');
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response('[]')) as unknown as typeof fetch;
    try {
      expect((await fedizenGet('t', '/api/v1/accounts/01ABC/statuses?limit=20')).status).toBe(200);
      expect((await fedizenGet('t', '/api/v1/accounts/01ABC/statuses?limit=20&max_id=g3QAAA%2Bx')).status).toBe(200);
      await expect(fedizenGet('t', '/api/v1/accounts/01ABC/statuses?limit=20&pinned=true')).rejects.toThrow('Unsupported Fedizen read path.');
    } finally { globalThis.fetch = real; }
  });
});
