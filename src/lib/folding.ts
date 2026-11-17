import type { FedizenPost } from './fedizen-feed';
import type { Thread, ThreadNode } from './thread';

/**
 * How prototype A hides replies in a nested conversation. Phanpy and Bonfire do this differently, so A offers each
 * one as it actually works, to compare, and Atlas's own rule built from both (at the end of this file).
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

export type FoldStyle = 'atlas' | 'phanpy' | 'bonfire';

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

/* ── Atlas: Phanpy's idea, measured on screen, never hiding what the reader would want ──────────────────── */

/**
 * Atlas's own rule, from the comparison of the two above:
 *  - Fold by how much screen a set of replies would take, as Phanpy folds by reading cost, but measured in estimated
 *    pixels on this screen (text lines at this width, media at its own size up to the 320px Atlas draws it, polls,
 *    link cards), so a phone folds sooner than a desktop and an image weighs what it occupies.
 *  - A set stays open while everything under it fits in three quarters of the window. A conversation that fits in
 *    one and a half windows is all open.
 *  - A set is never folded when it holds something the reader would want to see: the opened post's author, the
 *    reader, someone they follow, a post mentioning them, or a post newer than their last visit (Bonfire never hides
 *    the reply you came for; Wavelength's New line). Its summary says which.
 */
export type AtlasReason = 'new' | 'following' | 'mentions' | 'author' | 'mine';
export type AtlasFold = {
  open: boolean;
  replies: number;
  total: number;
  /** Newest post under it (ms), for "latest 2h". */
  latest: number;
  /** How many of each kind of post the reader would want sit under it. */
  reasons: Partial<Record<AtlasReason, number>>;
};
export type AtlasEnv = {
  /** The window's height and the width a reply's text gets, in CSS px. */
  viewportH: number; width: number;
  /** Why the reader would want this post, if they would. */
  wants: (p: FedizenPost) => AtlasReason | undefined;
};

export const ATLAS = { setShare: 0.75, allOpenShare: 1.5, indent: { phone: 3, desktop: 5 } } as const;

const time = (p: FedizenPost) => { const t = p.date ? Date.parse(p.date) : NaN; return Number.isNaN(t) ? 0 : t; };

/** Roughly how tall a reply draws, in CSS px, at a given text width. */
export function postHeight(p: FedizenPost, width: number, depth = 1): number {
  const w = Math.max(160, width - (depth - 1) * 20);
  const perLine = Math.max(20, Math.floor(w / 8.4));
  const text = [p.cw ?? '', ...p.paragraphs].filter(Boolean);
  const lines = text.reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  const media = p.video ? Math.min(320, w * 9 / 16)
    : p.image ? Math.min(320, p.imageSize ? w * p.imageSize.h / p.imageSize.w : 320) + 12 : 0;
  const options = p.pollState?.options.length ?? p.poll?.length ?? 0;
  const poll = options ? options * 40 + 28 : 0;
  const card = (p.article || p.linkTitle) && !media ? 96 : 0;
  return 44 + lines * 22 + media + poll + card;
}

/** Atlas's decision for every post that has replies, keyed by that post. */
export function atlasFolds(t: Thread, env: AtlasEnv): Map<string, AtlasFold> {
  const out = new Map<string, AtlasFold>();
  const height = new Map<string, number>(); // the whole subtree under a post, not counting it
  const measure = (n: ThreadNode): number => {
    const h = n.replies.reduce((s, r) => s + postHeight(r.post, env.width, r.depth) + measure(r), 0);
    height.set(key(n.post), h);
    return h;
  };
  const all = t.replies.reduce((s, n) => s + postHeight(n.post, env.width, n.depth) + measure(n), 0);
  const allOpen = all <= env.viewportH * ATLAS.allOpenShare;
  const visit = (n: ThreadNode): { latest: number; reasons: Partial<Record<AtlasReason, number>> } => {
    let latest = 0;
    const reasons: Partial<Record<AtlasReason, number>> = {};
    for (const r of n.replies) {
      latest = Math.max(latest, time(r.post));
      const why = env.wants(r.post);
      if (why) reasons[why] = (reasons[why] ?? 0) + 1;
      const below = visit(r);
      latest = Math.max(latest, below.latest);
      for (const [k, v] of Object.entries(below.reasons) as [AtlasReason, number][]) reasons[k] = (reasons[k] ?? 0) + v;
    }
    if (n.replies.length) {
      const wanted = Object.keys(reasons).length > 0;
      const open = allOpen || wanted || (height.get(key(n.post)) ?? 0) <= env.viewportH * ATLAS.setShare;
      out.set(key(n.post), { open, replies: n.replies.length, total: n.size, latest, reasons });
    }
    return { latest, reasons };
  };
  t.replies.forEach(visit);
  return out;
}

/** The words for a folded set's reasons, most pressing first: "1 new · from someone you follow". */
export function reasonWords(r: Partial<Record<AtlasReason, number>>): string[] {
  const out: string[] = [];
  if (r.new) out.push(`${r.new} new`);
  if (r.mentions) out.push(r.mentions === 1 ? 'mentions you' : `${r.mentions} mention you`);
  if (r.mine) out.push(r.mine === 1 ? 'your reply' : `${r.mine} of your replies`);
  if (r.author) out.push('the author replies');
  if (r.following) out.push(r.following === 1 ? 'someone you follow' : `${r.following} from people you follow`);
  return out;
}
