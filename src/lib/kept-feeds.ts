/**
 * For You and Local as last seen, kept on this device, so they open at once (as Home does, home-timeline.ts) and
 * are read again from Fedizen straight away. Bluesky's app keeps chosen queries on the device the same way
 * (react-query-persist-client: only successful reads, one store per account, dropped on an app update, and its
 * Following feed as a snapshot of its newest pages, at most 1 MB). Here:
 * - only a read that came back whole, under the Atlas account that read it, for CACHE_MAX_AGE (6 h);
 * - the first page only, within each feed's byte budget (Home keeps up to 1.5 MB; localStorage has about 5 MB);
 * - a version number, so a change of shape drops old copies instead of misreading them;
 * - forgotten with Home on signing out, switching account or disconnecting Fedizen (clearKeptFeeds).
 * A copy read back is marked `kept`, so older pages wait for the fresh read's cursor instead of continuing the copy's.
 */
import { CACHE_MAX_AGE } from './home-timeline';

export const KEPT_FEEDS = { foryou: 600_000, local: 400_000 } as const;
export type KeptFeed = keyof typeof KEPT_FEEDS;
const VERSION = 1;
const key = (uid: string, feed: KeptFeed) => `atlas-feed:${feed}:${uid}`;
type Stored<T> = { v: typeof VERSION; savedAt: number; data: T };

export function readKeptFeed<T extends object>(uid: string, feed: KeptFeed, now = Date.now()): { data: T & { kept: true }; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(key(uid, feed));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored<T>;
    if (s?.v !== VERSION || typeof s.savedAt !== 'number' || now - s.savedAt > CACHE_MAX_AGE || now < s.savedAt || !s.data || typeof s.data !== 'object') return null;
    return { data: { ...s.data, kept: true }, savedAt: s.savedAt };
  } catch { return null; }
}

export function writeKeptFeed<T extends object>(uid: string, feed: KeptFeed, data: T, now = Date.now()) {
  try {
    const { kept: _k, ...rest } = data as T & { kept?: true };
    const raw = JSON.stringify({ v: VERSION, savedAt: now, data: rest } satisfies Stored<unknown>);
    if (raw.length <= KEPT_FEEDS[feed]) localStorage.setItem(key(uid, feed), raw);
    else localStorage.removeItem(key(uid, feed));
  } catch { /* storage full or unavailable: the feed just loads as before */ }
}

export function clearKeptFeeds(uid: string) {
  for (const feed of Object.keys(KEPT_FEEDS) as KeptFeed[]) try { localStorage.removeItem(key(uid, feed)); } catch { /* nothing to clear */ }
}
