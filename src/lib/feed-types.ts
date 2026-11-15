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
  return { id: `g-${p.id}`, author: p.author, handle: p.handle, avatar: p.avatar, paragraphs: p.paragraphs, url: p.url, date: p.date, image: p.image };
}

const HOUR = 3600_000;
const WEIGHT: Record<ForYouReason['kind'], number> = { following: 1, tag: 0.85, group: 1.15 };

/**
 * Merges the sources into one feed: each post once (by its URL), carrying every reason it's there; ordered by
 * recency (half-life of 12 hours), weighted by why it's there, with a boost for a group's most-discussed posts
 * (they arrive most-replied first) and for posts with more than one reason.
 */
export function rankForYou(sources: { following: FedizenPost[]; tags: { tag: string; posts: FedizenPost[] }[]; groups: (FedizenPost & { group?: string })[] }, now = Date.now(), max = 40): ForYouPost[] {
  const byUrl = new Map<string, { post: FedizenPost; reasons: ForYouReason[]; boost: number }>();
  const add = (p: FedizenPost, r: ForYouReason, boost = 0) => {
    const key = p.url;
    const e = byUrl.get(key);
    if (e) { if (!e.reasons.some(x => JSON.stringify(x) === JSON.stringify(r))) e.reasons.push(r); e.boost = Math.max(e.boost, boost); if (!e.post.statusId && p.statusId) e.post = p; }
    else byUrl.set(key, { post: p, reasons: [r], boost });
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
  return [...byUrl.values()].sort((a, b) => score(b) - score(a)).slice(0, max).map(e => ({ ...e.post, reasons: e.reasons }));
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
