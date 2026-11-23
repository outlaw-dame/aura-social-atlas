import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { assertFedizenSessionIntent } from './fedizen-feed';
import { allowedSpotlightItem, type SpotlightModeration } from './spotlight-curation';
import {
  bonfireAuthor, combineSpotlight, fromFederatedLinkCards, fromFederatedVideos, fromMastodonLinks,
  type SpotlightItem,
} from './spotlight';

/** Shared, PUBLIC Spotlight sources. These do not depend on an individual
 * user's OAuth grant and never send a request to mastodon.social.
 */
export const getSpotlight = createServerFn({ method: 'GET' }).handler(async (): Promise<{ items: SpotlightItem[]; bonfireCount: number }> => {
  const { readFedizenPublicSpotlight } = await import('./spotlight-federated.server');
  const [{ articles }, trendPayload] = await Promise.all([
    import('./bonfire.server').then(m => m.fetchRecentArticles()),
    readFedizenPublicSpotlight('trends'),
  ]);

  const recent: SpotlightItem[] = articles.slice(0, 6).map(a => {
    const account = bonfireAuthor(a);
    const provider = (() => { try { return new URL(a.url).hostname || 'fedizen.net'; } catch { return 'fedizen.net'; } })();
    return {
      id: `a:${a.id}`, source: 'Bonfire', title: a.title, description: a.summary,
      url: a.url, image: a.image, provider, author: a.author,
      authorUrl: a.authorUrl, published: a.date,
      authorAccount: account, authorAccounts: account ? [account] : undefined,
      kind: 'article', reason: 'recent', observedBy: 'fedizen.net',
      sourceAccounts: account?.acct ? [{ handle: account.acct }] : [],
      sourceComplete: !!account?.acct,
      filterText: a.paragraphs.slice(0, 4).join(' ').slice(0, 1800),
    };
  });
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
  return { items: combineSpotlight(links, recent), bonfireCount: recent.length };
});

/** Fedizen's federated-public REST timeline currently returns 401 anonymously.
 * This is an OWNER-BOUND *read* using this Atlas user's separate delegated
 * Fedizen grant. Only actual PUBLIC posts are projected into Spotlight. This
 * query is never cached globally or passed through the public discovery gateway.
 */
export const getViewerSpotlight = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({ expectedAtlasUserId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }): Promise<SpotlightItem[]> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const connected = await tokenFor(context.userId);
    if (!connected) return [];
    const { readSpotlightModeration } = await import('./spotlight-moderation.server');
    const [moderation, response] = await Promise.all([
      readSpotlightModeration(path => fedizenGet(connected.access_token, path)),
      fedizenGet(connected.access_token, '/api/v1/timelines/public?limit=20'),
    ]);
    if (!moderation || response.status !== 200) return [];
    const publicPosts = response.data.filter(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const status = item as Record<string, unknown>;
      const account = status.account && typeof status.account === 'object'
        ? status.account as Record<string, unknown> : null;
      return status.visibility === 'public' && account?.discoverable !== false &&
        status.sensitive !== true && !(typeof status.spoiler_text === 'string' && status.spoiler_text.trim());
    });
    const videos = fromFederatedVideos(publicPosts);
    const linked = fromFederatedLinkCards(publicPosts);

    // A podcast is accepted only after verified ActivityPub PodcastEpisode
    // parsing, NEVER because a status happened to mention the word podcast.
    const candidates = publicPosts.flatMap(value => {
      const status = value as Record<string, unknown>;
      const card = status.card && typeof status.card === 'object'
        ? status.card as Record<string, unknown> : null;
      if (typeof status.content !== 'string' ||
        !/\b(podcast|episode)\b/i.test(status.content) || typeof card?.url !== 'string' ||
        !/^https:\/\//i.test(card.url) || card.url.length > 2048) return [];
      const author = status.account && typeof status.account === 'object'
        ? status.account as Record<string, unknown> : null;
      if (typeof author?.acct !== 'string' || !author.acct) return [];
      return [{ url: card.url, source: { id: typeof author.id === 'string' ? author.id : undefined, handle: author.acct }, text: status.content.slice(0, 1400) }];
    }).slice(0, 4);
    if (!candidates.length) return combineSpotlight(linked, videos).filter(it => allowedSpotlightItem(it, moderation));
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
    return combineSpotlight(linked, podcasts, videos).filter(it => allowedSpotlightItem(it, moderation));
  });

/** Personal moderation snapshot for BOTH desktop and phone Spotlight. A
 * transport error or partial block list is reported as unavailable, never [].
 */
export const getSpotlightModeration = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({ expectedAtlasUserId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }): Promise<{ moderation: SpotlightModeration | null }> => {
    assertFedizenSessionIntent(data.expectedAtlasUserId, context.userId);
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const connection = await tokenFor(context.userId);
    if (!connection) return { moderation: null };
    const { readSpotlightModeration } = await import('./spotlight-moderation.server');
    return { moderation: await readSpotlightModeration(path => fedizenGet(connection.access_token, path)) };
  });
