/** Browser-safe Spotlight types and normalizers (Mastodon trending links + Bonfire articles). */
export type SpotlightItem = {
  id: string; source: 'Mastodon' | 'Bonfire'; title: string; description: string; url: string;
  image?: string; provider: string; author?: string; shares?: number; published?: string;
};

type MastodonLink = { url: string; title: string; description?: string; image?: string | null; provider_name?: string; author_name?: string; history?: { uses: string }[] };
type MastodonStatus = { id: string; url?: string | null; uri: string; content?: string; created_at?: string; account?: { display_name?: string; acct?: string }; card?: { title?: string; description?: string; image?: string | null; url?: string } | null; reblogs_count?: number };

const strip = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export function fromMastodonLinks(links: MastodonLink[]): SpotlightItem[] {
  return links.filter(l => l.url && l.title).map(l => ({
    id: `m:${l.url}`, source: 'Mastodon', title: l.title, description: l.description ?? '', url: l.url,
    image: l.image ?? undefined, provider: l.provider_name || new URL(l.url).hostname, author: l.author_name || undefined,
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
