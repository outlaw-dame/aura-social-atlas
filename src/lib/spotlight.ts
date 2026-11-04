/** Browser-safe Spotlight types and normalizers (Mastodon trending links + Bonfire articles). */
export type SpotlightItem = {
  id: string; source: 'Mastodon' | 'Bonfire'; title: string; description: string; url: string;
  image?: string; provider: string; author?: string; shares?: number; published?: string;
  /** Mastodon 4.3+ author attribution (fediverse:creator) — a verified fediverse account for the writer. */
  authorAccount?: { name: string; acct: string; url: string; avatar?: string };
  authorUrl?: string;
};

type MastodonAuthor = { name?: string; url?: string; account?: { display_name?: string; username?: string; acct?: string; url?: string; avatar?: string } | null };
type MastodonLink = { url: string; title: string; description?: string; image?: string | null; provider_name?: string; author_name?: string; author_url?: string; authors?: MastodonAuthor[]; history?: { uses: string }[] };

const httpOnly = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** Picks the first author with a linked fediverse account, as Mastodon's "More from" byline does. */
export function linkAuthor(l: Pick<MastodonLink, 'authors' | 'author_name' | 'author_url'>) {
  const a = l.authors?.find(x => x.account?.acct && httpOnly(x.account.url));
  const acc = a?.account;
  const acct = acc?.acct ? (acc.acct.includes('@') ? acc.acct : `${acc.acct}@mastodon.social`) : '';
  return {
    author: acc?.display_name || a?.name || l.author_name || undefined,
    authorUrl: httpOnly(a?.url || l.author_url),
    authorAccount: acc && acct ? { name: acc.display_name || acc.username || acct, acct: `@${acct.replace(/^@/, '')}`, url: acc.url!, avatar: httpOnly(acc.avatar) } : undefined,
  };
}
type MastodonStatus = { id: string; url?: string | null; uri: string; content?: string; created_at?: string; account?: { display_name?: string; acct?: string }; card?: { title?: string; description?: string; image?: string | null; url?: string } | null; reblogs_count?: number };

const strip = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export function fromMastodonLinks(links: MastodonLink[]): SpotlightItem[] {
  return links.filter(l => l.url && l.title).map(l => ({
    id: `m:${l.url}`, source: 'Mastodon', title: l.title, description: l.description ?? '', url: l.url,
    image: l.image ?? undefined, provider: l.provider_name || new URL(l.url).hostname, ...linkAuthor(l),
    shares: (l.history ?? []).reduce((n, h) => n + Number(h.uses || 0), 0),
  }));
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
};

export type BonfireActivityNode = {
  id: string; date?: string; canonicalUri?: string; boostCount?: number; likeCount?: number; repliesCount?: number;
  objectPostContent?: { name?: string | null; summary?: string | null; htmlBody?: string | null } | null;
  subject?: { character?: { username?: string; canonicalUri?: string } | null; profile?: { name?: string; icon?: string } | null } | null;
  media?: { url?: string; mediaType?: string }[] | null;
};

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ');

/** Converts remote HTML to plain paragraphs so nothing from the remote server is rendered as markup. */
export function htmlToParagraphs(html = ''): string[] {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').split(/<\/(?:p|h[1-6]|li|blockquote)>|<br\s*\/?>/i)
    .map(chunk => decode(chunk.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const isHttp = (u?: string) => !!u && /^https?:\/\//i.test(u);

export function fromBonfireArticles(nodes: BonfireActivityNode[]): BonfireArticle[] {
  return nodes.flatMap(n => {
    const pc = n.objectPostContent; const title = pc?.name?.trim();
    if (!title) return [];
    const paragraphs = htmlToParagraphs(pc?.htmlBody ?? '');
    if (paragraphs[0]?.toLowerCase() === title.toLowerCase()) paragraphs.shift();
    const image = n.media?.find(m => m.mediaType?.startsWith('image/') && isHttp(m.url))?.url;
    const avatar = n.subject?.profile?.icon;
    return [{
      id: n.id, title, summary: decode(pc?.summary ?? '').trim() || paragraphs[0]?.slice(0, 220) || '', paragraphs,
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
  return nodes.flatMap(n => {
    const pc = n.objectPostContent;
    const paragraphs = [pc?.name?.trim(), ...htmlToParagraphs(pc?.htmlBody ?? '')].filter((t): t is string => !!t);
    if (!paragraphs.length) return [];
    const user = n.subject?.character?.username?.replace(/^@/, '');
    const avatar = n.subject?.profile?.icon;
    return [{
      id: n.id, paragraphs, date: n.date,
      url: isHttp(n.canonicalUri) ? n.canonicalUri! : `https://fedizen.net/post/${encodeURIComponent(n.id)}`,
      author: n.subject?.profile?.name || user || 'Fedizen member',
      handle: user ? `@${user.includes('@') ? user : `${user}@fedizen.net`}` : '',
      avatar: isHttp(avatar) ? avatar : undefined,
      image: n.media?.find(m => m.mediaType?.startsWith('image/') && isHttp(m.url))?.url,
    }];
  });
}
