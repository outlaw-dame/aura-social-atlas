import process from 'node:process';
import { z } from 'zod';

/**
 * GIFs from KLIPY (klipy.com) for the composer. Server-only: the API key goes in the URL path and KLIPY treats it
 * as a password, so the browser never sees it; it is the KLIPY_API_KEY Worker secret (partner.klipy.com).
 *
 * API (docs.klipy.com; dansup/klipy-php, MIT, used by Pixelfed): GET {base}/{key}/gifs/trending|search with
 * `q`, `page` (from 1), `per_page` (8–50), `rating` (g, pg, pg-13, r), `locale` (xx_YY), answering
 * `{ result, data: { data: [item], current_page, per_page, has_next } }`; GET {base}/{key}/gifs/{slug} for one;
 * POST {base}/{key}/gifs/{slug}/share to count a share. An item has `slug`, `title`, `type` and
 * `file: { hd, md, sm, xs }`, each `{ gif, webp, jpg, mp4, webm }` of `{ url, width, height, size }`. Search and
 * trending may carry ads in place of items; Atlas shows only GIFs.
 *
 * The picked GIF is fetched here and uploaded to Fedizen as an image (Bonfire stores image/gif as it is), so a post
 * never points at KLIPY and readers' servers don't fetch from it.
 */

const BASE = 'https://api.klipy.com/api/v1';
const RESPONSE_LIMIT = 1_500_000;
const TIMEOUT = 8_000;
/** Moderate by default: a GIF lands in a public post. */
const RATING = 'pg-13';

export const klipyKey = () => process.env['KLIPY_API_KEY']?.trim() || null;

/**
 * A GIF file URL as KLIPY's API gives it: https, a public host name, no credentials. KLIPY serves files from its
 * own CDN, whose host Atlas doesn't hardcode; the URL comes from KLIPY's answer to the server, never the browser.
 */
export function isKlipyMedia(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const u = new URL(raw);
    const h = u.hostname;
    return u.protocol === 'https:' && !u.username && !u.password && h.includes('.') && !/^[\d.]+$/.test(h) && !h.startsWith('[') && h !== 'localhost' && !h.endsWith('.localhost') && !h.endsWith('.internal') && !h.endsWith('.local');
  } catch { return false; }
}

const size = z.number().int().nonnegative().finite();
const format = z.object({ url: z.string(), width: size.optional(), height: size.optional(), size: size.optional() }).passthrough();
const variants = z.object({ gif: format.nullish(), webp: format.nullish() }).passthrough();
const item = z.object({
  slug: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  title: z.string().nullish(),
  type: z.string().nullish(),
  file: z.object({ hd: variants.nullish(), md: variants.nullish(), sm: variants.nullish(), xs: variants.nullish() }).passthrough(),
}).passthrough();
type Item = z.infer<typeof item>;

export type Gif = { slug: string; title: string; preview: { url: string; width: number; height: number } };

/** A picker tile: the small WebP (or GIF) KLIPY makes for previews. Null for ads and anything not on KLIPY. */
export function toGif(raw: unknown): Gif | null {
  const p = item.safeParse(raw);
  if (!p.success || (p.data.type && p.data.type !== 'gif')) return null;
  const f = p.data.file;
  const pick = [f.sm?.webp, f.sm?.gif, f.xs?.webp, f.xs?.gif, f.md?.webp, f.md?.gif].find(x => x && isKlipyMedia(x.url));
  if (!pick || !pick.width || !pick.height) return null;
  return { slug: p.data.slug, title: (p.data.title ?? '').trim().slice(0, 300), preview: { url: pick.url, width: pick.width, height: pick.height } };
}

/** The GIF file to post: the largest of hd → md → sm → xs that is known to fit Fedizen's image limit. */
export function pickFile(raw: unknown, maxBytes: number): { url: string; title: string } | null {
  const p = item.safeParse(raw);
  if (!p.success) return null;
  const f = p.data.file;
  const fits = [f.hd?.gif, f.md?.gif, f.sm?.gif, f.xs?.gif].find(x => x && isKlipyMedia(x.url) && x.size !== undefined && x.size > 0 && x.size <= maxBytes);
  // No sizes given: the medium one, which the download then checks.
  const chosen = fits ?? [f.md?.gif, f.sm?.gif].find(x => x && isKlipyMedia(x.url) && x.size === undefined);
  return chosen ? { url: chosen.url, title: (p.data.title ?? '').trim() } : null;
}

async function klipy(path: string, init?: RequestInit): Promise<unknown> {
  const key = klipyKey();
  if (!key) throw new KlipyError('not-configured');
  const res = await fetch(`${BASE}/${encodeURIComponent(key)}/${path}`, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new KlipyError(res.status === 429 ? 'busy' : 'unavailable'); }
  const text = await readCapped(res, RESPONSE_LIMIT);
  return JSON.parse(new TextDecoder().decode(text));
}

export class KlipyError extends Error {
  constructor(readonly reason: 'not-configured' | 'busy' | 'unavailable') { super(`KLIPY: ${reason}`); }
}

/** Trending (no `q`) or search results, one page of 24. */
export async function listGifs(q: string, page: number, locale?: string): Promise<{ gifs: Gif[]; hasNext: boolean }> {
  const params = new URLSearchParams({ page: String(page), per_page: '24', rating: RATING });
  if (q) params.set('q', q);
  if (locale) params.set('locale', locale);
  const r = z.object({ data: z.object({ data: z.array(z.unknown()).max(60), has_next: z.boolean().optional() }) }).parse(await klipy(`gifs/${q ? 'search' : 'trending'}?${params}`));
  const seen = new Set<string>();
  const gifs = r.data.data.map(toGif).filter((g): g is Gif => !!g && !seen.has(g.slug) && !!seen.add(g.slug));
  return { gifs, hasNext: r.data.has_next === true };
}

/** One GIF by its slug, as KLIPY has it now (never a URL from the browser). */
export async function gifItem(slug: string): Promise<Item> {
  const raw = await klipy(`gifs/${encodeURIComponent(slug)}`) as { data?: unknown } | null;
  // Answered as `{ result, data: item }` or the item itself.
  const candidate = raw && typeof raw === 'object' && 'data' in raw && raw.data && typeof raw.data === 'object' && 'slug' in (raw.data as object) ? raw.data : raw;
  return item.parse(candidate);
}

/** Tells KLIPY the GIF was used (it ranks by this). Best-effort: a post never waits on or fails for it. */
export async function countShare(slug: string): Promise<void> {
  await klipy(`gifs/${encodeURIComponent(slug)}/share`, { method: 'POST', body: '{}' }).catch(() => {});
}

/** Downloads a KLIPY GIF, refusing anything that isn't a GIF (by its bytes) or is larger than `maxBytes`. */
export async function downloadGif(url: string, maxBytes: number): Promise<Blob> {
  if (!isKlipyMedia(url)) throw new KlipyError('unavailable');
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new KlipyError('unavailable'); }
  const bytes = await readCapped(res, maxBytes);
  // GIF87a / GIF89a, whatever the header says.
  if (bytes.length < 6 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'GIF8') throw new KlipyError('unavailable');
  return new Blob([bytes], { type: 'image/gif' });
}

class TooLarge extends Error {}
export const isTooLarge = (e: unknown) => e instanceof TooLarge;

async function readCapped(res: Response, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > max) { await res.body?.cancel().catch(() => {}); throw new TooLarge(); }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => {}); throw new TooLarge(); }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
