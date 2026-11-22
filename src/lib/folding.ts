import type { FedizenPost } from './fedizen-feed';
import type { Thread, ThreadNode } from './thread';

/**
 * How a conversation hides replies (ConversationThread.tsx). Atlas's rule, at the end of this file, combines what
 * the two clients it learned from do, studied as they actually work:
 *  - Phanpy (src/pages/status.jsx, SubComments and calcStatusWeight, at commit 067317c) weighs every reply by length
 *    and keeps a set of replies open while the weight above it on the branch stays small; everything is open under
 *    10 replies; folds are remembered while the conversation is on screen; nesting never stops.
 *  - Bonfire (bonfire_ui_social ThreadBranchLive, at the commit pinned by Bonfire v1.1.0-rc.1, f92cfa2) folds a
 *    reply with 3 or more posts under it in threads of 10 or more, lets any branch be folded by hand with − / +,
 *    loads three levels at a time and stops indenting at the third.
 * Both show a folded set as up to three faces of people who replied directly and a count.
 */

const key = (p: FedizenPost) => p.statusId ?? p.id;

/** The faces on a folded set's summary: up to three people who replied directly, once each (as Phanpy and Bonfire do). */
export function replyFaces(n: ThreadNode, max = 3): FedizenPost[] {
  const out: FedizenPost[] = [];
  const seen = new Set<string>();
  for (const r of n.replies) {
    if (r.post.tombstone) continue;
    const h = r.post.handle.toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h); out.push(r.post);
    if (out.length >= max) break;
  }
  return out;
}

/* ── The rule: Phanpy's idea, measured on screen, never hiding what the reader would want ───────────────── */

/**
 * Atlas's rule, from that comparison:
 *  - Fold by how much screen a set of replies would take, as Phanpy folds by reading cost, but measured in pixels
 *    on this screen: estimated (text lines at this width, media at its own size up to the 320px Atlas draws it,
 *    polls, link cards), then corrected by the drawn height of the replies showing (calibration), so a phone folds
 *    sooner than a desktop, an image weighs what it occupies, and fonts and text size count.
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
  /** Drawn height over estimated height, from the replies on screen (calibration); 1 until measured. */
  scale?: number;
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

/** How far the estimate is off on this screen: the median of drawn ÷ estimated heights of the replies showing,
 *  kept between 0.6 and 2 so one odd post can't swing every fold. 1 with fewer than 3 to go on. */
export function calibration(pairs: readonly [drawn: number, estimated: number][]): number {
  const r = pairs.filter(([d, e]) => d > 0 && e > 0).map(([d, e]) => d / e).sort((a, b) => a - b);
  if (r.length < 3) return 1;
  const mid = r.length >> 1;
  const m = r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2;
  return Math.min(2, Math.max(0.6, m));
}

/** Atlas's decision for every post that has replies, keyed by that post. */
export function atlasFolds(t: Thread, env: AtlasEnv): Map<string, AtlasFold> {
  const out = new Map<string, AtlasFold>();
  const k = env.scale ?? 1;
  const height = new Map<string, number>(); // the whole subtree under a post, not counting it
  const measure = (n: ThreadNode): number => {
    const h = n.replies.reduce((s, r) => s + k * postHeight(r.post, env.width, r.depth) + measure(r), 0);
    height.set(key(n.post), h);
    return h;
  };
  const all = t.replies.reduce((s, n) => s + k * postHeight(n.post, env.width, n.depth) + measure(n), 0);
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
