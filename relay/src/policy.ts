/** Pure, dependency-free relay policy: configuration parsing and subscription/inbound allowlisting. */

export type RelayProtocol = 'mastodon' | 'litepub';

export type RelayConfig = {
  protocol: RelayProtocol;
  origin: string;
  allowedDomains: string[];
  databaseUrl?: string;
  devMemoryStore: boolean;
  port: number;
  maxBodyBytes: number;
  fetchTimeoutMs: number;
  maxRedirects: number;
};

/** Parses an integer env value within [min, max]; rejects NaN, fractions, negatives and out-of-range values. */
export function intInRange(name: string, raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return def;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
  return n;
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;

/** Hosts that must never be subscribers or fetch targets (basic SSRF guard; also enforce at the network layer). */
export function isPrivateHost(host: string): boolean {
  return PRIVATE_HOST.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
}

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Reads env into a config. Throws rather than ever starting an open or insecure relay. */
export function parseConfig(env: Record<string, string | undefined>): RelayConfig {
  const protocol = env.RELAY_PROTOCOL;
  if (protocol !== 'mastodon' && protocol !== 'litepub') throw new Error('RELAY_PROTOCOL must be "mastodon" or "litepub" (run one instance per protocol, each on its own origin).');
  const devMemoryStore = env.RELAY_DEV_MEMORY === '1';
  let origin: URL;
  try { origin = new URL(env.RELAY_ORIGIN ?? ''); } catch { throw new Error('RELAY_ORIGIN must be an absolute URL such as https://relay.example.com'); }
  if (origin.pathname !== '/' || origin.search || origin.hash) throw new Error('RELAY_ORIGIN must be a bare origin with no path.');
  if (origin.protocol !== 'https:' && !(devMemoryStore && origin.hostname === 'localhost')) throw new Error('RELAY_ORIGIN must use https (http://localhost is allowed only with RELAY_DEV_MEMORY=1).');
  const allowedDomains = (env.RELAY_ALLOWED_DOMAINS ?? '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  if (!allowedDomains.length) throw new Error('RELAY_ALLOWED_DOMAINS is required. Atlas never runs an open relay.');
  for (const d of allowedDomains) if (!DOMAIN.test(d) || isPrivateHost(d)) throw new Error(`RELAY_ALLOWED_DOMAINS contains an invalid or private domain: ${d}`);
  const databaseUrl = env.DATABASE_URL || undefined;
  if (!databaseUrl && !devMemoryStore) throw new Error('DATABASE_URL (PostgreSQL) is required for durable keys, followers and delivery queue. Set RELAY_DEV_MEMORY=1 only for local testing.');
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL must be a postgres:// or postgresql:// URL.');
  return {
    protocol, origin: origin.origin, allowedDomains, databaseUrl, devMemoryStore,
    port: intInRange('PORT', env.PORT, 8787, 1, 65535),
    maxBodyBytes: intInRange('RELAY_MAX_BODY_BYTES', env.RELAY_MAX_BODY_BYTES, 1_000_000, 1024, 10_000_000),
    fetchTimeoutMs: intInRange('RELAY_FETCH_TIMEOUT_MS', env.RELAY_FETCH_TIMEOUT_MS, 10_000, 1000, 60_000),
    maxRedirects: intInRange('RELAY_MAX_REDIRECTS', env.RELAY_MAX_REDIRECTS, 3, 0, 5),
  };
}

/** Exact-host allowlist (no implicit subdomains). Only https actors are accepted. */
export function isAllowedActor(actorId: string | URL | null | undefined, allowed: string[]): boolean {
  if (!actorId) return false;
  let u: URL; try { u = new URL(String(actorId)); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return !isPrivateHost(host) && allowed.includes(host);
}

/** Extracts the sending actor from an inbound activity body without trusting it (signature is verified later by Fedify). */
export function claimedActor(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const a = (body as { actor?: unknown }).actor;
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string') return (a as { id: string }).id;
  return null;
}
