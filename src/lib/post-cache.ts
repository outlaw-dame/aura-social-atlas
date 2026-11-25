import type { FedizenPost } from './fedizen-feed';

/**
 * A post Atlas already has somewhere in its query cache (a feed, Saved, a profile, another conversation), so a
 * conversation opened from anywhere can show it at once while Fedizen is asked for the rest. Bluesky's app does the
 * same (getThreadPlaceholder, state/queries/usePostThread/queryCache.ts): it looks through every cached feed for the
 * post and prefers a copy that carries its counts, since some places hold a thinner copy.
 *
 * The walk is bounded (MAX_NODES objects, MAX_DEPTH levels), so a large cache can't stall opening a post.
 */
const MAX_NODES = 40_000;
const MAX_DEPTH = 8;

const isPost = (v: unknown): v is FedizenPost =>
  !!v && typeof v === 'object' && typeof (v as FedizenPost).id === 'string' && Array.isArray((v as FedizenPost).paragraphs);

export function findCachedPost(datas: readonly unknown[], statusId: string): FedizenPost | undefined {
  let partial: FedizenPost | undefined;
  let seen = 0;
  const stack: { v: unknown; d: number }[] = datas.map(v => ({ v, d: 0 }));
  while (stack.length && seen < MAX_NODES) {
    const { v, d } = stack.pop()!;
    if (!v || typeof v !== 'object') continue;
    seen++;
    if (isPost(v) && v.statusId === statusId && !v.tombstone && !v.statusRef) {
      // The post itself, not the boost that carried it.
      const post = v.boostedBy ? { ...v, boostedBy: undefined } : v;
      if (post.counts) return post;
      partial ??= post;
    }
    if (d >= MAX_DEPTH) continue;
    if (Array.isArray(v)) for (const x of v) stack.push({ v: x, d: d + 1 });
    else for (const x of Object.values(v)) if (x && typeof x === 'object') stack.push({ v: x, d: d + 1 });
  }
  return partial;
}
