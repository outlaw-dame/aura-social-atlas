import type { FedizenPost } from './fedizen-feed';
import type { Thread } from './thread';

/**
 * Two prototypes of a conversation, to compare in the app (ConversationProto.tsx):
 *
 *  A — Bonfire + Phanpy: the thread view (thread.ts) with Bonfire's two reading modes, nested and flat
 *      (Bonfire.Social.Threads thread_mode :nested | :flat), and its participants (Threads.list_participants).
 *  B — Bonfire + Phanpy + Wavelength: the same thread read as one conversation with a subject, its messages in
 *      order with day separators, a "New" line where you left off, and a mute (Wavelength: Groups → Threads →
 *      Messages, an inbox of threads with unread counts, per-thread mute). Replies keep Bonfire's reply tree as a
 *      "replying to" chip, which Wavelength's flat threads didn't have.
 *
 * Read positions and mutes are kept on this device for now: Bonfire records what each person has seen (Seen edges,
 * Threads.mark_all_seen in its web UI) but its API exposes read markers only for the home timeline and
 * notifications (/api/v1/markers), not per thread.
 */

export type ProtoStyle = 'a' | 'b';
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

/** A subject, as Wavelength showed one in bold: the first line of the first post, shortened at a word. */
export function subjectOf(root: FedizenPost, max = 80): string {
  const first = (root.cw?.trim() || root.paragraphs.find(t => t.trim()) || root.linkTitle || '').split('\n')[0].trim();
  if (!first) return `${root.author}’s post`;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** Who's in it, most active first (Bonfire lists a thread's participants; likers aren't participants). */
export function participantsOf(posts: FedizenPost[]): { post: FedizenPost; count: number }[] {
  const by = new Map<string, { post: FedizenPost; count: number }>();
  for (const p of posts) {
    const h = p.handle.toLowerCase();
    const e = by.get(h);
    if (e) e.count++; else by.set(h, { post: p, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export type ChatItem =
  | { t: 'day'; key: string; label: string }
  | { t: 'new'; key: string; count: number }
  | { t: 'msg'; key: string; post: FedizenPost; first: boolean; parent?: FedizenPost; focus: boolean };

/**
 * B: the conversation as messages. A day separator when the day changes; consecutive messages by one person within
 * five minutes share one header; a reply to anything but the message just above names what it answers; a "New" line
 * before the first message newer than `lastRead`.
 */
export function chatItems(posts: FedizenPost[], focusKey: string, lastRead?: number, now = Date.now()): ChatItem[] {
  const byKey = new Map(posts.map(p => [key(p), p]));
  const out: ChatItem[] = [];
  let prev: FedizenPost | undefined; // the message above, for sharing a header (reset by separators)
  let last: FedizenPost | undefined; // the message above, for naming what a reply answers
  let day = '';
  let newShown = false;
  const fresh = lastRead === undefined ? 0 : posts.filter(p => time(p) > lastRead).length;
  for (const p of posts) {
    const d = p.date ? dayLabel(p.date, now) : '';
    if (d && d !== day) { out.push({ t: 'day', key: `day-${d}`, label: d }); day = d; prev = undefined; }
    if (!newShown && lastRead !== undefined && fresh > 0 && time(p) > lastRead) {
      out.push({ t: 'new', key: 'new', count: fresh });
      newShown = true; prev = undefined;
    }
    // Name the message answered unless it's the one above, or the one above answers it too (a run of replies).
    const parentKey = p.replyTo?.statusId;
    const follows = !!last && (key(last) === parentKey || last.replyTo?.statusId === parentKey);
    const parent = parentKey && last && !follows ? byKey.get(parentKey) : undefined;
    const same = !!prev && prev.handle === p.handle && time(p) - time(prev) < 5 * 60_000 && !parent;
    out.push({ t: 'msg', key: key(p), post: p, first: !same, ...(parent ? { parent } : {}), focus: key(p) === focusKey });
    prev = p; last = p;
  }
  return out;
}

function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: diff < 7 ? 'long' : undefined, month: 'long', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

/** A: Bonfire's flat mode — every reply oldest first, each saying whom it answers when that isn't the post. */
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

/* ── Read positions, mutes and the conversations you've opened, on this device (prototype) ──────────── */

export type ConvMark = { lastRead?: number; muted?: boolean; opened?: string; seenAt?: number; subject?: string };
type Store = Record<string, ConvMark>;
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

/** Messages newer than where you left off, not counting your own. */
export function unreadIn(posts: FedizenPost[], lastRead: number | undefined, isMe: (p: FedizenPost) => boolean): number {
  if (lastRead === undefined) return 0;
  return posts.filter(p => time(p) > lastRead && !isMe(p)).length;
}

export const latestTime = (posts: FedizenPost[]) => posts.reduce((m, p) => Math.max(m, time(p)), 0);
