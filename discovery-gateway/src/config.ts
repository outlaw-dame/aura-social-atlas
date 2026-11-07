/**
 * Environment configuration. Every value is validated at startup; the service
 * fails closed (refuses to start) on missing or malformed required values.
 */

export type GatewayConfig = {
  /** Public origin of this gateway, e.g. https://gateway.example.com. Trailing slash stripped. */
  origin: string;
  /** PostgreSQL connection string. Required unless devMemoryStore is set. */
  databaseUrl: string | null;
  /** Bearer token for the admin API. Required, min 32 chars. Never exposed to any frontend. */
  adminToken: string;
  /** Origins allowed to call the public read API cross-origin (CORS). Empty = same-origin only. */
  corsAllowlist: string[];
  /** Reserved for compatibility; always false because PostgreSQL is required. */
  devMemoryStore: boolean;
  /** Port for Bun.serve. */
  port: number;
  /** Max bytes accepted for an inbound federation POST body. */
  maxBodyBytes: number;
  /** Max redirects followed when fetching remote objects. */
  maxRedirects: number;
  /** Timeout for outbound fetches (actor resolution, key fetches). */
  fetchTimeoutMs: number;
  /** Max stored items; oldest are pruned beyond this. */
  maxItems: number;
  /** Max characters of sanitized text kept per item. */
  maxTextLength: number;
  /** Public read API: max requests per IP per minute (per process). */
  readRateLimitPerMinute: number;
  /** Admin API: max requests per IP per minute (per process). */
  adminRateLimitPerMinute: number;
  /** Inbound federation POST admission cap per minute, per process, before body parsing/signature verification. */
  federationRateLimitPerMinute: number;
};

function required(env: Record<string, string | undefined>, name: string): string {
  const v = env[name];
  if (!v || !v.trim()) throw new Error(`Missing required environment variable ${name}.`);
  return v.trim();
}

function intInRange(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer, got ${JSON.stringify(raw)}.`);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}, got ${n}.`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const origin = required(env, 'GATEWAY_ORIGIN').replace(/\/+$/, '');
  const originUrl = new URL(origin);
  if (originUrl.pathname !== '/' || originUrl.search || originUrl.hash || originUrl.username || originUrl.password) {
    throw new Error('GATEWAY_ORIGIN must be a bare origin without paths, query, fragment or credentials.');
  }
  if (originUrl.protocol !== 'https:' && !(originUrl.protocol === 'http:' && (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1'))) {
    throw new Error('GATEWAY_ORIGIN must be an https URL (http allowed only for localhost dev).');
  }
  // The discovery store holds canonical posts, keys and subscriptions;
  // unlike Fedify's in-memory queue, these cannot safely run without a DB.
  if (env['GATEWAY_DEV_MEMORY'] === '1') {
    throw new Error('GATEWAY_DEV_MEMORY is unsupported: PostgreSQL is required even in development.');
  }
  const devMemoryStore = false;
  const databaseUrl = required(env, 'DATABASE_URL');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error('DATABASE_URL must use a PostgreSQL connection URL.');
  }
  const adminToken = required(env, 'GATEWAY_ADMIN_TOKEN');
  if (adminToken.length < 32) throw new Error('GATEWAY_ADMIN_TOKEN must be at least 32 characters.');
  const corsAllowlist = (env['GATEWAY_CORS_ORIGINS'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(o => {
      const u = new URL(o);
      if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
        throw new Error('CORS origins must not contain paths or credentials.');
      }
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
        throw new Error(`CORS origin ${JSON.stringify(o)} must be https (localhost excepted).`);
      }
      return u.origin;
    });
  return {
    origin: originUrl.origin,
    databaseUrl,
    adminToken,
    corsAllowlist,
    devMemoryStore,
    port: intInRange('PORT', env['PORT'], 4100, 1, 65535),
    maxBodyBytes: intInRange('GATEWAY_MAX_BODY_BYTES', env['GATEWAY_MAX_BODY_BYTES'], 1_048_576, 1024, 16 * 1024 * 1024),
    maxRedirects: intInRange('GATEWAY_MAX_REDIRECTS', env['GATEWAY_MAX_REDIRECTS'], 3, 0, 10),
    fetchTimeoutMs: intInRange('GATEWAY_FETCH_TIMEOUT_MS', env['GATEWAY_FETCH_TIMEOUT_MS'], 10_000, 1000, 60_000),
    maxItems: intInRange('GATEWAY_MAX_ITEMS', env['GATEWAY_MAX_ITEMS'], 50_000, 100, 1_000_000),
    maxTextLength: intInRange('GATEWAY_MAX_TEXT_LENGTH', env['GATEWAY_MAX_TEXT_LENGTH'], 4_000, 100, 50_000),
    readRateLimitPerMinute: intInRange('GATEWAY_READ_RATE_LIMIT', env['GATEWAY_READ_RATE_LIMIT'], 120, 1, 100_000),
    adminRateLimitPerMinute: intInRange('GATEWAY_ADMIN_RATE_LIMIT', env['GATEWAY_ADMIN_RATE_LIMIT'], 30, 1, 10_000),
    federationRateLimitPerMinute: intInRange('GATEWAY_FEDERATION_RATE_LIMIT', env['GATEWAY_FEDERATION_RATE_LIMIT'], 600, 1, 100_000),
  };
}
