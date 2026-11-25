import type { FedizenPost } from './fedizen-feed';

/**
 * A conversation that keeps changing while it's open. Fedizen's API has no stream for one conversation (Bonfire's
 * own pages get each new reply pushed to them, Bonfire.Social.LivePush :new_reply, but that isn't exposed through
 * its Mastodon API), so Atlas reads the conversation again when there may be something new (useThread.ts) and
 * reconciles what it gets with what the reader is looking at, so nothing moves under them:
 *  - edits show at once, in place;
 *  - a post deleted, or gone from the conversation, becomes a placeholder, so its replies keep their place
 *    (only when the read was complete: a partial answer says nothing about what's missing);
 *  - new posts are added straight away (`added`); the page keeps the reader's place (useScrollAnchor) and marks them
 *    as new, so nothing has to be asked for and nothing jumps.
 */
export type ThreadData = { post: FedizenPost; ancestors: FedizenPost[]; descendants: FedizenPost[] };

const key = (p: FedizenPost) => p.statusId ?? p.id;

/** A post as its placeholder: where it sat in the conversation and nothing it said. */
export function tombstone(p: FedizenPost): FedizenPost {
  return { id: p.id, statusId: p.statusId, author: p.author, handle: p.handle, url: p.url, date: p.date, replyTo: p.replyTo, paragraphs: [], tombstone: true };
}

export function reconcile(shown: ThreadData, live: ThreadData, opts: {
  /** Posts known to be deleted (live updates, or the reader's own deletes). */ deleted: ReadonlySet<string>;
  /** The read came back whole (no error), so a post missing from it is gone. */ complete: boolean;
}): { shown: ThreadData; added: FedizenPost[] } {
  const liveBy = new Map<string, FedizenPost>();
  [live.post, ...live.ancestors, ...live.descendants].forEach(p => liveBy.set(key(p), p));
  const update = (p: FedizenPost): FedizenPost => {
    const k = key(p);
    if (p.tombstone || opts.deleted.has(k)) return p.tombstone ? p : tombstone(p);
    const now = liveBy.get(k);
    if (now) return opts.deleted.has(key(now)) ? tombstone(now) : now;
    return opts.complete ? tombstone(p) : p;
  };
  const had = new Set([shown.post, ...shown.ancestors, ...shown.descendants].map(key));
  const ancestors = shown.ancestors.map(update);
  // New posts above stay in order with the rest, as Fedizen gives them.
  for (const a of live.ancestors) if (!had.has(key(a)) && !opts.deleted.has(key(a))) { ancestors.push(a); had.add(key(a)); }
  const order = new Map(live.ancestors.map((a, i) => [key(a), i]));
  ancestors.sort((x, y) => (order.get(key(x)) ?? -1) - (order.get(key(y)) ?? -1));
  const descendants = shown.descendants.map(update);
  const added: FedizenPost[] = [];
  for (const d of live.descendants) {
    const k = key(d);
    if (had.has(k) || opts.deleted.has(k)) continue;
    descendants.push(d); added.push(d);
  }
  return { shown: { post: update(shown.post), ancestors, descendants }, added: added.sort(byTime) };
}

/** One post deleted while the conversation is open: its placeholder, without reading Fedizen again. */
export function withDeleted(shown: ThreadData, id: string): ThreadData {
  const gone = (p: FedizenPost) => (key(p) === id && !p.tombstone ? tombstone(p) : p);
  return { post: gone(shown.post), ancestors: shown.ancestors.map(gone), descendants: shown.descendants.map(gone) };
}

/** Whether a live post belongs to this conversation: it is one of its posts, or answers one. */
export function touches(shown: ThreadData, p: FedizenPost): boolean {
  const keys = new Set([shown.post, ...shown.ancestors, ...shown.descendants].map(key));
  return keys.has(key(p)) || (!!p.replyTo?.statusId && keys.has(p.replyTo.statusId));
}

const time = (p: FedizenPost) => { const t = p.date ? Date.parse(p.date) : NaN; return Number.isNaN(t) ? 0 : t; };
const byTime = (a: FedizenPost, b: FedizenPost) => time(a) - time(b);

/** How often an open conversation is read again while everything is fine. */
export const CHECK_MS = 45_000;
/** After a read that didn't come back whole: try again soon, then less often, then at the usual pace. */
export const RETRY_MS = [4_000, 12_000] as const;
export function nextReadIn(failuresInARow: number): number {
  return failuresInARow > 0 && failuresInARow <= RETRY_MS.length ? RETRY_MS[failuresInARow - 1] : CHECK_MS;
}
