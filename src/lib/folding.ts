import type { FedizenPost } from './fedizen-feed';
import type { Thread, ThreadNode } from './thread';

/**
 * How prototype A hides replies in a nested conversation. Phanpy and Bonfire do this differently, so A offers each
 * one as it actually works, to compare.
 *
 * Phanpy (src/pages/status.jsx, SubComments and calcStatusWeight, at commit 067317c):
 *  - Every reply is weighed by length. Weight = (visible text + 140 if it has media + 35 per poll option + 70 for a
 *    link card) / 140. The card term is reproduced exactly as Phanpy computes it: every post adds 70 unless it has a
 *    card together with media or a poll.
 *  - When the conversation has fewer than 10 posts below the opened one, everything is open.
 *  - Otherwise each set of replies under a post is open while the weight of the posts above it on that branch plus
 *    these replies is 5 or less. A single short reply (weight under 2) also stays open, unless the post above it is
 *    a reply by the opened post's author.
 *  - An open set has no summary or toggle at all. A closed set is a <details> whose summary shows up to three
 *    faces (one per person who replied directly), "N replies · M comments" (direct replies, then every post under
 *    it, when they differ) and a chevron, plus "»" to open that post as its own conversation.
 *  - Whether you opened or closed a set is remembered, keyed by its first reply, until you leave the conversation.
 *  - Nesting never stops. From the 4th level the replies scroll sideways.
 *  - A reply whose own replies aren't loaded shows a speech-bubble count of them.
 *
 * Bonfire (bonfire_ui_social ThreadBranchLive, at the commit pinned by Bonfire v1.1.0-rc.1, f92cfa2):
 *  - Threads with fewer than 10 replies are fully open. In bigger ones a reply folds when 3 or more posts sit under
 *    it. It is never weighed by length.
 *  - A folded reply's summary row shows up to three faces of people who replied directly, "N replies" (every post
 *    under it) and a chevron.
 *  - Any reply with replies can be folded and unfolded by hand with the − / + button where its line meets them. A
 *    reply folded by hand shows only that +, with no summary row.
 *  - Three levels load at a time (thread_default_max_depth). At the third level, "N more replies" loads the next
 *    three in place.
 *  - Indentation stops at the third level (max_visual_depth). Deeper replies line up under it.
 */

export type FoldStyle = 'phanpy' | 'bonfire';

const key = (p: FedizenPost) => p.statusId ?? p.id;
const sameAuthor = (a: FedizenPost, b: FedizenPost) => !!a.handle && a.handle.toLowerCase() === b.handle.toLowerCase();

/* ── Phanpy ───────────────────────────────────────────────────────────────────────────────────────── */

export const PHANPY = {
  /** Fewer descendants than this and everything is open (SUBCOMMENTS_OPEN_ALL_LIMIT). */
  openAllBelow: 10,
  /** Weight of a branch kept open (MAX_WEIGHT). */
  maxWeight: 5,
  /** Above this many descendants a closed set renders its replies only once opened (LIMIT, lazyRenderReplies). */
  lazyAbove: 40,
  /** Replies under a post at this level scroll sideways (data-comments-level="4"). */
  scrollLevel: 4,
} as const;

/** Phanpy's calcStatusWeight, on Atlas's post. */
export function postWeight(p: FedizenPost): number {
  const text = [p.cw ?? '', ...p.paragraphs].join('').length;
  const media = p.image || p.video ? 140 : 0;
  const options = p.pollState?.options.length ?? p.poll?.length ?? 0;
  const poll = options * 35;
  const card = (p.article || p.linkTitle) && (media || options) ? 0 : 70;
  return (text + media + poll + card) / 140;
}

/** One set of replies under a post: whether it starts open, and its summary's counts. */
export type PhanpyFold = { open: boolean; replies: number; comments: number };

/** Phanpy's decision for every post that has replies, keyed by that post. */
export function phanpyFolds(t: Thread): Map<string, PhanpyFold> {
  const out = new Map<string, PhanpyFold>();
  const openAll = t.total < PHANPY.openAllBelow;
  const visit = (parent: ThreadNode, acc: number, parentIsThread: boolean) => {
    const kids = parent.replies;
    const total = kids.reduce((w, k) => w + postWeight(k.post), acc);
    const comments = parent.size;
    const open = openAll
      || total <= PHANPY.maxWeight
      || (!parentIsThread && comments === 1 && postWeight(kids[0].post) < 2);
    out.set(key(parent.post), { open, replies: kids.length, comments });
    for (const k of kids) if (k.replies.length) visit(k, open ? total : postWeight(k.post), false);
  };
  for (const n of t.replies) if (n.replies.length) visit(n, postWeight(n.post), sameAuthor(n.post, t.focus));
  return out;
}

/* ── Bonfire ──────────────────────────────────────────────────────────────────────────────────────── */

export const BONFIRE = {
  /** Threads with fewer replies than this stay open (@auto_collapse_thread_size). */
  foldFrom: 10,
  /** In bigger threads a reply with this many posts under it folds (@auto_collapse_subtree_size). */
  subtreeFrom: 3,
  /** Levels loaded at a time (thread_default_max_depth). */
  loadLevels: 3,
  /** Levels indented (max_visual_depth). */
  indentLevels: 3,
} as const;

/** Whether Bonfire starts this reply folded. */
export const bonfireFolds = (t: Thread, n: ThreadNode) => n.replies.length > 0 && t.total >= BONFIRE.foldFrom && n.size >= BONFIRE.subtreeFrom;

/** Bonfire's more_replies_label, when none of a reply's replies are shown yet: "2 more replies", or "2+ more replies"
 *  when more posts sit deeper than its direct replies. */
export function bonfireMoreLabel(n: ThreadNode): string {
  const direct = n.replies.length;
  const nested = n.size - direct;
  if (nested > direct) return `${direct}+ more replies`;
  return `${direct} more ${direct === 1 ? 'reply' : 'replies'}`;
}

/* ── Both ─────────────────────────────────────────────────────────────────────────────────────────── */

/** The faces on a summary: up to three people who replied directly, once each (Phanpy's and Bonfire's rule). */
export function replyFaces(n: ThreadNode, max = 3): FedizenPost[] {
  const out: FedizenPost[] = [];
  const seen = new Set<string>();
  for (const r of n.replies) {
    const h = r.post.handle.toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h); out.push(r.post);
    if (out.length >= max) break;
  }
  return out;
}
