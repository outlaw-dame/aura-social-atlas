import { createServerFn } from '@tanstack/react-start';
import type { BonfireArticle } from './spotlight';

export type RecentArticlesResult = { articles: BonfireArticle[]; error?: 'unavailable' };

/** Public read of Fedizen's Bonfire GraphQL "articles" feed — the same data as Bonfire's Recent Articles. */
export const getRecentArticles = createServerFn({ method: 'GET' }).handler(async (): Promise<RecentArticlesResult> => {
  const { fetchRecentArticles } = await import('./bonfire.server');
  return fetchRecentArticles();
});
