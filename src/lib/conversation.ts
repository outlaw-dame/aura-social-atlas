import type { FedizenPost } from './fedizen-feed';
import type { Thread } from './thread';

/**
 * A conversation as Atlas reads it: the thread view (thread.ts) with Bonfire's two reading modes, nested and flat
 * (Bonfire.Social.Threads thread_mode :nested | :flat), and its participants (Threads.list_participants).
 *
 * Where the reader left off is kept on this device: Bonfire records what each person has seen (Seen edges,
 * Threads.mark_all_seen in its web UI) but its API exposes read markers only for the home timeline and
 * notifications (/api/v1/markers), not per thread.
 */

export type ReplyMode = 'nested' | 'flat';

const key = (p: FedizenPost) => p.statusId ?? p.id;
const time = (p: FedizenPost) => { const t = p.date ? Date.parse(p.date) : NaN; return Number.isNaN(t) ? 0 : t; };

/** Every post in the conversation once, oldest first: the posts above, the post, its follow-ups and all replies. */
export function allPosts(t: Thread): FedizenPost[] {
  const out: FedizenPost[] = [];
  const seen = new Set<string>();
  const add = (p: FedizenPost) => { const k = key(p); if (!seen.has(k)) { seen.add(k); out.push(p); } };
  t.ancestors.forEach(add); add(t.focus); t.continuation.forEach(add);
  const walk = (ns: Thread['replies']) => ns.forEach(n => { add(n.post); walk(n.replies); });
  walk(t.replies);
  return out.sort((a, b) => time(a) - time(b));
}

/** The conversation's first post, which names it. */
export const rootOf = (t: Thread): FedizenPost => t.ancestors[0] ?? t.focus;

/** Who's in it, most active first (Bonfire lists a thread's participants; likers aren't participants). */
export function participantsOf(posts: FedizenPost[]): { post: FedizenPost; count: number }[] {
  const by = new Map<string, { post: FedizenPost; count: number }>();
  for (const p of posts) {
    if (p.tombstone) continue;
    const h = p.handle.toLowerCase();
    const e = by.get(h);
    if (e) e.count++; else by.set(h, { post: p, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/** Bonfire's flat mode — every reply oldest first, each saying whom it answers when that isn't the post. */
export function flatReplies(t: Thread): { post: FedizenPost; parent?: FedizenPost }[] {
  const posts = allPosts(t);
  const byKey = new Map(posts.map(p => [key(p), p]));
  // The posts above, the post and its author's follow-ups are drawn before the replies already.
  const drawn = new Set([...t.ancestors.map(key), key(t.focus), ...t.continuation.map(key)]);
  return posts.filter(p => !drawn.has(key(p))).map(p => {
    const parent = p.replyTo?.statusId && p.replyTo.statusId !== key(t.focus) ? byKey.get(p.replyTo.statusId) : undefined;
    return parent ? { post: p, parent } : { post: p };
  });
}

/* ── Where the reader left off, per conversation, on this device ─────────────────────────────────────── */

export type ConvMark = { lastRead?: number; opened?: string; seenAt?: number };
type Store = Record<string, ConvMark>;
/** The key predates the single design; kept so where readers left off carries over. */
const STORE_KEY = 'atlas.proto.conversations';
const MAX = 100;

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const local = (): KV | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function readMarks(kv: KV | null = local()): Store {
  try {
    const raw = kv?.getItem(STORE_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Store : {};
  } catch { return {}; }
}

export function writeMark(rootKey: string, patch: ConvMark, kv: KV | null = local()): Store {
  const all = readMarks(kv);
  all[rootKey] = { ...all[rootKey], ...patch };
  // Keep the most recently opened conversations.
  const kept = Object.entries(all).sort(([, a], [, b]) => (b.seenAt ?? 0) - (a.seenAt ?? 0)).slice(0, MAX);
  const next = Object.fromEntries(kept);
  try { kv?.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* full or blocked: per-device convenience only */ }
  return next;
}

export const latestTime = (posts: FedizenPost[]) => posts.reduce((m, p) => Math.max(m, time(p)), 0);

/* ── Branch colours ───────────────────────────────────────────────────────────────────────────────────── */

/** How many branch colours there are (styles.css --atlas-branch-0…5). */
export const BRANCHES = 6;

/**
 * Each reply's branch: which top-level reply it descends from, numbered in the order shown, so a sub-conversation
 * keeps one colour wherever it appears: the line beside it and its "Replying to". Phanpy's
 * own thread lines are one grey (--comment-line-color); colour there means kind (orange reply-to and Thread
 * badges, purple boosts). Colouring branches is Atlas's addition, after Reddit clients' coloured comment lines.
 * The posts above, the post and its author's follow-ups have no branch.
 */
export function branchesOf(t: Thread): Map<string, number> {
  const out = new Map<string, number>();
  t.replies.forEach((n, i) => {
    const walk = (x: Thread['replies'][number]) => { out.set(key(x.post), i % BRANCHES); x.replies.forEach(walk); };
    walk(n);
  });
  return out;
}

/** "Thread 2/3", as Phanpy numbers an author's self-thread: the post above that are the author's, the post, then
 *  their follow-ups. Undefined for a post that isn't part of one. */
export function threadNumbers(t: Thread): Map<string, { index: number; total: number }> {
  const own = t.selfThread ? t.ancestors : [];
  const chain = [...own, t.focus, ...t.continuation];
  const out = new Map<string, { index: number; total: number }>();
  if (chain.length < 2) return out;
  chain.forEach((p, i) => out.set(key(p), { index: i + 1, total: chain.length }));
  return out;
}
