import type { FeaturedTag } from './fedi-profile';

/** "24 posts · last Nov 2" (or the parts their server gave), for a featured hashtag's tile. */
export function featuredDetail(t: FeaturedTag, now = new Date()): string {
  const posts = t.count != null ? `${new Intl.NumberFormat(undefined, { notation: 'compact' }).format(t.count)} post${t.count === 1 ? '' : 's'}` : '';
  const d = t.last ? new Date(t.last) : null;
  const last = d && !Number.isNaN(d.getTime())
    ? `last ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}`
    : '';
  return [posts, last].filter(Boolean).join(' · ');
}

/** Most hashtags someone can feature in Atlas (Mastodon sets no documented limit; its web app suggests up to 10). */
export const MAX_OWN_FEATURED = 10;
