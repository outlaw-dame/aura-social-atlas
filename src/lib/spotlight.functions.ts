import { createServerFn } from '@tanstack/react-start';
import { fromMastodonLinks, mixSpotlight, type SpotlightItem } from './spotlight';


async function getJson(url: string): Promise<unknown[]> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

/** Public reads only: Mastodon's trending news and Fedizen (Bonfire) trending/recent articles. */
export const getSpotlight = createServerFn({ method: 'GET' }).handler(async (): Promise<{ items: SpotlightItem[]; bonfireCount: number }> => {
  const [links, recent] = await Promise.all([
    getJson('https://mastodon.social/api/v1/trends/links?limit=8'),
    import('./bonfire.server').then(m => m.fetchRecentArticles()),
  ]);
  const bonfire: SpotlightItem[] = recent.articles.slice(0, 4).map(a => ({ id: `b:${a.id}`, source: 'Bonfire', title: a.title, description: a.summary, url: a.url, image: a.image, provider: 'fedizen.net', author: a.author, published: a.date }));
  return { items: mixSpotlight(fromMastodonLinks(links as never), bonfire), bonfireCount: bonfire.length };
});
