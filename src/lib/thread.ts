import type { FedizenPost } from './fedizen-feed';

/**
 * A conversation as Atlas shows it when a post is opened, arranged from Fedizen's context (Mastodon
 * /api/v1/statuses/:id/context; Bonfire: SocialMastoAdapter.status_context, which reads Bonfire's reply tree): the
 * posts above it, the post itself, the author's own follow-ups, then the replies as a tree.
 *
 * What it takes from others:
 *  - Mastodon and Phanpy: ancestors oldest first; a reply whose parent is missing is still shown, under the post.
 *  - Phanpy and Bluesky: the author's self-thread continues straight after the post, unindented, before others' replies;
 *    when the ancestors are all the author's own, they read as one thread.
 *  - Bluesky: replies sorted by Top, Oldest or Newest; the author's and the reader's own replies first.
 *  - Bonfire: nesting stops at a set depth (thread_default_max_depth, 3) and deeper replies open as their own thread.
 */

export type ReplySort = 'oldest' | 'newest' | 'top';
export const REPLY_SORTS: { id: ReplySort; label: string }[] = [
  { id: 'oldest', label: 'Oldest' }, { id: 'newest', label: 'Newest' }, { id: 'top', label: 'Top' },
];

export type ThreadNode = {
  post: FedizenPost;
  replies: ThreadNode[];
  /** 1 for a direct reply to the opened post (or its author's follow-ups). */
  depth: number;
  /** How many posts sit under this one, all levels. */
  size: number;
  /** A top-level reply to one of the author's follow-ups rather than the post: which part (the post is part 1). */
  part?: number;
};

export type Thread = {
  ancestors: FedizenPost[];
  /** Every post above is by the same author: read them as one thread, numbered. */
  selfThread: boolean;
  /** The post replies to one Fedizen doesn't show (deleted, blocked, or never fetched). */
  missingParent: boolean;
  focus: FedizenPost;
  /** The author's own follow-ups to the post, in order. */
  continuation: FedizenPost[];
  replies: ThreadNode[];
  /** Replies of every level, follow-ups included. */
  total: number;
};

const key = (p: FedizenPost) => p.statusId ?? p.id;
const time = (p: FedizenPost) => { const t = p.date ? Date.parse(p.date) : NaN; return Number.isNaN(t) ? 0 : t; };
const sameAuthor = (a: FedizenPost, b: FedizenPost) => !!a.handle && a.handle.toLowerCase() === b.handle.toLowerCase();

/** Engagement for "Top": a reply's own likes and boosts, and how much conversation it started. */
function score(n: ThreadNode): number {
  const c = n.post.counts;
  return (c?.likes ?? 0) + 2 * (c?.boosts ?? 0) + 3 * n.size;
}

export function buildThread(focus: FedizenPost, ancestors: FedizenPost[], descendants: FedizenPost[], opts: { sort?: ReplySort; /** The reader's own posts, listed right after the author's. */ isMe?: (p: FedizenPost) => boolean } = {}): Thread {
  const focusKey = key(focus);
  const seen = new Set([focusKey]);
  const ups = ancestors.filter(p => { const k = key(p); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => time(a) - time(b));
  const downs = descendants.filter(p => { const k = key(p); if (seen.has(k)) return false; seen.add(k); return true; });

  const parentOfFocus = focus.replyTo?.statusId;
  const missingParent = !!parentOfFocus && (ups.length === 0 || key(ups[ups.length - 1]) !== parentOfFocus);

  // Children by parent; a reply whose parent isn't here hangs under the opened post.
  const known = new Set(downs.map(key));
  const children = new Map<string, FedizenPost[]>();
  for (const p of downs) {
    const parent = p.replyTo?.statusId && (known.has(p.replyTo.statusId) || p.replyTo.statusId === focusKey) ? p.replyTo.statusId : focusKey;
    const list = children.get(parent);
    if (list) list.push(p); else children.set(parent, [p]);
  }

  // The author's own follow-ups: the earliest reply by the author to the post, then to that one, and so on.
  const continuation: FedizenPost[] = [];
  let at = focusKey;
  for (;;) {
    const next = (children.get(at) ?? []).filter(p => sameAuthor(p, focus)).sort((a, b) => time(a) - time(b))[0];
    if (!next) break;
    continuation.push(next);
    children.set(at, (children.get(at) ?? []).filter(p => p !== next));
    at = key(next);
  }

  const sort = opts.sort ?? 'oldest';
  const isMe = opts.isMe ?? (() => false);
  const grow = (k: string, depth: number, path: Set<string>): ThreadNode[] => {
    const nodes = (children.get(k) ?? []).filter(p => !path.has(key(p))).map(p => {
      const next = new Set(path).add(key(p));
      const replies = grow(key(p), depth + 1, next);
      return { post: p, replies, depth, size: replies.reduce((n, r) => n + 1 + r.size, 0) };
    });
    const rank = (n: ThreadNode) => (sameAuthor(n.post, focus) ? 0 : isMe(n.post) ? 1 : 2);
    return nodes.sort((a, b) => rank(a) - rank(b)
      || (sort === 'top' ? score(b) - score(a) : 0)
      || (sort === 'newest' ? time(b.post) - time(a.post) : time(a.post) - time(b.post)));
  };
  // Replies to the post and to each follow-up, in that order.
  const roots = [focusKey, ...continuation.map(key)];
  const replies = roots.flatMap((k, i) => grow(k, 1, new Set([focusKey, ...roots.slice(0, i + 1)])).map(n => (i ? { ...n, part: i + 1 } : n)));
  const placed = continuation.length + replies.reduce((n, r) => n + 1 + r.size, 0);

  return {
    ancestors: ups,
    selfThread: ups.length > 0 && ups.every(p => sameAuthor(p, focus)),
    missingParent,
    focus,
    continuation,
    replies: sortRoots(replies, sort, focus, isMe),
    total: placed,
  };
}

function sortRoots(nodes: ThreadNode[], sort: ReplySort, focus: FedizenPost, isMe: (p: FedizenPost) => boolean): ThreadNode[] {
  const rank = (n: ThreadNode) => (sameAuthor(n.post, focus) ? 0 : isMe(n.post) ? 1 : 2);
  return [...nodes].sort((a, b) => rank(a) - rank(b)
    || (sort === 'top' ? score(b) - score(a) : 0)
    || (sort === 'newest' ? time(b.post) - time(a.post) : time(a.post) - time(b.post)));
}

/** Sub-threads start folded once a conversation is this large (Phanpy opens everything under 10). */
export const FOLD_ABOVE = 10;
/** Replies shown before "Show more replies" (Phanpy's page of 40). */
export const PAGE = 40;
/** Levels drawn nested before "Continue this thread" opens the rest (Bonfire's default is 3). */
export const MAX_DEPTH = { phone: 3, desktop: 5 } as const;

/** The people in a folded sub-thread, for its summary: the first few distinct faces. */
export function facesIn(n: ThreadNode, max = 3): FedizenPost[] {
  const out: FedizenPost[] = [];
  const seen = new Set<string>();
  const walk = (x: ThreadNode) => {
    for (const r of x.replies) {
      if (out.length >= max) return;
      const h = r.post.handle.toLowerCase();
      if (!seen.has(h)) { seen.add(h); out.push(r.post); }
      walk(r);
    }
  };
  walk(n);
  return out;
}
