import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { KEPT_FEEDS, clearKeptFeeds, readKeptFeed, writeKeptFeed } from '../src/lib/kept-feeds';
import { CACHE_MAX_AGE } from '../src/lib/home-timeline';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
});

describe('For You and Local kept on this device', () => {
  test('read back for the same account only, marked as a copy, until 6 h', () => {
    writeKeptFeed('u1', 'foryou', { posts: [{ id: 'a' }], next: { home: 'x' } }, 1000);
    expect(readKeptFeed('u1', 'foryou', 2000)).toEqual({ data: { posts: [{ id: 'a' }], next: { home: 'x' }, kept: true }, savedAt: 1000 });
    expect(readKeptFeed('u2', 'foryou', 2000)).toBeNull();
    expect(readKeptFeed('u1', 'local', 2000)).toBeNull();
    expect(readKeptFeed('u1', 'foryou', 1000 + CACHE_MAX_AGE + 1)).toBeNull();
    expect(readKeptFeed('u1', 'foryou', 500)).toBeNull();
  });

  test('a copy is never written back with its mark, and an oversized feed is not kept', () => {
    writeKeptFeed('u1', 'local', { posts: [], kept: true }, 1000);
    expect(JSON.parse(store.get('atlas-feed:local:u1')!).data).toEqual({ posts: [] });
    writeKeptFeed('u1', 'local', { posts: ['x'.repeat(KEPT_FEEDS.local)] }, 1000);
    expect(store.has('atlas-feed:local:u1')).toBe(false);
  });

  test('another shape version or broken JSON reads as nothing', () => {
    store.set('atlas-feed:foryou:u1', JSON.stringify({ v: 0, savedAt: 1000, data: { posts: [] } }));
    expect(readKeptFeed('u1', 'foryou', 2000)).toBeNull();
    store.set('atlas-feed:foryou:u1', '{');
    expect(readKeptFeed('u1', 'foryou', 2000)).toBeNull();
  });

  test('forgotten with Home on sign-out, account switch and disconnect', () => {
    writeKeptFeed('u1', 'foryou', { posts: [] }, 1000); writeKeptFeed('u1', 'local', { posts: [] }, 1000);
    clearKeptFeeds('u1');
    expect(store.size).toBe(0);
    for (const f of ['src/components/social/AuthState.tsx', 'src/components/social/useFedizen.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src.match(/clearHomeCache\(/g)?.length).toBe(src.match(/clearKeptFeeds\(/g)?.length);
    }
  });

  test('older pages wait for the fresh read, not the copy', () => {
    const src = readFileSync('src/components/social/useFeeds.ts', 'utf8');
    expect(src).toMatch(/!d\.error && !\(d as \{ kept\?: true \}\)\.kept\);/);
    expect(src).toMatch(/!q\.data\.error && !\(q\.data as \{ kept\?: true \}\)\.kept\);/);
  });
});

describe('older posts load on their own', () => {
  test('the end is watched in the scrolling box, three screens ahead, and checked again after each page', () => {
    const src = readFileSync('src/components/social/useOlderPages.ts', 'utf8');
    expect(src).toMatch(/export const LOOKAHEAD_SCREENS = 3;/);
    expect(src).toMatch(/const root = scrollRootOf\(el\);/);
    expect(src).toMatch(/useEffect\(\(\) => \{ if \(active && near\.current\) loadMore\(\); \}, \[active, loadMore\]\);/);
  });

  test('no feed or profile ends on a "Load older posts" button while it can load on its own', () => {
    for (const f of ['src/components/social/OlderPosts.tsx', 'src/components/f7/MobileOlderPosts.tsx', 'src/components/social/FedizenFeed.tsx', 'src/components/f7/FedizenMobile.tsx', 'src/components/social/FediProfileDialog.tsx', 'src/components/f7/FediProfile.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/Load older posts|Load more posts/);
      expect(src).toMatch(/Older(Footer)? |OlderFooter|MobileOlderFooter/);
    }
    // Bonfire's own Home (desktop) is watched too.
    expect(readFileSync('src/components/social/FedizenFeed.tsx', 'utf8')).toMatch(/const nativeEnd = useLoadMoreSentinel\(nativeSource/);
  });
});
