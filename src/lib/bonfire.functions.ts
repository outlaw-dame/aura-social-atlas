import { createServerFn } from '@tanstack/react-start';
import type { BonfireArticle } from './spotlight';
import type { FedizenPost } from './fedizen-feed';

export type RecentArticlesResult = { articles: BonfireArticle[]; error?: 'unavailable' };

/** Public read of Fedizen's Bonfire GraphQL "articles" feed — the same data as Bonfire's Recent Articles. */
export const getRecentArticles = createServerFn({ method: 'GET' }).handler(async (): Promise<RecentArticlesResult> => {
  const { fetchRecentArticles } = await import('./bonfire.server');
  return fetchRecentArticles();
});

export type PublicFeedResult = { posts: FedizenPost[]; error?: 'unavailable' };

/** Public Fedizen local feed via Bonfire GraphQL (Mastodon REST public timelines require login there). */
export const getFedizenPublic = createServerFn({ method: 'GET' }).handler(async (): Promise<PublicFeedResult> => {
  const { fetchPublicFeed } = await import('./bonfire.server');
  return fetchPublicFeed();
});
