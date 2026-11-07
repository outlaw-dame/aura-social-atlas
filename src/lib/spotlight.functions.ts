import { createServerFn } from '@tanstack/react-start';
import { bonfireAuthor, fromMastodonLinks, mixSpotlight, type SpotlightItem } from './spotlight';


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
  const bonfire: SpotlightItem[] = recent.articles.slice(0, 4).map(a => {
    const account = bonfireAuthor(a);
    return { id: `b:${a.id}`, source: 'Bonfire', title: a.title, description: a.summary, url: a.url, image: a.image, provider: 'fedizen.net', author: a.author, authorUrl: a.authorUrl, published: a.date, authorAccount: account, authorAccounts: account ? [account] : undefined };
  });
  const mastodon = fromMastodonLinks(links as never);
  // Mastodon only credits an account via fediverse:creator; for the rest, read the article's own
  // ActivityPub authorship (or a verifiable fediverse:creator) ourselves, within a short time budget.
  const unattributed = mastodon.filter(it => !it.authorAccount).map(it => it.url);
  if (unattributed.length) {
    const { resolveAuthorsFor } = await import('./article-author.server');
    const found = await resolveAuthorsFor(unattributed, 3000);
    for (const it of mastodon) {
      const authors = !it.authorAccount ? found.get(it.url) : undefined;
      if (authors?.length) { it.authorAccounts = authors; it.authorAccount = authors[0]; }
    }
  }
  return { items: mixSpotlight(mastodon, bonfire), bonfireCount: bonfire.length };
});
