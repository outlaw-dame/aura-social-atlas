import { useSyncExternalStore } from 'react';
import type { FedizenPost } from './fedizen-feed';
import type { GroupPost } from './groups';

/**
 * Atlas's feeds, on the Feeds page (phone and desktop):
 * - Following: people you follow (your Fedizen home timeline).
 * - For You: the people you follow, the hashtags you follow, and the most-discussed posts in your groups (after
 *   Bonfire's "Top discussions").
 * - Articles: long-form articles on Fedizen.
 * - Local: everything posted on Fedizen itself.
 * - Circles you pin: posts from the people in one of your circles.
 */
export type FeedKind = 'following' | 'foryou' | 'articles' | 'local' | `circle:${string}`;
export const BASE_FEEDS: { id: FeedKind; label: string; hint: string }[] = [
  { id: 'following', label: 'Following', hint: 'People you follow' },
  { id: 'foryou', label: 'For You', hint: 'People and hashtags you follow, and what your groups are discussing' },
  { id: 'articles', label: 'Articles', hint: 'Articles from across Fedizen' },
  { id: 'local', label: 'Local', hint: 'Everything posted on Fedizen' },
];

/** Why a post is in For You. */
export type ForYouReason = { kind: 'following' } | { kind: 'tag'; tag: string } | { kind: 'group'; group: string };
export type ForYouPost = FedizenPost & { reasons: ForYouReason[] };

export function fromGroupPost(p: GroupPost): FedizenPost {
  return { id: `g-${p.id}`, ...(p.objectId ? { statusId: p.objectId } : {}), author: p.author, handle: p.handle, avatar: p.avatar, paragraphs: p.paragraphs, url: p.url, date: p.date, image: p.image };
}

const HOUR = 3600_000;
const WEIGHT: Record<ForYouReason['kind'], number> = { following: 1, tag: 0.85, group: 1.15 };

/**
 * Merges the sources into one feed: each post once (by its URL), carrying every reason it's there; ordered by
 * recency (half-life of 12 hours), weighted by why it's there, with a boost for a group's most-discussed posts
 * (they arrive most-replied first) and for posts with more than one reason.
 */
export function rankForYou(sources: { following: FedizenPost[]; tags: { tag: string; posts: FedizenPost[] }[]; groups: (FedizenPost & { group?: string })[] }, now = Date.now(), max = 40): ForYouPost[] {
  // One entry per post: matched by its Fedizen status id when it has one (a group boost and the home timeline can give
  // the same post different URLs), else by URL.
  type Entry = { post: FedizenPost; reasons: ForYouReason[]; boost: number };
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>(), byUrl = new Map<string, Entry>();
  const add = (p: FedizenPost, r: ForYouReason, boost = 0) => {
    const e = (p.statusId ? byId.get(p.statusId) : undefined) ?? byUrl.get(p.url);
    if (e) { if (!e.reasons.some(x => JSON.stringify(x) === JSON.stringify(r))) e.reasons.push(r); e.boost = Math.max(e.boost, boost); if (!e.post.statusId && p.statusId) e.post = p; }
    const into = e ?? { post: p, reasons: [r], boost };
    if (!e) entries.push(into);
    if (p.statusId && !byId.has(p.statusId)) byId.set(p.statusId, into);
    if (!byUrl.has(p.url)) byUrl.set(p.url, into);
  };
  for (const p of sources.following) add(p, { kind: 'following' });
  for (const t of sources.tags) for (const p of t.posts) add(p, { kind: 'tag', tag: t.tag });
  sources.groups.forEach((p, i, all) => add(p, { kind: 'group', group: p.group ?? 'your group' }, 0.5 * (1 - i / Math.max(1, all.length))));
  const score = (e: { post: FedizenPost; reasons: ForYouReason[]; boost: number }) => {
    const t = e.post.date ? Date.parse(e.post.date) : NaN;
    const age = Number.isFinite(t) ? Math.max(0, now - t) / HOUR : 48;
    const recency = Math.pow(0.5, age / 12);
    const weight = Math.max(...e.reasons.map(r => WEIGHT[r.kind]));
    return recency * weight + e.boost * Math.pow(0.5, age / 72) + 0.15 * (e.reasons.length - 1);
  };
  return entries.sort((a, b) => score(b) - score(a)).slice(0, max).map(e => ({ ...e.post, reasons: e.reasons }));
}

/* ── Circles pinned to Feeds, per Atlas account, in this browser ─────────────────────────────── */

export type PinnedCircle = { id: string; title: string };
const KEY = (uid: string) => `atlas-pinned-circles:${uid}`;
const listeners = new Set<() => void>();
const cache = new Map<string, PinnedCircle[]>();
const EMPTY: PinnedCircle[] = [];

function read(uid: string): PinnedCircle[] {
  if (cache.has(uid)) return cache.get(uid)!;
  let v: PinnedCircle[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(uid)) ?? '[]');
    if (Array.isArray(raw)) v = raw.filter(c => c && typeof c.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.id) && typeof c.title === 'string').slice(0, 12).map(c => ({ id: c.id, title: c.title.slice(0, 100) }));
  } catch { /* storage unavailable */ }
  cache.set(uid, v);
  return v;
}
function write(uid: string, v: PinnedCircle[]) {
  cache.set(uid, v);
  try { localStorage.setItem(KEY(uid), JSON.stringify(v)); } catch { /* this session only */ }
  listeners.forEach(l => l());
}
export function pinCircle(uid: string, c: PinnedCircle) { const v = read(uid); if (!v.some(x => x.id === c.id)) write(uid, [...v, c].slice(0, 12)); }
export function unpinCircle(uid: string, id: string) { write(uid, read(uid).filter(x => x.id !== id)); }
/** Keeps a pinned circle's title current after a rename. */
export function renamePinned(uid: string, id: string, title: string) { const v = read(uid); if (v.some(x => x.id === id && x.title !== title)) write(uid, v.map(x => (x.id === id ? { ...x, title } : x))); }
export function usePinnedCircles(uid: string | undefined): PinnedCircle[] {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => (uid ? read(uid) : EMPTY), () => EMPTY);
}
export const circleFeed = (id: string): FeedKind => `circle:${id}`;
export const circleIdOf = (k: FeedKind) => (k.startsWith('circle:') ? k.slice(7) : null);

/** "now", "5m", "3h", "2d", then the date: the short times feeds show beside a post or story. */
export function shortAgo(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(t).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

/* ── New since your last visit (Particle's dot) ────────────────────────────────────────────────────────── */

/**
 * For each feed, the newest post the person has seen there, kept per Atlas user on this device. A feed shows a dot when
 * it has a post newer than that. A feed never seen before takes its newest post as the starting point, so the first
 * visit doesn't light every tab.
 */
const SEEN_KEY = (uid: string) => `atlas-feed-seen:${uid}`;
const seenListeners = new Set<() => void>();
const seenCache = new Map<string, Record<string, string>>();
const NO_SEEN: Record<string, string> = {};
const FEED_ID = /^(following|foryou|articles|local|circle:[A-Za-z0-9_-]{1,64})$/;

function readSeen(uid: string): Record<string, string> {
  if (seenCache.has(uid)) return seenCache.get(uid)!;
  const v: Record<string, string> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY(uid)) ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      for (const [k, t] of Object.entries(raw).slice(0, 40)) if (FEED_ID.test(k) && typeof t === 'string' && !Number.isNaN(Date.parse(t))) v[k] = t;
  } catch { /* storage unavailable */ }
  seenCache.set(uid, v);
  return v;
}
/** Records that the person has seen `feed` up to `newest` (never moves backwards). */
export function markFeedSeen(uid: string, feed: FeedKind, newest: string | undefined) {
  if (!newest || Number.isNaN(Date.parse(newest)) || !FEED_ID.test(feed)) return;
  const v = readSeen(uid), had = v[feed];
  if (had && Date.parse(had) >= Date.parse(newest)) return;
  const next = { ...v, [feed]: newest };
  seenCache.set(uid, next);
  try { localStorage.setItem(SEEN_KEY(uid), JSON.stringify(next)); } catch { /* this session only */ }
  seenListeners.forEach(l => l());
}
export function useFeedsSeen(uid: string | undefined): Record<string, string> {
  return useSyncExternalStore(l => { seenListeners.add(l); return () => { seenListeners.delete(l); }; }, () => (uid ? readSeen(uid) : NO_SEEN), () => NO_SEEN);
}
/** The newest date among posts (undefined when none has one). */
export function newestOf(posts: { date?: string }[] | undefined): string | undefined {
  let best: string | undefined, bestT = -Infinity;
  for (const p of posts ?? []) { const t = p.date ? Date.parse(p.date) : NaN; if (!Number.isNaN(t) && t > bestT) { bestT = t; best = p.date; } }
  return best;
}
/** Does this feed have something newer than the person last saw? Unknown either way means no dot. */
export function hasNew(seen: string | undefined, newest: string | undefined): boolean {
  return !!seen && !!newest && Date.parse(newest) > Date.parse(seen);
}
export function _clearSeenForTests() { seenCache.clear(); }
export const _readSeenForTests = (uid: string) => readSeen(uid);
