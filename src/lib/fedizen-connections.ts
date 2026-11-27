/**
 * Atlas's own connections to Fedizen (server only), so they can be thrown away.
 *
 * On 26 Nov 2026 from 23:33 UTC until a restart at 18:38 UTC the next day, every read Atlas's server sent to Fedizen
 * timed out at 10 s (Home, lists, blocks, followed hashtags, groups), while Fedizen's API answered a browser straight
 * away and the restart fixed it at once. Atlas's server hadn't looked fedizen.net up once in that time: it was
 * sending everything over connections it opened earlier and kept for reuse. A connection that dies without being
 * closed (a network path or proxy dropping it silently) swallows every request sent over it until each times out.
 *
 * So Fedizen requests go through a pool of their own:
 * - idle connections are kept briefly (KEEP_IDLE_MS), not for as long as the server allows;
 * - connecting has its own limit (CONNECT_MS), so a log says whether a timeout was in connecting or in Fedizen's
 *   answer (connectTimeouts / answerTimeouts below);
 * - after a timeout the pool is replaced (renewFedizenConnections, at most every RENEW_GAP_MS): new requests open
 *   fresh connections; the old pool is closed once the requests still on it finish, and destroyed after
 *   OLD_POOL_GRACE_MS (a live stream on it reconnects, as it does after any drop).
 *
 * The pool is made from Node's own fetch implementation (undici, which Node ships), found through the global
 * dispatcher it registers (Symbol.for('undici.globalDispatcher.1'), undici's documented global): no extra package,
 * and nothing that breaks on runtimes without it (Cloudflare Workers, Bun in tests), where Fedizen requests simply use
 * the runtime's fetch as before.
 */

export const KEEP_IDLE_MS = 4_000;
export const KEEP_IDLE_MAX_MS = 15_000;
export const CONNECT_MS = 5_000;
export const RENEW_GAP_MS = 5_000;
export const OLD_POOL_GRACE_MS = 30_000;

type Pool = { close(): Promise<void>; destroy(): Promise<void> };
type PoolClass = new (opts: Record<string, unknown>) => Pool;

const GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');

/** Node's own pool class, from the dispatcher its fetch registered; null where there isn't one. */
function poolClass(): PoolClass | null {
  const g = (globalThis as Record<symbol, unknown>)[GLOBAL_DISPATCHER];
  const ctor = g && typeof g === 'object' ? (g as { constructor?: unknown }).constructor : null;
  return typeof ctor === 'function' && ctor !== Object ? (ctor as PoolClass) : null;
}

let current: Pool | null = null;
let renewedAt = 0;
let renewals = 0;

function makePool(): Pool | null {
  const P = poolClass();
  if (!P) return null;
  try {
    return new P({ keepAliveTimeout: KEEP_IDLE_MS, keepAliveMaxTimeout: KEEP_IDLE_MAX_MS, connect: { timeout: CONNECT_MS } });
  } catch { return null; }
}

/**
 * The fetch option that sends a request over Fedizen's own pool: `{ dispatcher }` on Node, nothing elsewhere.
 * Spread it into the fetch init: `fetch(url, { ...fedizenFetchOptions(), method, headers })`.
 */
export function fedizenFetchOptions(): { dispatcher?: unknown } {
  if (!current) current = makePool();
  return current ? { dispatcher: current } : {};
}

/**
 * A request to Fedizen timed out: new requests get fresh connections. Returns whether the pool was replaced (not
 * when it was replaced moments ago, or there's no pool of Atlas's own on this runtime).
 */
export function renewFedizenConnections(now = Date.now()): boolean {
  if (!current || now - renewedAt < RENEW_GAP_MS) return false;
  const old = current;
  current = makePool();
  renewedAt = now;
  renewals++;
  void old.close().catch(() => {});
  setTimeout(() => { void old.destroy().catch(() => {}); }, OLD_POOL_GRACE_MS).unref?.();
  return true;
}

/** Whether a timeout happened while connecting (undici's connect timeout) rather than waiting for Fedizen's answer. */
export function timedOutConnecting(error: unknown): boolean {
  const parts = [error, (error as { cause?: unknown } | null)?.cause];
  return parts.some(p => (p as { code?: unknown } | null)?.code === 'UND_ERR_CONNECT_TIMEOUT');
}

export function connectionStats() { return { pooled: !!current, renewals }; }

/** For tests. */
export function _resetFedizenConnections(pool: Pool | null = null) { current = pool; renewedAt = 0; renewals = 0; }

/**
 * fetch for every request to Fedizen: over Fedizen's own pool, and after a timeout the pool is replaced and the log
 * says whether it timed out connecting or waiting for Fedizen's answer (never the address, headers or message).
 */
export async function fedizenFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, { ...fedizenFetchOptions(), ...init } as RequestInit);
  } catch (e) {
    const timedOut = (e as Error | null)?.name === 'TimeoutError' || timedOutConnecting(e);
    if (timedOut && renewFedizenConnections()) {
      console.warn('Fedizen connections renewed after a timeout', { while: timedOutConnecting(e) ? 'connecting' : 'waiting for an answer', renewals });
    }
    throw e;
  }
}
