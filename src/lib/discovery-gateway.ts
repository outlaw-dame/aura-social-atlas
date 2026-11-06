/** Public-only gateway contract. Never put administrative credentials in the browser. */
export type DiscoveryItem = {
  id: string; url: string; text: string; summary: string | null;
  author: { name: string | null; handle: string | null; url: string | null; id: string | null } | null;
  origin: string; hashtags: string[]; publishedAt: string | null;
  ingestedAt: string; via: string;
};
export type DiscoveryPage = { items: DiscoveryItem[]; nextCursor: string | null };
export type DiscoveryFilters = { tag?: string; domain?: string; q?: string; cursor?: string | null; limit?: number };
const configured = (import.meta.env.VITE_DISCOVERY_GATEWAY_URL as string | undefined)?.trim() ?? '';

/** Only an explicitly configured HTTPS gateway is used. */
export function discoveryGatewayOrigin(): string | null {
  if (!configured) return null;
  try {
    const u = new URL(configured);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
    if (u.protocol !== 'https:' && !(import.meta.env.DEV && u.protocol === 'http:' && u.hostname === 'localhost')) return null;
    return u.origin;
  } catch { return null; }
}

export function safeExternalUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

/** Browser boundary: the remote read-only gateway can be old or malformed.
 * Never pass unexpected JSONB tags into React where .map would throw. */
export function normalizeDiscoveryItem(value: unknown): DiscoveryItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.id !== 'string' || typeof data.text !== 'string' ||
      typeof data.url !== 'string' || typeof data.origin !== 'string') return null;
  const tags = Array.isArray(data.hashtags)
    ? data.hashtags.filter((tag): tag is string => typeof tag === 'string' && tag.length <= 100).slice(0, 64)
    : [];
  const rawAuthor = data.author;
  const author = rawAuthor && typeof rawAuthor === 'object' && !Array.isArray(rawAuthor)
    ? rawAuthor as Record<string, unknown> : null;
  const nullable = (v: unknown) => typeof v === 'string' ? v : null;
  return {
    id: data.id, url: data.url, text: data.text,
    summary: nullable(data.summary),
    author: author ? { name: nullable(author.name), handle: nullable(author.handle), url: nullable(author.url), id: nullable(author.id) } : null,
    origin: data.origin, hashtags: tags,
    publishedAt: nullable(data.publishedAt),
    ingestedAt: typeof data.ingestedAt === 'string' ? data.ingestedAt : '',
    via: typeof data.via === 'string' ? data.via : '',
  };
}

export async function fetchDiscoveryPage(filters: DiscoveryFilters, signal: AbortSignal): Promise<DiscoveryPage> {
  const origin = discoveryGatewayOrigin();
  if (!origin) throw new Error('Discovery gateway is not configured');
  const url = new URL('/api/v1/items', origin);
  for (const key of ['tag', 'domain', 'q', 'cursor'] as const) {
    const value = filters[key];
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, filters.limit ?? 15))));
  const response = await fetch(url, { signal, credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 429 ? 'Discovery is busy; try again shortly' : 'Unable to load public discovery posts');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || !Array.isArray((value as DiscoveryPage).items)) throw new Error('Invalid discovery response');
  const data = value as DiscoveryPage;
  return { items: data.items.map(normalizeDiscoveryItem).filter((item): item is DiscoveryItem => item !== null), nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null };
}
