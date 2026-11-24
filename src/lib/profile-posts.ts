import type { FediProfilePost } from './fedi-profile';
import type { FedizenPost } from './fedizen-feed';

/**
 * A profile's posts: the ones the reader's Fedizen has (they can be acted on) and, from the account's own server, the
 * newest ones Fedizen hasn't received yet (read-only, with that server's counts). One list, newest first.
 */
export type ProfileItem = { kind: 'fedizen'; post: FedizenPost; at: number } | { kind: 'origin'; post: FediProfilePost; at: number };

const time = (d?: string) => { const t = d ? Date.parse(d) : NaN; return Number.isNaN(t) ? 0 : t; };
const norm = (u?: string) => (u ? u.replace(/\/+$/, '').toLowerCase() : '');

/**
 * Merges Fedizen's posts with the origin's. An origin post is the same post as a Fedizen one when its ActivityPub id
 * or address matches the Fedizen post's `uri` or `url`. Origin posts older than the oldest Fedizen post loaded are
 * left out while more Fedizen pages remain (they will arrive with their actions); once Fedizen has no more, or has
 * none at all, every origin post is kept.
 */
export function mergeProfilePosts(fedizen: FedizenPost[], origin: FediProfilePost[], fedizenHasMore: boolean): ProfileItem[] {
  const known = new Set(fedizen.flatMap(p => [norm(p.uri), norm(p.url)]).filter(Boolean));
  const oldest = fedizen.length ? Math.min(...fedizen.map(p => time(p.date) || Infinity)) : -Infinity;
  const seen = new Set<string>();
  const items: ProfileItem[] = fedizen.filter(p => !seen.has(p.id) && !!seen.add(p.id)).map(post => ({ kind: 'fedizen', post, at: time(post.date) }));
  for (const post of origin) {
    // Each post once (an id seen twice would also give two list items the same key).
    if (known.has(norm(post.id)) || known.has(norm(post.url))) continue;
    known.add(norm(post.id));
    const at = time(post.date);
    if (fedizenHasMore && fedizen.length && at < oldest) continue;
    items.push({ kind: 'origin', post, at });
  }
  // Stable: Fedizen's own order wins between posts with the same time.
  return items.map((x, i) => ({ x, i })).sort((a, b) => b.x.at - a.x.at || a.i - b.i).map(({ x }) => x);
}
