import { describe, expect, test } from 'bun:test';
import { findCachedPost } from '../src/lib/post-cache';

const post = (o: Record<string, unknown>) => ({ id: 'x', author: 'A', handle: '@a', url: 'https://e.example/1', paragraphs: ['hi'], ...o });

describe('a post Atlas already has, for a conversation opened from anywhere', () => {
  test('is found in any cached feed shape, preferring a copy with counts', () => {
    const thin = post({ id: 'n1', statusId: 's1' });
    const full = post({ id: 'h1', statusId: 's1', counts: { replies: 7, boosts: 1, likes: 3 } });
    const datas = [{ notices: [{ statusId: 's1' }] }, { posts: [thin] }, { pages: [{ posts: [post({ id: 'other', statusId: 's2' })] }, { posts: [full] }] }];
    expect(findCachedPost(datas, 's1')).toBe(full);
    expect(findCachedPost([{ posts: [thin] }], 's1')).toBe(thin);
  });

  test('a boost gives the post itself, not the boost', () => {
    const boost = post({ id: 'b1', statusId: 's3', boostedBy: 'Sam', counts: { replies: 0, boosts: 2, likes: 0 } });
    const found = findCachedPost([{ posts: [boost] }], 's3');
    expect(found?.statusId).toBe('s3');
    expect(found?.boostedBy).toBeUndefined();
  });

  test('placeholders, unread native cards and other posts are not used', () => {
    expect(findCachedPost([{ posts: [post({ statusId: 's4', tombstone: true })] }], 's4')).toBeUndefined();
    expect(findCachedPost([{ posts: [post({ statusId: 's4', statusRef: 's4' })] }], 's4')).toBeUndefined();
    expect(findCachedPost([{ posts: [post({ statusId: 's5' })] }], 's4')).toBeUndefined();
    expect(findCachedPost([undefined, null, 3, 'x'], 's4')).toBeUndefined();
  });

  test('the walk stays bounded on a huge or cyclic cache', () => {
    const a: Record<string, unknown> = {}; a.self = a;
    const big = { posts: Array.from({ length: 100_000 }, (_, i) => post({ id: `p${i}`, statusId: `t${i}` })) };
    const t0 = performance.now();
    findCachedPost([a, big], 'missing');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
