import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent } from './fedizen-feed';
import { allowedSpotlightItem, verifiedBonfireArticleSource, type SpotlightModeration } from './spotlight-curation';
import {
  bonfireAuthor, combineSpotlight, fromFederatedLinkCards, fromFederatedVideos, fromMastodonLinks, type SpotlightItem,
} from './spotlight';
import { collectPublicSpotlightCandidates, eligiblePublicSpotlightPosts } from './spotlight-personal.server';

/** Bonfire's public, verified RECENT Article projection. It does not await
 * trends, which can be slow or empty. No individual OAuth grant is used. */
export const getSpotlight = createServerFn({ method: 'GET' }).handler(async (): Promise<{ items: SpotlightItem[]; bonfireCount: number }> => {
  const { articles } = await import('./bonfire.server').then(m => m.fetchRecentArticles());
  // The public GraphQL projection already supplies up to 20 recent articles.
  // Filter by owner policy AFTER sampling: the first few may all be remote
  // and ineligible while a local, eligible author appears farther down.
  const recent: SpotlightItem[] = articles.slice(0, 20).map(a => {
    const account = bonfireAuthor(a);
    const provider = (() => { try { return new URL(a.url).hostname || 'fedizen.net'; } catch { return 'fedizen.net'; } })();
    // Keep explicit actor-origin proof even for federated authors. Today
    // remote cards remain withheld until the owner's domain-block policy is
    // complete, but future authorization must not require rewriting cards.
    const provenance = verifiedBonfireArticleSource(a, account);
    return {
      id: `a:${a.id}`, source: 'Bonfire', title: a.title, description: a.summary,
      url: a.url, image: a.image, provider, author: a.author,
      authorUrl: a.authorUrl, published: a.date,
      authorAccount: account, authorAccounts: account ? [account] : undefined,
      kind: 'article', reason: 'recent', observedBy: 'fedizen.net',
      ...provenance,
      filterText: a.paragraphs.slice(0, 4).join(' ').slice(0, 1800),
    };
  });
  return { items: recent, bonfireCount: recent.length };
});

/** Independent public trend lookup: a stalled or empty trend provider must
 * not delay Bonfire's verified recent articles. No viewer credentials here;
 * personalized filtering happens before either result is rendered. */
export const getSpotlightTrends = createServerFn({ method: 'GET' }).handler(async (): Promise<{ items: SpotlightItem[] }> => {
  const { readFedizenPublicSpotlight } = await import('./spotlight-federated.server');
  const trendPayload = await readFedizenPublicSpotlight('trends');
  const links = fromMastodonLinks(trendPayload as never, { source: 'Bonfire', observedBy: 'fedizen.net' });

  // Confirm podcast/video types and publisher identity against the article's
  // ActivityPub object, using Atlas's guarded bounded resolution.
  const urls = [...new Set(links.map(it => it.url))].slice(0, 12);
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
  }
  return { items: links };
});

/** Fedizen's federated-public REST timeline currently returns 401 anonymously.
 * This is an OWNER-BOUND *read* using this Atlas user's separate delegated
 * Fedizen grant. Only actual PUBLIC posts are projected into Spotlight. This
 * query is never cached globally or passed through the public discovery gateway.
 */
export const getViewerSpotlight = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({ expectedAtlasUserId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }): Promise<{ items: SpotlightItem[]; moderation: SpotlightModeration | null }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const connected = await tokenFor(context.userId);
    if (!connected) return { items: [], moderation: null };
    const { readSpotlightModeration } = await import('./spotlight-moderation.server');
    // Read the local and federated PUBLIC views concurrently. A sparse global
    // first page (often remote actors withheld pending blocked-instance policy)
    // must not suppress local stories that passed this viewer's own blocks.
    const { readOwnerNativeModeration, mergeVerifiedOwnerModeration } = await import('./spotlight-native-moderation.server');
    const { blockedServersOf, withAtlasServers } = await import('./server-blocks.server');
    const [restPolicy, response, local, nativePolicy, atlasServers] = await Promise.all([
      readSpotlightModeration(path => fedizenGet(connected.access_token, path, { requireCompleteModeration: true })),
      fedizenGet(connected.access_token, '/api/v1/timelines/public?limit=20'),
      fedizenGet(connected.access_token, '/api/v1/timelines/local?limit=20'),
      // Off by default. An unrecognized schema, incomplete provider snapshot,
      // mismatched bearer owner or native keyword rule never enables remote cards.
      readOwnerNativeModeration(connected.access_token, connected.account_handle ?? ''),
      // Servers the person blocks in Atlas: never in their Spotlight; unreadable means none from anywhere is shown.
      blockedServersOf(context.userId),
    ]);
    const moderation = withAtlasServers(mergeVerifiedOwnerModeration(restPolicy, nativePolicy), atlasServers);
    if (!moderation || (response.status !== 200 && local.status !== 200)) return { items: [], moderation };
    const localPosts = local.status === 200 && Array.isArray(local.data)
      ? eligiblePublicSpotlightPosts(local.data, moderation) : [];
    const localLinked = fromFederatedLinkCards(localPosts);
    const localVideos = fromFederatedVideos(localPosts);
    const localEligible = [...localLinked, ...localVideos].some(it => allowedSpotlightItem(it, moderation));
    // When a sparse first page has no candidate whose authors pass the viewer's
    // moderation snapshot, inspect at most one older PUBLIC page. Preserve the
    // transport's fixed-host, fixed-route, opaque-cursor bounds and 429 cooldown.
    const { posts: publicPosts, linked, videos } = await collectPublicSpotlightCandidates(
      response, moderation, async cursor => fedizenGet(
        connected.access_token, `/api/v1/timelines/public?limit=20&max_id=${encodeURIComponent(cursor)}`,
      ), localEligible,
    );

    // A podcast is accepted only after verified ActivityPub PodcastEpisode
    // parsing, NEVER because a status happened to mention the word podcast.
    const candidates = [...localPosts, ...publicPosts].flatMap(value => {
      const status = value as Record<string, unknown>;
      const card = status.card && typeof status.card === 'object'
        ? status.card as Record<string, unknown> : null;
      if (typeof status.content !== 'string' ||
        !/\b(podcast|episode)\b/i.test(status.content) || typeof card?.url !== 'string' ||
        !/^https:\/\//i.test(card.url) || card.url.length > 2048) return [];
      const author = status.account && typeof status.account === 'object'
        ? status.account as Record<string, unknown> : null;
      if (typeof author?.acct !== 'string' || !author.acct) return [];
      const actorUrl = typeof author.uri === 'string' ? author.uri :
        typeof author.url === 'string' ? author.url : undefined;
      if (!actorUrl) return [];
      return [{ url: card.url, source: { id: typeof author.id === 'string' ? author.id : undefined,
        handle: author.acct, actorUrl }, text: status.content.slice(0, 1400) }];
    }).slice(0, 4);
    if (!candidates.length) return {
      items: combineSpotlight(
        linked.filter(it => allowedSpotlightItem(it, moderation)),
        localLinked.filter(it => allowedSpotlightItem(it, moderation)),
        videos.filter(it => allowedSpotlightItem(it, moderation)),
        localVideos.filter(it => allowedSpotlightItem(it, moderation)),
      ), moderation,
    };
    const { resolveAuthorsFor, mediaFor } = await import('./article-author.server');
    await resolveAuthorsFor(candidates.map(c => c.url), 2500).catch(() => new Map());
    const podcasts: SpotlightItem[] = [];
    for (const candidate of candidates) {
      const episode = mediaFor(candidate.url)?.episode;
      if (!episode) continue;
      podcasts.push({
        id: `p:${episode.url}`, source: 'Bonfire', url: episode.url,
        title: episode.title, description: '', image: episode.image,
        provider: new URL(episode.url).hostname, author: episode.podcast.name,
        authorUrl: episode.podcast.url, authorAccount: episode.podcast,
        authorAccounts: [episode.podcast], published: episode.published,
        kind: 'podcast', reason: 'recent', observedBy: 'fedizen.net',
        sourceAccounts: [candidate.source], sourceComplete: true, filterText: candidate.text,
      });
    }
    return { items: combineSpotlight(
      linked.filter(it => allowedSpotlightItem(it, moderation)),
      localLinked.filter(it => allowedSpotlightItem(it, moderation)),
      podcasts.filter(it => allowedSpotlightItem(it, moderation)),
      videos.filter(it => allowedSpotlightItem(it, moderation)),
      localVideos.filter(it => allowedSpotlightItem(it, moderation)),
    ), moderation };
  });

