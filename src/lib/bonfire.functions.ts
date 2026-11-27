import { createServerFn } from '@tanstack/react-start';
import type { BonfireArticle } from './spotlight';
import type { FedizenPost } from './fedizen-feed';

export type RecentArticlesResult = { articles: BonfireArticle[]; next?: string; error?: 'unavailable' };

/**
 * Public read of Fedizen's Bonfire GraphQL "articles" feed (the same data as Bonfire's Articles page), 20 activities a
 * page; pass the last page's `next` as `after` for the page after it.
 */
export const getRecentArticles = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown): { after?: string } => (d && typeof d === 'object' && typeof (d as { after?: unknown }).after === 'string' ? { after: (d as { after: string }).after.slice(0, 200) } : {}))
  .handler(async ({ data }): Promise<RecentArticlesResult> => {
  const { fetchRecentArticles } = await import('./bonfire.server');
  return fetchRecentArticles(data.after);
});

export type PublicFeedResult = { posts: FedizenPost[]; error?: 'unavailable' };

/** Public Fedizen local feed via Bonfire GraphQL (Mastodon REST public timelines require login there). */
export const getFedizenPublic = createServerFn({ method: 'GET' }).handler(async (): Promise<PublicFeedResult> => {
  const { fetchPublicFeed } = await import('./bonfire.server');
  return fetchPublicFeed();
});
