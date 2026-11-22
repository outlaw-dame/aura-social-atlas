import type { FedizenPost } from './fedizen-feed';

/** Someone whose new post is waiting above the feed: shown as a face in the new-posts pill. */
export type NewPostFace = { key: string; name: string; avatar?: string };

/**
 * Up to `max` different people behind the waiting posts, newest first, as Ivory and Mastodon for iOS show them on
 * their "new posts" pill. A boost shows who boosted it: that's the person the reader follows who put it in Home.
 */
export function newPostFaces(posts: readonly FedizenPost[], max = 3): NewPostFace[] {
  const out: NewPostFace[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    const who = p.booster
      ? { key: p.booster.acct ?? p.booster.actor ?? p.booster.name, name: p.booster.name, avatar: p.booster.avatar }
      : { key: p.acct ?? p.handle ?? p.author, name: p.author, avatar: p.avatar };
    const key = who.key.replace(/^@/, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: who.name, ...(who.avatar ? { avatar: who.avatar } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

/** What a screen reader hears for the pill: the count and whose posts they are. */
export function newPostsLabel(count: number, gap: boolean, faces: readonly NewPostFace[]): string {
  const n = `${count}${gap ? '+' : ''} new post${count === 1 && !gap ? '' : 's'}`;
  if (!faces.length) return `Show ${n}`;
  const names = faces.map(f => f.name);
  const more = count > faces.length || gap;
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')}${more ? ', ' : ' and '}${names[names.length - 1]}`;
  return `Show ${n} from ${who}${more ? ' and others' : ''}`;
}
