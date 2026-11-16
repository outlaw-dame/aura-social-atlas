import { afterEach, describe, expect, test } from 'bun:test';
import { appendOlder, CHECK_MAX, CHECK_MIN, clearHomeCache, newerThan, nextCheckDelay, readHomeCache, writeHomeCache } from '../src/lib/home-timeline';

const p = (id: string, mins: number) => ({ id, date: new Date(Date.UTC(2026, 10, 16, 10, mins)).toISOString() });

describe('keeping Home fresh', () => {
  test('new posts are the ones not shown yet, newer than the top', () => {
    const shown = [p('c', 30), p('b', 20), p('a', 10)];
    expect(newerThan(shown, [p('e', 50), p('d', 40), p('c', 30), p('b', 20)])).toEqual({ fresh: [p('e', 50), p('d', 40)], gap: false });
    expect(newerThan(shown, [p('c', 30), p('b', 20)])).toEqual({ fresh: [], gap: false });
  });
  test('an old post surfacing later (a boost of something old) isn’t counted as new', () => {
    expect(newerThan([p('c', 30)], [p('old', 5), p('c', 30)]).fresh).toEqual([]);
  });
  test('no overlap at all means posts in between weren’t loaded', () => {
    expect(newerThan([p('a', 10)], [p('z', 90), p('y', 80)])).toEqual({ fresh: [p('z', 90), p('y', 80)], gap: true });
  });
  test('older pages append without repeats', () => {
    expect(appendOlder([p('c', 30), p('b', 20)], [p('b', 20), p('a', 10)]).map(x => x.id)).toEqual(['c', 'b', 'a']);
  });
  test('checks slow down while nothing happens and speed up again', () => {
    expect(nextCheckDelay(CHECK_MIN, false, false)).toBe(45_000);
    expect(nextCheckDelay(200_000, false, false)).toBe(CHECK_MAX);
    expect(nextCheckDelay(CHECK_MAX, true, false)).toBe(CHECK_MIN);
    expect(nextCheckDelay(CHECK_MAX, false, true)).toBe(CHECK_MIN);
  });
});

describe('Home kept on the device', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  afterEach(() => store.clear());
  test('read back for the same person, within 6 hours', () => {
    writeHomeCache('u1', { posts: [1] }, 1000);
    expect(readHomeCache('u1', 2000)?.data).toEqual({ posts: [1] });
    expect(readHomeCache('u2', 2000)).toBeNull();
    expect(readHomeCache('u1', 1000 + 7 * 3_600_000)).toBeNull();
  });
  test('cleared on disconnect or sign-out; junk is ignored', () => {
    writeHomeCache('u1', { posts: [] }, 1000);
    clearHomeCache('u1');
    expect(readHomeCache('u1', 1000)).toBeNull();
    store.set('atlas-home:u1', '{nope');
    expect(readHomeCache('u1', 1000)).toBeNull();
  });
});

describe('Fedizen pages and image sizes', () => {
  test('Link header cursors are read only from Fedizen’s own links', async () => {
    const { pageCursors } = await import('../src/lib/fedizen.server');
    expect(pageCursors('<https://fedizen.net/api/v1/timelines/home?max_id=g3QAAAAB&limit=20>; rel="next", <https://fedizen.net/api/v1/timelines/home?min_id=g3QAAAAA&limit=20>; rel="prev"'))
      .toEqual({ next: 'g3QAAAAB', prev: 'g3QAAAAA' });
    expect(pageCursors('<https://evil.example/api/v1/timelines/home?max_id=x>; rel="next"')).toEqual({});
    expect(pageCursors('<https://fedizen.net/api/v1/timelines/home?max_id=a%20b%3Cc>; rel="next"').next).toBe('a b<c');
    expect(pageCursors(null)).toEqual({});
  });
  test('an older page is an allowed read; anything else in the query is not', async () => {
    const { fedizenGet } = await import('../src/lib/fedizen.server');
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response('[]', { headers: { link: '<https://fedizen.net/api/v1/timelines/home?max_id=NEXT>; rel="next"' } })) as unknown as typeof fetch;
    try {
      expect(await fedizenGet('t', '/api/v1/timelines/home?limit=20&max_id=g3QAAA%2Bx')).toEqual({ status: 200, data: [], next: 'NEXT' });
      await expect(fedizenGet('t', '/api/v1/timelines/home?limit=20&max_id=a&local=true')).rejects.toThrow('Unsupported Fedizen read path.');
    } finally { globalThis.fetch = real; }
  });
  test('image sizes come from media meta, original first, and nonsense is ignored', async () => {
    const { imageSizeOf } = await import('../src/lib/fedizen-feed');
    expect(imageSizeOf({ original: { width: 1600, height: 900 }, small: { width: 400, height: 225 } })).toEqual({ w: 1600, h: 900 });
    expect(imageSizeOf({ small: { width: 400, height: 300 } })).toEqual({ w: 400, h: 300 });
    expect(imageSizeOf({ original: { width: 0, height: 900 } })).toBeUndefined();
    expect(imageSizeOf({ original: { width: 10000, height: 10 } })).toBeUndefined();
    expect(imageSizeOf(null)).toBeUndefined();
  });
});
