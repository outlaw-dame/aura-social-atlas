/** Public-only provider reads for Spotlight. Fixed to the Bonfire instance the
 * Atlas account currently uses, not mastodon.social or arbitrary user URLs.
 * Fedizen's federated public timeline is AUTH REQUIRED and is fetched through
 * the existing owner-bound Fedizen REST client, not this anonymous cache.
 */
import { FEDIZEN } from './fedizen-feed';

export type SpotlightPublicRoute = 'trends';
const ROUTES: Record<SpotlightPublicRoute, string> = {
  trends: '/api/v1/trends/links?limit=12',
};
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 6500;
const POSITIVE_TTL_MS = 5 * 60_000;
const FAILED_TTL_MS = 45_000;
const cache = new Map<SpotlightPublicRoute, { until: number; value: unknown[] }>();
const pending = new Map<SpotlightPublicRoute, Promise<unknown[]>>();

/** Only public, fixed-endpoint data. Never forward Supabase or Fedizen OAuth
 * tokens, cookies, arbitrary URL parameters, or redirects to remote hosts.
 */
export async function fetchFixedFedizenJson(route: SpotlightPublicRoute, fetcher: typeof fetch = fetch): Promise<unknown[]> {
  const path = ROUTES[route];
  if (!path) return [];
  let response: Response;
  try {
    response = await fetcher(FEDIZEN + path, {
      method: 'GET', headers: { accept: 'application/json' },
      credentials: 'omit', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { return []; }
  if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    await response.body?.cancel().catch(() => {});
    return [];
  }
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) { await response.body?.cancel().catch(() => {}); return []; }
  if (!response.body) return [];
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) return [];
      parts.push(value);
    }
  } catch { return []; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return Array.isArray(data) ? data.slice(0, 12) : [];
  } catch { return []; }
}

/** Coalesce requests per runtime, without sharing private identity data (none
 * is used by this path). Remote failures get a short negative TTL.
 */
export async function readFedizenPublicSpotlight(route: SpotlightPublicRoute): Promise<unknown[]> {
  const now = Date.now();
  const previous = cache.get(route);
  if (previous && previous.until > now) return previous.value;
  const current = pending.get(route);
  if (current) return current;
  const work = fetchFixedFedizenJson(route)
    .then(value => {
      cache.set(route, { value, until: Date.now() + (value.length ? POSITIVE_TTL_MS : FAILED_TTL_MS) });
      return value;
    })
    .finally(() => { pending.delete(route); });
  pending.set(route, work);
  return work;
}
