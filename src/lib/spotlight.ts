/** Browser-safe Spotlight types/normalizers: provider-relative links, real ActivityPub articles and media. */
import { htmlToRich, type RichBlock } from './rich-text';
import { isPublicHttpsUrl, type FediAuthor } from './article-author';

export type SpotlightItem = {
  id: string; source: 'Mastodon' | 'Bonfire'; title: string; description: string; url: string;
  image?: string; provider: string; author?: string; shares?: number; published?: string;
  /** A verified media/content classification, never inferred from a popularity count. */
  kind?: 'link' | 'article' | 'podcast' | 'video';
  /** How this item was selected. In particular, 'recent' must not be presented as trending. */
  reason?: 'trending' | 'recent';
  /** The instance from which Atlas learned about the item, NOT the publisher's domain. */
  observedBy?: string;
  /** Identified PUBLIC contributors, distinct from the publisher. Empty means
   * provenance is unknown and personalized Spotlight must suppress the card.
   */
  sourceAccounts?: { id?: string; handle: string; actorUrl?: string }[];
  /** False if any sampled public contributor had no verifiable account. */
  sourceComplete?: boolean;
  /** Sample of the public source-post text to apply the reader's filters. */
  filterText?: string;
  /** First verified fediverse author (kept for existing callers). */
  authorAccount?: FediAuthor;
  /** Every verified fediverse author, up to three — Mastodon only ever shows one. */
  authorAccounts?: FediAuthor[];
  authorUrl?: string;
};

type MastodonAuthor = { name?: string; url?: string; account?: { display_name?: string; username?: string; acct?: string; url?: string; avatar?: string } | null };
type MastodonLink = { url: string; title: string; description?: string; image?: string | null; type?: string; provider_name?: string; author_name?: string; author_url?: string; authors?: MastodonAuthor[]; history?: { uses: string }[] };

const httpOnly = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** Authors with a linked fediverse account, as Mastodon's "More from" byline credits them (Mastodon
 *  has already verified these against the account's attribution domains). Mastodon shows only the first. */
export function linkAuthor(l: Pick<MastodonLink, 'authors' | 'author_name' | 'author_url'>, instanceHost = 'mastodon.social') {
  const available = Array.isArray(l.authors) ? l.authors.filter(x => !!x && typeof x === 'object') : [];
  const accounts: FediAuthor[] = available
    .filter(x => x.account && typeof x.account.acct === 'string' && httpOnly(x.account.url))
    .slice(0, 3)
    .map(x => {
      const acc = x.account!;
      const acct = acc.acct!.includes('@') ? acc.acct! : `${acc.acct}@${instanceHost}`;
      return { name: acc.display_name || acc.username || acct, acct: `@${acct.replace(/^@/, '')}`, url: acc.url!, avatar: httpOnly(acc.avatar), verifiedBy: 'mastodon' as const };
    });
  const first = available.find(x => x.account?.acct && httpOnly(x.account.url));
  return {
    author: first?.account?.display_name || first?.name || available[0]?.name || l.author_name || undefined,
    authorUrl: httpOnly(first?.url || available[0]?.url || l.author_url),
    authorAccount: accounts[0],
    authorAccounts: accounts.length ? accounts : undefined,
  };
}

/** A Fedizen (Bonfire) article's author as a fediverse account: Fedizen already resolved the actor. */
export function bonfireAuthor(a: Pick<BonfireArticle, 'author' | 'handle' | 'avatar' | 'authorUrl'>): FediAuthor | undefined {
  if (!a.handle || !a.authorUrl) return undefined;
  const user = a.handle.replace(/^@/, '');
  return { name: a.author, acct: `@${user.includes('@') ? user : `${user}@fedizen.net`}`, url: a.authorUrl, avatar: a.avatar, verifiedBy: 'fedizen' };
}
type MastodonStatus = { id: string; url?: string | null; uri: string; content?: string; created_at?: string; account?: { display_name?: string; acct?: string }; card?: { title?: string; description?: string; image?: string | null; url?: string } | null; reblogs_count?: number };

const strip = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/** Normalize a Mastodon-compatible trends response from its ACTUAL serving instance.
 * Bonfire's synthetic history.accounts equals reference count, not distinct people.
 * Treat 'uses' only as source-reported references, never as a unique-person count.
 */
export function fromMastodonLinks(
  links: MastodonLink[],
  options: { source?: 'Mastodon' | 'Bonfire'; observedBy?: string } = {},
): SpotlightItem[] {
  const source = options.source ?? 'Mastodon';
  const host = options.observedBy ?? (source === 'Bonfire' ? 'fedizen.net' : 'mastodon.social');
  return links.flatMap(l => {
    if (!l || typeof l !== 'object' || Array.isArray(l) || typeof l.url !== 'string' || !/^https:\/\//i.test(l.url) ||
        typeof l.title !== 'string' || !l.title.trim() || l.title.length > 500) return [];
    let hostname: string;
    try { hostname = new URL(l.url).hostname; } catch { return []; }
    const history = Array.isArray(l.history) ? l.history.slice(0, 14) : [];
    const references = history.reduce((n, h) => {
      const uses = Number(h?.uses);
      return Number.isSafeInteger(uses) && uses >= 0 && uses < 1e8 ? n + uses : n;
    }, 0);
    return [{
      id: `l:${l.url}`, source, title: l.title.trim(), description: typeof l.description === 'string' ? l.description.slice(0, 1000) : '',
      url: l.url, image: isPublicHttpsUrl(l.image ?? undefined) ? l.image ?? undefined : undefined,
      provider: (typeof l.provider_name === 'string' && l.provider_name.trim()) || hostname,
      ...linkAuthor(l, host), shares: references || undefined, kind: l.type === 'video' ? 'video' as const : 'link' as const,
      reason: 'trending' as const, observedBy: host,
    }];
  });
}

/** Bonfire articles arrive as statuses; keep those with a title-bearing card or substantial text. */
export function fromBonfireStatuses(statuses: MastodonStatus[]): SpotlightItem[] {
  return statuses.flatMap(s => {
    const text = strip(s.content);
    const title = s.card?.title || (text.length > 140 ? text.slice(0, 90).replace(/\s\S*$/, '') + '…' : '');
    if (!title) return [];
    return [{
      id: `b:${s.id}`, source: 'Bonfire' as const, title, description: s.card?.description || text.slice(0, 220),
      url: s.card?.url || s.url || s.uri, image: s.card?.image ?? undefined, provider: 'fedizen.net',
      author: s.account?.display_name || s.account?.acct, published: s.created_at,
    }];
  });
}

/** Video candidates seen on the signed-in instance's PUBLIC federated timeline.
 * Media type is explicit, not inferred from link text. PodcastEpisode identity is
 * handled separately by the ActivityPub resolver; generic audio is not a podcast.
 */
export function fromFederatedVideos(statuses: unknown[], observedBy = 'fedizen.net'): SpotlightItem[] {
  return statuses.slice(0, 40).flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const s = value as Record<string, unknown>;
    const account = s.account && typeof s.account === 'object' && !Array.isArray(s.account)
      ? s.account as Record<string, unknown> : null;
    if (account?.discoverable === false || s.visibility !== 'public' || s.sensitive === true ||
        (typeof s.spoiler_text === 'string' && s.spoiler_text.trim()) ||
        typeof s.id !== 'string' || typeof s.url !== 'string' ||
        !isPublicHttpsUrl(s.url) || s.reblog || s.quote || s.in_reply_to_id) return [];
    const media = Array.isArray(s.media_attachments) ? s.media_attachments : [];
    const video = media.find(m => m && typeof m === 'object' &&
      (m as Record<string, unknown>).type === 'video' &&
      isPublicHttpsUrl((m as Record<string, unknown>).url as string));
    if (!video || !media.length) return [];
    const v = video as Record<string, unknown>;
    const text = strip(typeof s.content === 'string' ? s.content : '');
    const title = text.slice(0, 130) || 'Video on the fediverse';
    if (!title || title.length > 200) return [];
    return [{ id: `v:${s.id}`, source: 'Bonfire' as const,
      url: s.url, title, description: text.slice(0, 400),
      image: isPublicHttpsUrl(v.preview_url as string) ? v.preview_url as string : undefined,
      provider: new URL(s.url).hostname, author: typeof account?.display_name === 'string' ? account.display_name : undefined,
      published: typeof s.created_at === 'string' ? s.created_at : undefined,
      kind: 'video' as const, reason: 'recent' as const, observedBy,
      sourceComplete: typeof account?.acct === 'string' && !!account.acct &&
        (isPublicHttpsUrl(account.uri as string) || isPublicHttpsUrl(account.url as string)),
      sourceAccounts: typeof account?.acct === 'string' && account.acct
        ? [{ id: typeof account.id === 'string' ? account.id : undefined,
             handle: account.acct,
             actorUrl: isPublicHttpsUrl(account.uri as string) ? account.uri as string :
               isPublicHttpsUrl(account.url as string) ? account.url as string : undefined }] : [],
      filterText: text.slice(0, 1400),
    }];
  });
}

/** Ranked-but-NOT-trending links sampled from Fedizen's owner-authorized,
 * PUBLIC federated timeline. Requires a substantive preview plus independent
 * evidence of discussion (multiple posts or engagement). A 20-post sample is
 * never portrayed as a complete network trend, or a count of unique people.
 */
export function fromFederatedLinkCards(statuses: unknown[], observedBy = 'fedizen.net'): SpotlightItem[] {
  const groups = new Map<string, { item: SpotlightItem; seen: Set<string>; activity: number }>();
  for (const value of statuses.slice(0, 40)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const status = value as Record<string, unknown>;
    const account = status.account && typeof status.account === 'object' && !Array.isArray(status.account)
      ? status.account as Record<string, unknown> : null;
    if (status.visibility !== 'public' || status.sensitive === true ||
      account?.discoverable === false || status.reblog || status.quote || status.in_reply_to_id ||
      (typeof status.spoiler_text === 'string' && status.spoiler_text.trim()) ||
      typeof status.id !== 'string') continue;
    const card = status.card && typeof status.card === 'object' && !Array.isArray(status.card)
      ? status.card as Record<string, unknown> : null;
    if (!card || typeof card.url !== 'string' || card.url.length > 2048 ||
      typeof card.title !== 'string' || card.title.trim().length < 10 ||
      typeof card.description !== 'string' || card.description.trim().length < 30) continue;
    // A real public story does not need multiple shares or an image to be
    // eligible for the RECENT section. Engagement remains a ranking signal,
    // never a prerequisite or a fabricated "trending" assertion.
    const previewImage = typeof card.image === 'string' && isPublicHttpsUrl(card.image)
      ? card.image : undefined;
    const key = spotlightUrlKey(card.url);
    if (!key) continue;
    const rawActivity = ['reblogs_count', 'replies_count', 'favourites_count'].reduce((total, field) => {
      const count = status[field];
      return total + (typeof count === 'number' && Number.isInteger(count) && count >= 0 && count < 1e6 ? count : 0);
    }, 0);
    const actorUrl = isPublicHttpsUrl(account?.uri as string) ? account?.uri as string :
      isPublicHttpsUrl(account?.url as string) ? account?.url as string : undefined;
    const contributor = typeof account?.acct === 'string' && account.acct && actorUrl
      ? { id: typeof account.id === 'string' ? account.id : undefined,
          handle: account.acct, actorUrl }
      : null;
    const sourceText = strip(typeof status.content === 'string' ? status.content : '').slice(0, 500);
    const existing = groups.get(key);
    if (existing) {
      if (existing.seen.has(status.id)) continue;
      existing.seen.add(status.id);
      if (contributor) existing.item.sourceAccounts?.push(contributor);
      else existing.item.sourceComplete = false; // never restored by later sharers
      existing.item.filterText = [existing.item.filterText, sourceText].filter(Boolean).join(' ').slice(0, 1800);
      existing.activity = Math.max(existing.activity, rawActivity);
      continue;
    }
    const author = typeof account?.display_name === 'string' ? account.display_name : undefined;
    groups.set(key, {
      seen: new Set([status.id]), activity: rawActivity,
      item: {
        id: `f:${key}`, source: 'Bonfire', url: card.url,
        title: card.title.trim().slice(0, 200), description: card.description.trim().slice(0, 400),
        image: previewImage, provider: (typeof card.provider_name === 'string' && card.provider_name.trim())
          || new URL(key).hostname,
        author, published: typeof status.created_at === 'string' ? status.created_at : undefined,
        kind: 'link', reason: 'recent', observedBy,
        sourceAccounts: contributor ? [contributor] : [], sourceComplete: !!contributor,
        filterText: sourceText,
      },
    });
  }
  return [...groups.values()]
    .sort((a, b) => b.activity - a.activity || b.seen.size - a.seen.size)
    .slice(0, 8)
    .map(({ item, seen }) => ({ ...item, shares: seen.size }));
}

/** A story can arrive as a trending link and a native article; display one
 * entity rather than adding overlapping cross-instance share counters.
 * Do not collapse distinct query URLs unless they have explicitly-safe tracking parameters.
 */
export function spotlightUrlKey(value: string): string | null {
  if (!isPublicHttpsUrl(value)) return null;
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return null; }
}

export function combineSpotlight(...sources: SpotlightItem[][]): SpotlightItem[] {
  const result: SpotlightItem[] = [];
  const seen = new Set<string>();
  const max = Math.max(0, ...sources.map(source => source.length));
  for (let i = 0; i < max; i++) {
    for (const group of sources) {
      const item = group[i];
      if (!item) continue;
      const key = spotlightUrlKey(item.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/** Interleave sources so Spotlight reads as a mix rather than two blocks. */
export function mixSpotlight(a: SpotlightItem[], b: SpotlightItem[]): SpotlightItem[] {
  const out: SpotlightItem[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
  return out;
}

/** A real Bonfire Article from Fedizen's GraphQL "articles" feed (never a guessed long post). */
export type BonfireArticle = {
  id: string; title: string; summary: string; paragraphs: string[]; url: string; date?: string;
  author: string; handle?: string; avatar?: string; image?: string; likes: number; boosts: number; replies: number;
  /** The author's actor/profile URL on the fediverse. */
  authorUrl?: string;
};

export type BonfireActivityNode = {
  id: string; date?: string; canonicalUri?: string; boostCount?: number; likeCount?: number; repliesCount?: number;
  objectPostContent?: { name?: string | null; summary?: string | null; htmlBody?: string | null } | null;
  subject?: { character?: { username?: string; canonicalUri?: string } | null; profile?: { name?: string; icon?: string } | null } | null;
  media?: { url?: string; mediaType?: string }[] | null;
  verb?: { verb?: string | null } | null;
  object?: { id?: string; creator?: BonfireActivityNode['subject'] } | null;
};

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ');

const INLINE_TAG = /<\/?(?:a|span|b|strong|i|em|u|s|del|ins|code|small|sub|sup|mark|abbr|bdi|bdo|cite|data|dfn|kbd|q|samp|time|var)(?:\s[^>]*)?>/gi;

/** Converts remote HTML to plain paragraphs so nothing from the remote server is rendered as markup. */
export function htmlToParagraphs(html = ''): string[] {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').split(/<\/(?:p|h[1-6]|li|blockquote)>|<br\s*\/?>/i)
    // Inline tags join their text as written ("@<span>nedley</span>" → "@nedley", and a Mastodon link's
    // invisible "https://" parts back into one URL); any other tag is a word break.
    .map(chunk => decode(chunk.replace(INLINE_TAG, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const isHttp = (u?: string) => !!u && /^https?:\/\//i.test(u);

/** HTML tags that arrived escaped (`&lt;img src=…&gt;`), which Bridgy Fed's web posts and some feeds put in an
 *  article's summary: once decoded they would read as markup. Only real element names count, so prose such as
 *  "a < b" or "<3" is kept. For article summaries and bodies only, never for text a person edits (bios). */
const ESCAPED_TAG = /<\/?(?:a|abbr|b|blockquote|br|code|div|em|figcaption|figure|h[1-6]|hr|i|img|li|ol|p|picture|pre|small|source|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul|video)(?:\s[^<>]*)?\/?>/gi;
const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*["'](https:\/\/[^"'\s<>]+)["']/i;
export const withoutEscapedTags = (text: string) => text.replace(ESCAPED_TAG, ' ').replace(/\s+/g, ' ').trim();
/** Article text with any escaped markup taken out; lines left empty are dropped. */
export function articleParagraphs(html = ''): string[] {
  return htmlToParagraphs(html).map(withoutEscapedTags).filter(Boolean);
}
/** The first https image in an article's HTML, escaped or not: Bridgy Fed web posts carry their picture only there. */
export function firstImageIn(html = ''): string | undefined {
  return (html.match(IMG_SRC) ?? decode(html).match(IMG_SRC))?.[1];
}

export function fromBonfireArticles(nodes: BonfireActivityNode[]): BonfireArticle[] {
  return nodes.map(withAuthor).flatMap(n => {
    const pc = n.objectPostContent; const title = pc?.name?.trim();
    if (!title) return [];
    const paragraphs = articleParagraphs(pc?.htmlBody ?? '');
    if (paragraphs[0]?.toLowerCase() === title.toLowerCase()) paragraphs.shift();
    const image = n.media?.find(m => m.mediaType?.startsWith('image/') && isHttp(m.url))?.url ?? firstImageIn(pc?.htmlBody ?? '') ?? firstImageIn(pc?.summary ?? '');
    const avatar = n.subject?.profile?.icon;
    const actorUrl = n.subject?.character?.canonicalUri;
    return [{
      authorUrl: isHttp(actorUrl) && actorUrl!.startsWith('https://') ? actorUrl : undefined,
      id: n.id, title, summary: articleParagraphs(pc?.summary ?? '').join(' ') || paragraphs[0]?.slice(0, 220) || '', paragraphs,
      url: isHttp(n.canonicalUri) ? n.canonicalUri! : `https://fedizen.net/post/${n.id}`, date: n.date,
      author: n.subject?.profile?.name || n.subject?.character?.username || 'Fedizen author',
      handle: n.subject?.character?.username ? `@${n.subject.character.username.replace(/^@/, '')}` : undefined,
      avatar: isHttp(avatar) ? avatar : undefined, image,
      likes: n.likeCount ?? 0, boosts: n.boostCount ?? 0, replies: n.repliesCount ?? 0,
    }];
  });
}

/** Any Bonfire activity (short posts included) as a plain-text feed post; remote HTML never rendered. */
export function fromBonfirePosts(nodes: BonfireActivityNode[]) {
  const seen = new Set<string>();
  return nodes.flatMap(raw => {
    // Boosts: credit the original author, show the booster, and show each object only once.
    const boost = raw.verb?.verb === 'Boost' || raw.verb?.verb === 'Announce';
    const key = raw.object?.id ?? raw.id;
    if (seen.has(key)) return [];
    seen.add(key);
    const booster = boost ? (raw.subject?.profile?.name || raw.subject?.character?.username) : undefined;
    const n = boost && raw.object?.creator ? { ...raw, subject: raw.object.creator } : withAuthor(raw);
    const pc = n.objectPostContent;
    const paragraphs = [pc?.name?.trim(), ...htmlToParagraphs(pc?.htmlBody ?? '')].filter((t): t is string => !!t);
    if (!paragraphs.length) return [];
    const body = htmlToRich(pc?.htmlBody);
    const rich: RichBlock[] | undefined = body && (pc?.name?.trim() ? [{ t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: pc.name.trim() }] }] }, ...body] : body);
    const user = n.subject?.character?.username?.replace(/^@/, '');
    const avatar = n.subject?.profile?.icon;
    return [{
      id: n.id, paragraphs, ...(rich ? { rich } : {}), date: n.date,
      url: isHttp(n.canonicalUri) ? n.canonicalUri! : `https://fedizen.net/post/${encodeURIComponent(n.id)}`,
      author: n.subject?.profile?.name || user || 'Fedizen member',
      handle: user ? `@${user.includes('@') ? user : `${user}@fedizen.net`}` : '',
      avatar: isHttp(avatar) ? avatar : undefined,
      image: n.media?.find(m => m.mediaType?.startsWith('image/') && isHttp(m.url))?.url,
      boostedBy: booster || undefined,
    }];
  });
}

/** Bonfire may hide the activity subject; the post's creator is the same author. */
function withAuthor(n: BonfireActivityNode): BonfireActivityNode {
  return n.subject?.character || n.subject?.profile ? n : { ...n, subject: n.object?.creator ?? n.subject };
}
