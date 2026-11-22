import { creditsBesidesAuthor, fromStatuses, type FedizenNotice, type FedizenPost } from './fedizen-feed';

/*
 * What every personal feed adds to Fedizen's posts before Atlas shows them: verified "More from" credits and players
 * for linked articles, real avatars where Fedizen gave its placeholder, and the post each reply answers. Server only;
 * shared by the REST feeds (fedizen.functions.ts) and native Bonfire Home (bonfire-private.functions.ts).
 */

/**
 * "More from" for links in posts, as Mastodon shows under a link preview, but verified the Atlas way: the article's
 * own ActivityPub record (attributedTo) first, then its fediverse:creator tag; an author counts only if their
 * account is on the article's host or lists its domain (attributionDomains). Shares the Spotlight resolver's cache
 * and time budget, so a slow publisher never holds up the feed: what isn't ready shows on the next load.
 */
export async function withArticleAuthors(posts: FedizenPost[], budgetMs = 2000, token?: string): Promise<FedizenPost[]> {
  const enriched = await withArticleAuthorsAndFaces(posts, budgetMs);
  return token ? withReplyParents(enriched, token, Math.min(budgetMs, 1500)) : enriched;
}

/**
 * The post each reply answers, shown above it in feeds as Ivory and Phanpy do (Bonfire's own feed shows only "reply
 * in thread"). Read from Fedizen with the reader's own connection, so Fedizen's boundaries and blocks decide: a parent
 * it won't show (a blocked author or instance, a post the reader may not see) is simply left out. A parent already on
 * the page is reused. At most 12 per page, in parallel, within a time budget.
 */
async function withReplyParents(posts: FedizenPost[], token: string, budgetMs: number): Promise<FedizenPost[]> {
  const onPage = new Map(posts.map(p => [p.statusId ?? p.id, p]));
  const wanted = [...new Set(posts.flatMap(p => (p.replyTo && !onPage.has(p.replyTo.statusId) ? [p.replyTo.statusId] : [])))].slice(0, 12);
  const found = new Map<string, FedizenPost>();
  if (wanted.length) {
    const { fedizenGet } = await import('./fedizen.server');
    const work = Promise.all(wanted.map(async id => {
      const r = await fedizenGet(token, `/api/v1/statuses/${id}`).catch(() => null);
      const parent = r?.status === 200 ? fromStatuses(r.data as never)[0] : undefined;
      if (parent) found.set(id, parent);
    }));
    await Promise.race([work, new Promise(res => setTimeout(res, budgetMs))]);
  }
  return posts.map(p => {
    if (!p.replyTo) return p;
    const parent = found.get(p.replyTo.statusId) ?? onPage.get(p.replyTo.statusId);
    // One level: the parent's own parent isn't carried.
    return parent ? { ...p, replyTo: { statusId: p.replyTo.statusId, post: { ...parent, replyTo: undefined } } } : p;
  });
}

export async function withArticleAuthorsAndFaces(posts: FedizenPost[], budgetMs = 2000): Promise<FedizenPost[]> {
  // Authors' and boosters' real avatars where Fedizen gave its placeholder, alongside the article work.
  const [withAuthors, faces] = await Promise.all([withArticleAuthorsOnly(posts, budgetMs), actorAvatars(posts.flatMap(p => [
    ...(!p.avatar && p.actor ? [p.actor] : []), ...(p.booster && !p.booster.avatar && p.booster.actor ? [p.booster.actor] : []),
  ]), Math.min(budgetMs, 1500))]);
  if (!faces.size) return withAuthors;
  return withAuthors.map(p => {
    const a = !p.avatar && p.actor ? faces.get(p.actor) : undefined;
    const b = p.booster && !p.booster.avatar && p.booster.actor ? faces.get(p.booster.actor) : undefined;
    return a || b ? { ...p, ...(a ? { avatar: a } : {}), ...(b && p.booster ? { booster: { ...p.booster, avatar: b } } : {}) } : p;
  });
}

/** Notices' real avatars where Fedizen gave its placeholder. */
export async function withActorAvatars(notices: FedizenNotice[], budgetMs = 1200): Promise<FedizenNotice[]> {
  const faces = await actorAvatars(notices.flatMap(n => (!n.avatar && n.actor ? [n.actor] : [])), budgetMs);
  return faces.size ? notices.map(n => (!n.avatar && n.actor && faces.get(n.actor) ? { ...n, avatar: faces.get(n.actor) } : n)) : notices;
}

/**
 * The avatar an actor itself publishes (its `icon`), for accounts Fedizen shows with its placeholder picture. Read
 * through the guarded fetch (public hosts only, size and time limits, no cookies), cached per isolate, and bounded by
 * a time budget: one that isn't back in time shows its initial now and its picture on the next load.
 */
const avatarCache = new Map<string, { at: number; url: string | null }>();
export async function actorAvatars(actors: string[], budgetMs: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo: string[] = [];
  for (const a of [...new Set(actors)].slice(0, 24)) {
    const hit = avatarCache.get(a);
    if (hit && Date.now() - hit.at < (hit.url ? 6 * 3600_000 : 3600_000)) { if (hit.url) out.set(a, hit.url); } else todo.push(a);
  }
  if (!todo.length) return out;
  const { fetchActor } = await import('./article-author.server');
  const { isPublicHttpsUrl } = await import('./article-author');
  const work = Promise.all(todo.map(async a => {
    const actor = await fetchActor(a).catch(() => null);
    const icon = actor ? [actor.icon].flat()[0] : undefined;
    const raw = typeof icon === 'string' ? icon : icon && typeof icon === 'object' ? (icon as { url?: unknown }).url : undefined;
    const url = typeof raw === 'string' && isPublicHttpsUrl(raw) && raw.length <= 2048 ? raw : null;
    if (avatarCache.size >= 1000) avatarCache.delete(avatarCache.keys().next().value as string);
    avatarCache.set(a, { at: Date.now(), url });
    if (url) out.set(a, url);
  }));
  await Promise.race([work, new Promise(r => setTimeout(r, budgetMs))]);
  return new Map(out);
}

async function withArticleAuthorsOnly(posts: FedizenPost[], budgetMs = 2000): Promise<FedizenPost[]> {
  const urls = posts.map(p => p.article?.url).filter((u): u is string => !!u);
  if (!urls.length) return posts;
  const { resolveAuthorsFor, mediaFor } = await import('./article-author.server');
  const hints = Object.fromEntries(posts.flatMap(p => (p.article?.authorUrl ? [[p.article.url, { authorUrl: p.article.authorUrl }]] : [])));
  const found = await resolveAuthorsFor(urls, budgetMs, undefined, undefined, hints).catch(() => new Map<string, never[]>());
  return posts.map(p => {
    if (!p.article) return p;
    const a = creditsBesidesAuthor(p, found.get(p.article.url) ?? []);
    const m = mediaFor(p.article.url);
    // A post that already carries the video as an attachment needn't show it twice.
    const video = p.video ? undefined : m?.video;
    // Fedizen made no card for this link: the page's own preview (read while resolving its authors) stands in.
    const preview: { title?: string; description?: string; image?: string; provider?: string } = !p.article.title && m?.preview ? {
      title: m.preview.title, ...(m.preview.description ? { description: m.preview.description } : {}),
      ...(m.preview.image ? { image: m.preview.image } : {}), ...(m.preview.provider ? { provider: m.preview.provider } : {}),
    } : {};
    return a.length || m?.episode || video || preview.title ? { ...p, article: { ...p.article, ...preview, ...(a.length ? { authors: a } : {}), ...(m?.episode ? { episode: m.episode } : {}), ...(video ? { video } : {}) } } : p;
  });
}
