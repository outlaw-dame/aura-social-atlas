import { createServerFn } from '@tanstack/react-start';
import { fromBonfireStatuses, fromMastodonLinks, mixSpotlight, type SpotlightItem } from './spotlight';

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
  const [links, statuses] = await Promise.all([
    getJson('https://mastodon.social/api/v1/trends/links?limit=8'),
    getJson('https://fedizen.net/api/v1/trends/statuses?limit=20'),
  ]);
  const bonfire = fromBonfireStatuses(statuses as never).slice(0, 6);
  return { items: mixSpotlight(fromMastodonLinks(links as never), bonfire), bonfireCount: bonfire.length };
});
