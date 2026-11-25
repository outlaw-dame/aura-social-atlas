import { z } from 'zod';
import { podcastVoices, videoVoices, voices as writerVoices, type Voice, type VoiceCategory } from './voices';

/**
 * Voices to know beyond the curated writers:
 * - FediDB's most-followed fediverse accounts (GET https://api.fedidb.org/v1/popular-accounts; public, no key,
 *   refreshed daily), each sorted by what its server runs (GET /v1/server/domain/{domain}): PeerTube → Video,
 *   Castopod → Podcasters, blog software → Writers, everything else → Popular.
 * - The Castopod Index (https://index.castopod.org/podcastindex.json, from Podcast Index) for podcasters, ranked by
 *   Podcast Index's popularityScore, live shows only; a Castopod show's page is its actor (https://host/@handle).
 * Both are fixed, public, read-only sources fetched server-side, cached for a day; if either is down the curated
 * lists still show.
 */

const DAY = 24 * 60 * 60_000;
const FEDIDB = 'https://api.fedidb.org/v1';
const CASTOPOD_INDEX = 'https://index.castopod.org/podcastindex.json';

async function getJson(url: string, maxBytes: number, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Atlas/1.0 (Voices to know)' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new Error('too large');
  const text = await res.text();
  if (text.length > maxBytes) throw new Error('too large');
  return JSON.parse(text);
}

const https = z.string().url().max(2048).refine(u => u.startsWith('https://'));
const popularAccount = z.object({
  username: z.string().min(1).max(64), name: z.string().max(200).nullish(), domain: z.string().min(3).max(253),
  account_url: https, avatar_url: https.nullish().catch(null), followers_count: z.number().nonnegative().nullish(),
  bio: z.string().max(5000).nullish().catch(null),
});
const serverEntity = z.object({ software: z.object({ name: z.string().max(80).nullish(), slug: z.string().max(80).nullish() }).partial().nullish() }).partial();

const SOFTWARE: [RegExp, VoiceCategory, string][] = [
  [/peertube/i, 'video', 'PeerTube'],
  [/castopod/i, 'podcast', 'Castopod'],
  [/funkwhale/i, 'podcast', 'Funkwhale'],
  [/writefreely|wordpress|ghost|micro\.?blog|bookwyrm|plume/i, 'writer', ''],
];
const strip = (html: string) => html.replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

let popularCache: { at: number; list: Voice[] } | null = null;
async function popular(): Promise<Voice[]> {
  if (popularCache && Date.now() - popularCache.at < DAY) return popularCache.list;
  const raw = await getJson(`${FEDIDB}/popular-accounts`, 2_000_000);
  const rows = (Array.isArray(raw) ? raw : (raw as { data?: unknown })?.data);
  const accounts = (Array.isArray(rows) ? rows : []).map(r => popularAccount.safeParse(r)).flatMap(r => (r.success ? [r.data] : [])).slice(0, 40);
  // What each server runs, a few at a time.
  const domains = [...new Set(accounts.map(a => a.domain.toLowerCase()))];
  const software = new Map<string, string>();
  for (let i = 0; i < domains.length; i += 6) {
    await Promise.all(domains.slice(i, i + 6).map(async d => {
      try { const s = serverEntity.parse(await getJson(`${FEDIDB}/server/domain/${encodeURIComponent(d)}`, 200_000, 5000)); software.set(d, s.software?.slug ?? s.software?.name ?? ''); } catch { /* unknown */ }
    }));
  }
  const list = accounts.map((a): Voice => {
    const sw = software.get(a.domain.toLowerCase()) ?? '';
    const match = SOFTWARE.find(([re]) => re.test(sw));
    return {
      id: `fedidb-${a.username}@${a.domain}`.toLowerCase(), name: cap(strip(a.name ?? '') || a.username, 80), handle: `@${a.username}@${a.domain}`,
      network: match?.[2] || (sw ? sw.charAt(0).toUpperCase() + sw.slice(1) : 'Fediverse'), topic: 'Popular', bio: cap(strip(a.bio ?? ''), 160),
      url: a.account_url, category: match?.[1] ?? 'popular', avatar: a.avatar_url ?? undefined, followers: a.followers_count ?? undefined,
    };
  });
  popularCache = { at: Date.now(), list };
  return list;
}

const castopodShow = z.object({
  title: z.string().min(1).max(300), link: https, description: z.string().max(20000).nullish(), imageUrl: https.nullish().catch(null),
  popularityScore: z.union([z.number(), z.string()]).nullish(), dead: z.union([z.number(), z.boolean()]).nullish(),
  newestItemPubdate: z.number().nullish(), category1: z.string().max(80).nullish(),
});
let podcastCache: { at: number; list: Voice[] } | null = null;
async function castopodPopular(): Promise<Voice[]> {
  if (podcastCache && Date.now() - podcastCache.at < DAY) return podcastCache.list;
  const raw = await getJson(CASTOPOD_INDEX, 8_000_000, 15000);
  const recent = Date.now() / 1000 - 180 * 86400;
  const shows = (Array.isArray(raw) ? raw : []).map(r => castopodShow.safeParse(r)).flatMap(r => (r.success ? [r.data] : []))
    .filter(s => !s.dead && (s.newestItemPubdate ?? 0) > recent)
    .map(s => ({ s, score: Number(s.popularityScore) || 0, m: /^https:\/\/([^/]+)\/@([A-Za-z0-9_]{1,64})\/?$/.exec(s.link) }))
    .filter(x => x.m && x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const list = shows.map(({ s, m }): Voice => ({
    id: `castopod-${m![2]}@${m![1]}`.toLowerCase(), name: cap(s.title, 80), handle: `@${m![2]}@${m![1]}`, network: 'Castopod',
    topic: s.category1 ?? 'Podcasts', bio: cap(strip(s.description ?? ''), 160), url: s.link, category: 'podcast', avatar: s.imageUrl ?? undefined,
  }));
  podcastCache = { at: Date.now(), list };
  return list;
}

/** Every voice, curated first within each category, without duplicates. */
export async function allVoices(): Promise<{ voices: Voice[]; sources: { fedidb: boolean; castopodIndex: boolean } }> {
  // Memory empty (a fresh or woken server): the list kept in Supabase from earlier today (lookup-cache.server.ts).
  const { readLookups, writeLookup } = await import('./lookup-cache.server');
  if (!popularCache && !podcastCache) {
    const kept = (await readLookups<{ voices: Voice[]; sources: { fedidb: boolean; castopodIndex: boolean } }>('voices', ['all'])).get('all');
    if (kept && Array.isArray(kept.voices) && kept.sources?.fedidb && kept.sources?.castopodIndex) return kept;
  }
  const result = await allVoicesFresh();
  if (result.sources.fedidb && result.sources.castopodIndex) writeLookup('voices', 'all', result, 24 * 3_600_000);
  return result;
}

async function allVoicesFresh(): Promise<{ voices: Voice[]; sources: { fedidb: boolean; castopodIndex: boolean } }> {
  const [pop, pods] = await Promise.all([popular().catch(() => null), castopodPopular().catch(() => null)]);
  const seen = new Set<string>();
  const out: Voice[] = [];
  for (const v of [...writerVoices.map(v => ({ ...v, category: 'writer' as const })), ...podcastVoices, ...videoVoices, ...(pods ?? []), ...(pop ?? [])]) {
    const key = v.handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return { voices: out, sources: { fedidb: !!pop, castopodIndex: !!pods } };
}
export function _clearVoiceCaches() { popularCache = null; podcastCache = null; }
