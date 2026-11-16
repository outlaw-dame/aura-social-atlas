/** Browser-safe Fedizen (Mastodon-compatible) feed types, normalizers and redirect allowlist. */
import { htmlToParagraphs } from './spotlight';
import { collectionLinksIn, mastodonCollectionApi } from './collections';
import { isPublicHttpsUrl, type FediAuthor } from './article-author';
import type { FediEpisode } from './podcast-episode';
import { videoFromAttachment, watchUrlFor, type FediVideo } from './fedi-video';

export const FEDIZEN = 'https://fedizen.net';
/** Fedizen's own pages for what its API doesn't offer yet (Bonfire v1.1.0-rc.1: bonfire_ui_me SafetyLive, bonfire_ui_boundaries BoundariesLive). */
export const FEDIZEN_KEYWORD_FILTERS_URL = `${FEDIZEN}/settings/user/safety`;
export const FEDIZEN_BLOCKED_URL = `${FEDIZEN}/settings/boundaries/blocked`;
/** What Atlas asks Fedizen for: read your timeline and notifications, and act for you — join and leave
 *  groups, follow, post. Mastodon scope names, which Bonfire's OAuth provider (bonfire_open_id) supports. */
export const FEDIZEN_API_SCOPE = 'read write follow';

/** Where to return after connecting Fedizen: a same-site path only (never `//host` or a URL), else Feeds. */
export const RETURN_KEY = 'atlas-fedizen-return';
export function safeReturnPath(p: string | null | undefined): string {
  return p && /^\/(?![\/\\])[\w\-./?=&%]*$/.test(p) && !p.startsWith('/fedizen/') ? p : '/feeds';
}

/** Does a granted scope string cover `needed`? A parent scope covers its children ("write" covers "write:follows"). */
export function hasScope(granted: string | null | undefined, needed: string): boolean {
  const have = new Set(String(granted ?? '').split(/\s+/).filter(Boolean));
  return have.has(needed) || (needed.includes(':') && have.has(needed.split(':')[0]));
}

export type FedizenPost = { id: string; /** The post itself (the boosted one for a boost), for bookmarking. */ statusId?: string; bookmarked?: boolean; author: string; handle: string; avatar?: string; paragraphs: string[]; url: string; date?: string; image?: string; /** The author marked its media sensitive. */ sensitive?: boolean; boostedBy?: string; /** Mastodon collections linked in the post. */ collections?: string[];
  /** A video attached to the post (a federated PeerTube video arrives this way). */ video?: FediVideo;
  /** The article the post links to, and who wrote it as far as Atlas can verify ("More from"). */ article?: PostArticle;
  /** Reply, boost and like counts, and whether the person has liked or boosted it (Fedizen statuses only). */
  counts?: { replies: number; boosts: number; likes: number }; liked?: boolean; boosted?: boolean;
  /** Who can see it; a reply keeps to this audience. */ visibility?: 'public' | 'unlisted' | 'private' | 'direct';
  /** What keyword filters read besides the text: content warning, hashtags, image descriptions, link preview, poll
   *  options, the quoted post's words, and the author's account id (for "except people I follow"). */
  cw?: string; tags?: string[]; alt?: string[]; linkTitle?: string; linkDescription?: string; poll?: string[]; quote?: string; authorId?: string };
export type PostArticle = { url: string; title?: string; provider?: string; byline?: string; /** The preview's summary and image. */ description?: string; image?: string; /** The preview's author link: checked for an ActivityPub account, never shown as-is. */ authorUrl?: string; authors?: FediAuthor[]; /** A podcast episode Atlas can play in place. */ episode?: FediEpisode; /** A video (PeerTube) Atlas can play in place. */ video?: FediVideo };
export type FedizenNotice = { id: string; type: string; author: string; avatar?: string; date?: string; text: string };
/** A direct conversation (Mastodon `Conversation`): the other people in it and its latest message, as plain text. */
export type FedizenConversation = { id: string; unread: boolean; people: { name: string; handle: string; avatar?: string }[]; text: string; date?: string; url?: string };

type Acct = { id?: string; display_name?: string; acct?: string; username?: string; avatar?: string };
type Status = { id: string; url?: string | null; uri?: string; created_at?: string; content?: string; account?: Acct; reblog?: Status | null; media_attachments?: { type?: string; url?: string; preview_url?: string; remote_url?: string | null; description?: string | null; meta?: unknown }[]; bookmarked?: boolean | null; sensitive?: boolean | null; card?: { url?: string | null; title?: string | null; provider_name?: string | null; author_name?: string | null; author_url?: string | null; description?: string | null; image?: string | null } | null;
  replies_count?: number | null; reblogs_count?: number | null; favourites_count?: number | null; favourited?: boolean | null; reblogged?: boolean | null; visibility?: FedizenPost['visibility'] | null;
  spoiler_text?: string | null; tags?: { name?: string }[] | null; poll?: { options?: { title?: string }[] } | null;
  quote?: { quoted_status?: { content?: string | null; spoiler_text?: string | null; media_attachments?: { description?: string | null }[] | null } | null } | null };
type Notice = { id: string; type?: string; created_at?: string; account?: Acct; status?: Status | null };

const http = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);
const name = (a?: Acct) => a?.display_name || a?.username || a?.acct || 'Someone';

export function fromStatuses(list: Status[]): FedizenPost[] {
  return list.map(s => {
    const o = s.reblog ?? s;
    return {
      id: s.id, statusId: o.id, bookmarked: o.bookmarked === true || s.bookmarked === true, author: name(o.account), handle: `@${o.account?.acct ?? ''}`, avatar: http(o.account?.avatar),
      paragraphs: htmlToParagraphs(o.content ?? ''), url: http(o.url) ?? http(o.uri) ?? FEDIZEN, date: o.created_at,
      image: http(o.media_attachments?.find(m => m.type === 'image')?.preview_url ?? o.media_attachments?.find(m => m.type === 'image')?.url),
      boostedBy: s.reblog ? name(s.account) : undefined,
      ...(o.sensitive === true && o.media_attachments?.length ? { sensitive: true } : {}),
      ...(typeof o.replies_count === 'number' || typeof o.reblogs_count === 'number' || typeof o.favourites_count === 'number'
        ? { counts: { replies: o.replies_count ?? 0, boosts: o.reblogs_count ?? 0, likes: o.favourites_count ?? 0 } } : {}),
      ...(o.favourited === true ? { liked: true } : {}), ...(o.reblogged === true ? { boosted: true } : {}),
      ...(o.visibility ? { visibility: o.visibility } : {}),
      ...(o.spoiler_text?.trim() ? { cw: o.spoiler_text.trim() } : {}),
      ...(() => { const t = (o.tags ?? []).map(x => x.name).filter((n): n is string => !!n); return t.length ? { tags: t } : {}; })(),
      ...(() => { const a = (o.media_attachments ?? []).map(m => m.description?.trim()).filter((d): d is string => !!d); return a.length ? { alt: a } : {}; })(),
      ...(o.card?.title ? { linkTitle: o.card.title } : {}),
      ...(o.card?.description ? { linkDescription: o.card.description } : {}),
      ...(o.account?.id ? { authorId: o.account.id } : {}),
      ...(() => { const p = (o.poll?.options ?? []).map(x => x.title?.trim()).filter((t): t is string => !!t); return p.length ? { poll: p } : {}; })(),
      ...(() => {
        const q = o.quote?.quoted_status;
        if (!q) return {};
        const text = [q.spoiler_text ?? '', ...htmlToParagraphs(q.content ?? ''), ...(q.media_attachments ?? []).map(m => m.description ?? '')].map(t => t.trim()).filter(Boolean).join('\n');
        return text ? { quote: text.slice(0, 2000) } : {};
      })(),
      ...(() => { for (const m of o.media_attachments ?? []) { const v = videoFromAttachment(m, http(o.url) ?? http(o.uri) ?? FEDIZEN); if (v) return { video: v }; } return {}; })(),
      ...(() => { const c = collectionLinksIn(o.content ?? ''); return c.length ? { collections: c } : {}; })(),
      ...(() => { const a = articleOf(o); return a ? { article: a } : {}; })(),
    };
  });
}

const verbs: Record<string, string> = { favourite: 'liked your post', reblog: 'boosted your post', follow: 'followed you', mention: 'mentioned you', status: 'posted', poll: 'poll ended', follow_request: 'asked to follow you', added_to_collection: 'added you to a collection', collection_update: 'updated a collection you’re in' };
export function fromNotifications(list: Notice[]): FedizenNotice[] {
  return list.map(n => ({
    id: n.id, type: n.type ?? 'other', author: name(n.account), avatar: http(n.account?.avatar), date: n.created_at,
    text: `${verbs[n.type ?? ''] ?? 'interacted with you'}${n.status?.content ? ` — ${htmlToParagraphs(n.status.content).join(' ').slice(0, 140)}` : ''}`,
  }));
}

type Conversation = { id: string; unread?: boolean; accounts?: Acct[]; last_status?: Status | null };
export function fromConversations(list: Conversation[]): FedizenConversation[] {
  return list.filter(c => c && typeof c.id === 'string').map(c => ({
    id: c.id, unread: c.unread === true,
    people: (c.accounts ?? []).map(a => ({ name: name(a), handle: `@${a.acct ?? a.username ?? ''}`, avatar: http(a.avatar) })),
    text: htmlToParagraphs(c.last_status?.content ?? '').join(' ').slice(0, 200),
    date: c.last_status?.created_at, url: http(c.last_status?.url) ?? http(c.last_status?.uri),
  }));
}

/**
 * A caller-supplied hostname is NOT a valid OAuth redirect trust boundary.
 * The HTTP Origin header must match the requested callback origin exactly.
 *
 * ATLAS_FEDIZEN_CALLBACK_ORIGINS is an optional comma-separated list of
 * canonical deployment origins. If configured it is an exact allowlist;
 * otherwise only the origin that served this request on an existing Atlas
 * Lovable host (or localhost for development) can initiate the connection.
 *
 * Custom domains MUST be explicitly configured in the exact allowlist.
 */
function parseCanonicalOrigin(value: string): URL | null {
  if (value.length > 256) return null;
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function allowedCallback(
  requestedOrigin: string,
  requestOrigin: string | null,
  configuredOrigins = '',
): string | null {
  const requested = parseCanonicalOrigin(requestedOrigin);
  const caller = requestOrigin ? parseCanonicalOrigin(requestOrigin) : null;
  if (!requested || !caller || requested.origin !== caller.origin) return null;

  const configured = configuredOrigins.split(',').map(origin => origin.trim()).filter(Boolean);
  let allowed: boolean;
  if (configured.length) {
    allowed = configured.some(origin => {
      const parsed = parseCanonicalOrigin(origin);
      return parsed !== null && parsed.protocol === 'https:' && parsed.origin === requested.origin;
    });
  } else {
    const host = requested.hostname;
    allowed = (requested.protocol === 'https:' &&
      (host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com'))) ||
      (requested.protocol === 'http:' && host === 'localhost');
  }
  return allowed ? `${requested.origin}/fedizen/callback` : null;
}

/**
 * Both Home and notifications are distinct authorized reads. A successful
 * timeline must never mask a failed notifications request (or vice versa).
 * 401 indicates the API grant must be reconnected; other failures are transient
 * or permission-specific and must not silently appear as empty results.
 */
export function fedizenReadError(homeStatus: number, notificationStatus: number): 'expired' | 'unavailable' | undefined {
  if (homeStatus === 401 || notificationStatus === 401) return 'expired';
  if (homeStatus !== 200 || notificationStatus !== 200) return 'unavailable';
  return undefined;
}

/**
 * Bind a browser-initiated Fedizen action to the Atlas session that displayed
 * it. The server's independently verified Supabase user ID is authoritative;
 * the expected ID only prevents session-switch races, never grants access.
 */
export function assertFedizenSessionIntent(expectedUserId: string, authenticatedUserId: string): void {
  if (!expectedUserId || expectedUserId !== authenticatedUserId) {
    throw new Error('Atlas session changed. Sign in again before continuing with Fedizen.');
  }
}

/** A Bonfire circle (served to Mastodon clients as a List): a named group of people you choose. */
export type FedizenCircle = { id: string; title: string };
/** Someone in a circle, or found by handle to add to one. */
export type FedizenPerson = { id: string; name: string; handle: string; avatar?: string };

export function fromLists(list: { id: string; title?: string | null }[]): FedizenCircle[] {
  return list.filter(l => l && typeof l.id === 'string').map(l => ({ id: l.id, title: (l.title ?? '').trim() || 'Untitled circle' }));
}
export function fromAccounts(list: Acct[]): FedizenPerson[] {
  return list.filter(a => a && typeof a.id === 'string' && a.id).map(a => ({ id: a.id!, name: name(a), handle: `@${a.acct ?? a.username ?? ''}`, avatar: http(a.avatar) }));
}
/** "@name@server", "name@server" or "name" → what Mastodon's account lookup takes, or null. */
export function lookupAcct(handle: string): string | null {
  const h = handle.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_.-]{1,64}(@[A-Za-z0-9.-]{1,253})?$/.test(h) ? h : null;
}

/**
 * The article a post links to: Bonfire's link preview when it has one, else the first ordinary link in the text.
 * Mentions, hashtags and Mastodon collection links are not articles. Only public https URLs.
 */
/** Credits worth showing on a post: not the post's own author (a podcast sharing its own episode, say). */
export function creditsBesidesAuthor(post: Pick<FedizenPost, 'handle'>, authors: FediAuthor[]): FediAuthor[] {
  const own = post.handle.toLowerCase();
  return own.includes('@', 1) ? authors.filter(a => a.acct.toLowerCase() !== own) : authors;
}

export function articleLinkIn(html: string): string | undefined {
  for (const m of html.matchAll(/<a\s([^>]{0,1000})>/gi)) {
    const attrs = m[1];
    const href = /href\s*=\s*"([^"]{1,2048})"/i.exec(attrs)?.[1]?.replace(/&amp;/g, '&');
    if (!href || /class\s*=\s*"[^"]*\b(mention|hashtag|u-url)\b/i.test(attrs) || /rel\s*=\s*"[^"]*\btag\b/i.test(attrs)) continue;
    if (isPublicHttpsUrl(href) && !mastodonCollectionApi(href)) return href;
  }
  return undefined;
}
function articleOf(o: Status): PostArticle | undefined {
  const card = o.card;
  const linked = card?.url && isPublicHttpsUrl(card.url) && !mastodonCollectionApi(card.url) ? card.url : articleLinkIn(o.content ?? '');
  if (!linked) return undefined;
  // A PeerTube embed link resolves through its watch page.
  const url = watchUrlFor(linked);
  const fromCard = card?.url === linked;
  const clip = (v?: string | null, n = 200) => (v && v.trim() ? v.trim().slice(0, n) : undefined);
  const authorUrl = fromCard && isPublicHttpsUrl(card?.author_url) ? card!.author_url! : undefined;
  const image = fromCard && isPublicHttpsUrl(card?.image) ? card!.image! : undefined;
  return { url, title: fromCard ? clip(card?.title, 300) : undefined, provider: fromCard ? clip(card?.provider_name, 100) : undefined, byline: fromCard ? clip(card?.author_name, 100) : undefined,
    ...(() => { const d = fromCard ? clip(card?.description, 400) : undefined; return d ? { description: d } : {}; })(), ...(image ? { image } : {}), ...(authorUrl ? { authorUrl } : {}) };
}
