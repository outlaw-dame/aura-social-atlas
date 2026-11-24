import { describe, expect, test } from 'bun:test';
import { featuredFromCollection, featuredFromMastodon } from '../src/lib/fedi-profile';
import { featuredDetail } from '../src/lib/featured-tags';

// Invented accounts and tags.
describe("someone's featured hashtags", () => {
  test("from Mastodon's featured_tags: name, link, count (a string in Mastodon) and last use", () => {
    expect(featuredFromMastodon([
      { id: '1', name: 'Astronomy', url: 'https://example.social/@ann/tagged/astronomy', statuses_count: '24', last_status_at: '2026-11-02' },
      { id: '2', name: '#cycling', statuses_count: 3, last_status_at: null },
      { id: '3', name: 'astronomy' }, // a repeat
      { id: '4', name: 'not a tag!' },
      { id: '5', name: 'x', url: 'javascript:alert(1)', statuses_count: '-1' },
    ])).toEqual([
      { name: 'Astronomy', url: 'https://example.social/@ann/tagged/astronomy', count: 24, last: '2026-11-02' },
      { name: 'cycling', count: 3 },
      { name: 'x' },
    ]);
    expect(featuredFromMastodon({ error: 'x' })).toEqual([]);
  });
  test("from an actor's featuredTags collection: Hashtag objects only", () => {
    expect(featuredFromCollection({ type: 'Collection', items: [
      { type: 'Hashtag', name: '#Photography', href: 'https://example.social/tags/photography' },
      { type: 'Note', name: '#nope' },
      { type: 'Hashtag', name: '#photography' },
    ] })).toEqual([{ name: 'Photography', url: 'https://example.social/tags/photography' }]);
    expect(featuredFromCollection({ type: 'OrderedCollection', first: { orderedItems: [{ type: 'Hashtag', name: '#a_b' }] } })).toEqual([{ name: 'a_b' }]);
  });
  test('a tile says how often and when last, as far as the server said', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    expect(featuredDetail({ name: 'a', count: 1 }, now)).toBe('1 post');
    expect(featuredDetail({ name: 'a', count: 24, last: '2026-11-02T00:00:00Z' }, now)).toMatch(/^24 posts · last /);
    expect(featuredDetail({ name: 'a' }, now)).toBe('');
  });
});
