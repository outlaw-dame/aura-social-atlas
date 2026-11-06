import { describe, expect, test } from 'bun:test';
import { normalizeDiscoveryItem } from '../src/lib/discovery-gateway';

const base = {
  id: 'https://posts.example/notes/1',
  url: 'https://posts.example/notes/1',
  text: 'Open web content',
  origin: 'posts.example',
  hashtags: ['openweb', 'fedi'],
  publishedAt: '2026-11-06T21:00:00Z',
  ingestedAt: '2026-11-06T21:05:00Z',
  via: 'https://relay.example/tag/openweb',
  summary: null,
  author: { name: 'Example', handle: '@example@posts.example', url: 'https://posts.example/@example', id: 'https://posts.example/users/example' },
};

describe('untrusted discovery API response boundary', () => {
  test('valid post remains render-safe and keeps attribution', () => {
    const item = normalizeDiscoveryItem(base);
    expect(item?.hashtags).toEqual(['openweb', 'fedi']);
    expect(item?.author?.id).toBe(base.author.id);
  });
  test('legacy JSONB-string and malformed hashtags cannot crash rendering', () => {
    for (const value of ['["old","tags"]', 'not-json', { unsafe: true }, null, 123]) {
      const item = normalizeDiscoveryItem({ ...base, hashtags: value });
      expect(item?.hashtags).toEqual([]);
      expect(() => item?.hashtags.slice(0, 8).map(tag => '#' + tag)).not.toThrow();
    }
  });
  test('filters non-string tag members and limits count and size', () => {
    const item = normalizeDiscoveryItem({ ...base, hashtags: [
      'valid', 123, null, 'x'.repeat(101), ...Array.from({ length: 100 }, (_, i) => 'tag' + i),
    ] });
    expect(item?.hashtags.length).toBe(64);
    expect(item?.hashtags[0]).toBe('valid');
  });
  test('rejects malformed items and normalizes optional author values', () => {
    for (const value of [null, [], 'string', { ...base, id: 17 }, { ...base, origin: null }]) {
      expect(normalizeDiscoveryItem(value)).toBeNull();
    }
    const item = normalizeDiscoveryItem({ ...base, author: { name: [], id: 123 } });
    expect(item?.author).toEqual({ name: null, handle: null, url: null, id: null });
  });
});
