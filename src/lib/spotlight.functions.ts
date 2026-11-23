import { createServerFn } from '@tanstack/react-start';
import {
  bonfireAuthor, combineSpotlight, fromFederatedVideos, fromMastodonLinks,
  type SpotlightItem,
} from './spotlight';

/**
 * Spotlight is provider-relative. The first release reads public trends,
 * public federated video posts, and real ActivityPub Articles known to Fedizen.
 * It does NOT scrape mastodon.social or pretend Fedizen knows the whole fediverse.
 *
 * Trending / recent are separate selection semantics, not interchangeable.
 * The Link Conversations feature is deliberately not implemented here.
 */
export const getSpotlight = createServerFn({ method: 'GET' }).handler(async (): Promise<{ items: SpotlightItem[]; bonfireCount: number }> => {
  const { readFedizenPublicSpotlight } = await import('./spotlight-federated.server');
  const [{ articles }, trendPayload, federatedPayload] = await Promise.all([
    import('./bonfire.server').then(m => m.fetchRecentArticles()),
    readFedizenPublicSpotlight('trends'),
    readFedizenPublicSpotlight('federated'),
  ]);

  const recent: SpotlightItem[] = articles.slice(0, 6).map(a => {
    const account = bonfireAuthor(a);
    return {
      id: `a:${a.id}`, source: 'Bonfire', title: a.title, description: a.summary,
      url: a.url, image: a.image, provider: 'fedizen.net', author: a.author,
      authorUrl: a.authorUrl, published: a.date,
      authorAccount: account, authorAccounts: account ? [account] : undefined,
      kind: 'article', reason: 'recent', observedBy: 'fedizen.net',
    };
  });
  const links = fromMastodonLinks(trendPayload as never, { source: 'Bonfire', observedBy: 'fedizen.net' });
  const videos = fromFederatedVideos(federatedPayload);

  // Independently verify publisher attribution, and recognize PodcastEpisode
  // and Video ActivityPub objects through the EXISTING guarded resolver.
  // Only four potential episodes from PUBLIC federated posts are considered.
  const candidates = federatedPayload.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const post = value as Record<string, unknown>;
    const card = post.card && typeof post.card === 'object' ? post.card as Record<string, unknown> : null;
    if (post.visibility !== 'public' || typeof post.content !== 'string' ||
      !/\b(podcast|episode)\b/i.test(post.content) || typeof card?.url !== 'string' ||
      !/^https:\/\//i.test(card.url) || card.url.length > 2048) return [];
    return [card.url];
  }).slice(0, 4);

  const urls = [...new Set([...candidates, ...links.map(it => it.url)])].slice(0, 16);
  const podcasts: SpotlightItem[] = [];
  if (urls.length) {
    const { resolveAuthorsFor, mediaFor } = await import('./article-author.server');
    const found = await resolveAuthorsFor(urls, 3000).catch(() => new Map());
    for (const it of links) {
      const authors = !it.authorAccount ? found.get(it.url) : undefined;
      if (authors?.length) { it.authorAccounts = authors; it.authorAccount = authors[0]; }
      const media = mediaFor(it.url);
      if (media?.episode) it.kind = 'podcast';
      else if (media?.video) it.kind = 'video';
    }
    for (const url of candidates) {
      const episode = mediaFor(url)?.episode;
      if (!episode) continue; // ordinary audio/keyword matches are not podcast episodes
      podcasts.push({
        id: `p:${episode.url}`, source: 'Bonfire', url: episode.url,
        title: episode.title, description: '', image: episode.image,
        provider: new URL(episode.url).hostname, author: episode.podcast.name,
        authorUrl: episode.podcast.url, authorAccount: episode.podcast,
        authorAccounts: [episode.podcast], published: episode.published,
        kind: 'podcast', reason: 'recent', observedBy: 'fedizen.net',
      });
    }
  }

  return {
    items: combineSpotlight(links, recent, podcasts, videos),
    bonfireCount: recent.length,
  };
});
