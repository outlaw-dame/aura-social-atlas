import { isPublicHttpsUrl, type FediAuthor } from './article-author';
import type { BonfireArticle } from './spotlight';

/**
 * Where a Fedizen article was published, and who wrote it, with Atlas's author attribution (article-author.server.ts:
 * attributedTo, then fediverse:creator, then author links, each held to actorMayClaim).
 *
 * Fedizen's public articles feed gives each article's address on Fedizen (`https://fedizen.net/pub/objects/…`), not
 * the address it was published at, and its GraphQL has no field for that. Asked for ActivityPub, that address answers
 * with the original object (its own `id` and `url`), so the server reads it there: public data, through safeFetch
 * (public https only, every hop checked, size and time capped). Credits are resolved on the original address, where
 * an author can be checked against the site; an address on Fedizen proves nothing about another site's authors.
 */
const FEDIZEN = 'fedizen.net';
const KEEP_MS = 6 * 3600_000, MISS_MS = 30 * 60_000, MAX = 2000;
const kept = new Map<string, { at: number; url: string | null }>();
const ARTICLE_TYPES = new Set(['Article', 'Page', 'Note', 'Review', 'Document']);

const isFedizenObject = (u: string) => {
  try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === FEDIZEN && x.pathname.startsWith('/pub/objects/'); } catch { return false; }
};
const elsewhere = (u: unknown): u is string => typeof u === 'string' && isPublicHttpsUrl(u) && new URL(u).hostname !== FEDIZEN;

/** The human page of an ActivityPub object: its `url` (a string, a Link's href, or the HTML one of several), else its id. */
export function pageOf(o: Record<string, unknown>): string | undefined {
  const urls = [o.url].flat().map(u => (typeof u === 'string' ? { href: u } : u && typeof u === 'object' ? u as { href?: unknown; mediaType?: unknown } : null)).filter(Boolean) as { href?: unknown; mediaType?: unknown }[];
  const html = urls.find(u => typeof u.mediaType === 'string' && u.mediaType.startsWith('text/html') && elsewhere(u.href)) ?? urls.find(u => elsewhere(u.href));
  if (html) return html.href as string;
  return elsewhere(o.id) ? o.id : undefined;
}

export const originDeps = { safeFetch: (url: string, accept: string) => import('./article-author.server').then(m => m.safeFetch(url, accept)) };

/** The address an article on Fedizen was published at, or null when it's Fedizen's own or can't be read. */
export async function originOf(fedizenUrl: string): Promise<string | null> {
  if (!isFedizenObject(fedizenUrl)) return null;
  const hit = kept.get(fedizenUrl);
  if (hit && Date.now() - hit.at < (hit.url ? KEEP_MS : MISS_MS)) return hit.url;
  let url: string | null = null;
  try {
    const res = await originDeps.safeFetch(fedizenUrl, 'application/activity+json');
    const o = res ? JSON.parse(res.text) as Record<string, unknown> : null;
    if (o && [o.type].flat().some(t => typeof t === 'string' && ARTICLE_TYPES.has(t))) url = pageOf(o) ?? null;
  } catch { /* not readable: no origin */ }
  if (kept.size >= MAX) kept.delete(kept.keys().next().value as string);
  kept.set(fedizenUrl, { at: Date.now(), url });
  return url;
}

/**
 * A page of articles with where each was published (`origin`) and the authors Atlas could verify there (`authors`),
 * within `budgetMs`: what isn't known in time is left out, never guessed, and found on a later load (both are kept).
 */
export async function withOriginsAndAuthors(articles: BonfireArticle[], budgetMs = 2000): Promise<BonfireArticle[]> {
  if (!articles.length) return articles;
  const started = Date.now();
  const origins = new Map<string, string>();
  const reads = Promise.all(articles.map(async a => { const o = await originOf(a.url).catch(() => null); if (o) origins.set(a.id, o); }));
  await Promise.race([reads, new Promise(r => setTimeout(r, budgetMs))]);
  const pages = [...new Set(origins.values())];
  const left = budgetMs - (Date.now() - started);
  let found = new Map<string, FediAuthor[]>();
  if (pages.length && left > 200) {
    const { resolveAuthorsFor } = await import('./article-author.server');
    // resolveAuthorsFor takes 16 addresses a call; a page has up to 20.
    const parts = [];
    for (let i = 0; i < pages.length; i += 16) parts.push(pages.slice(i, i + 16));
    const maps = await Promise.all(parts.map(p => resolveAuthorsFor(p, left).catch(() => new Map<string, FediAuthor[]>())));
    found = new Map(maps.flatMap(m => [...m]));
  }
  return articles.map(a => {
    const origin = origins.get(a.id);
    const authors = origin ? found.get(origin) : undefined;
    return origin ? { ...a, origin, ...(authors?.length ? { authors } : {}) } : a;
  });
}

export function _clearOrigins() { kept.clear(); }
