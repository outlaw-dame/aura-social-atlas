/**
 * HTTP surface:
 *
 *  Public (read-only, CORS-allowlisted):
 *    GET /api/v1/items?tag=&domain=&q=&cursor=&limit=  paginated discovery feed
 *    GET /api/v1/facets                                available tag/domain filters
 *    GET /healthz                                      { ok } only, no config details
 *
 *  Admin (Bearer token, never exposed to any frontend, no CORS):
 *    GET    /admin/subscriptions
 *    POST   /admin/subscriptions        { type: 'tag'|'instance'|'actor', value, kind? }
 *    DELETE /admin/subscriptions/:id
 *    POST   /admin/subscriptions/:id/retry
 *
 *  Everything else (actor, inbox, webfinger) is delegated to Fedify.
 */

import type { Sql } from 'postgres';
import type { GatewayConfig } from './config.ts';
import type { Gateway } from './federation.ts';
import { listFacets, queryItems, type GatewayItem } from './db.ts';
import { listAll, retrySubscription, subscribe, unsubscribe, type SubscribeInput } from './subscribe.ts';
import { readLimited } from './limits.ts';
import { log } from './federation.ts';

type HandlerDeps = { cfg: GatewayConfig; gateway: Gateway; sql: Sql; adminEnabled?: boolean };

/** Timing-safe bearer check without leaking length through early exit. */
export function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (a[i % Math.max(a.length, 1)] ?? 0) ^ (b[i % Math.max(b.length, 1)] ?? 0);
  return diff === 0;
}

/** Per-process token bucket per client key. Documented as per-process. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; resetAt: number }>();
  constructor(private limitPerMinute: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      this.buckets.set(key, { tokens: this.limitPerMinute - 1, resetAt: now + 60_000 });
      return true;
    }
    if (b.tokens <= 0) return false;
    b.tokens -= 1;
    return true;
  }
}

function clientKey(_req: Request): string {
  // Never trust a client-provided X-Forwarded-For header as an identity:
  // attackers could rotate it to evade limits. Until a proxy-signed address
  // can be supplied by trusted infrastructure, share a conservative bucket.
  return 'untrusted-public';
}

function corsHeaders(cfg: GatewayConfig, req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (origin && cfg.corsAllowlist.includes(origin)) {
    return { 'access-control-allow-origin': origin, 'vary': 'origin' };
  }
  return {};
}

function json(data: unknown, init: ResponseInit = {}, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(data, { ...init, headers: { 'cache-control': 'no-store', ...extraHeaders, ...(init.headers as Record<string, string> | undefined) } });
}

function publicItem(item: GatewayItem) {
  return {
    id: item.id,
    url: item.url ?? item.id,
    author: item.authorName || item.authorHandle ? { name: item.authorName, handle: item.authorHandle, url: item.authorUrl, id: item.authorId } : null,
    origin: item.objectOrigin.replace(/^https:\/\//, ''),
    summary: item.summary,
    text: item.text,
    hashtags: item.hashtags,
    publishedAt: item.publishedAt,
    ingestedAt: item.ingestedAt,
    via: item.relayActor,
  };
}

function publicSubscription(s: { id: string; kind: string; actorUrl: string; actorHost: string; selector: string | null; state: string; createdAt: string; updatedAt: string }) {
  // Never expose follow_activity_id (it is our correlation secret for Accept/Reject).
  return { id: s.id, kind: s.kind, actorUrl: s.actorUrl, actorHost: s.actorHost, selector: s.selector, state: s.state, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const { cfg, gateway, sql, adminEnabled = false } = deps;
  const readLimiter = new RateLimiter(cfg.readRateLimitPerMinute);
  const adminLimiter = new RateLimiter(cfg.adminRateLimitPerMinute);
  // One bounded, conservative bucket because the application does not have
  // a trusted proxy-derived source address. Never key this by X-Forwarded-For.
  const federationLimiter = new RateLimiter(cfg.federationRateLimitPerMinute);

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/healthz') {
      try { await sql`select 1`; return json({ ok: true }); } catch { return json({ ok: false }, { status: 503 }); }
    }

    if (path.startsWith('/api/')) {
      const cors = corsHeaders(cfg, req);
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
      }
      if (!readLimiter.allow(clientKey(req))) return json({ error: 'rate limited' }, { status: 429 }, cors);
      if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 }, cors);

      if (path === '/api/v1/items') {
        // Bound query size before allocating strings or constructing DB filters.
        const tag = url.searchParams.get('tag');
        const domain = url.searchParams.get('domain');
        const search = url.searchParams.get('q');
        const cursor = url.searchParams.get('cursor');
        if ((tag && !/^#?[\p{L}\p{N}_-]{1,100}$/u.test(tag)) ||
            (domain && (domain.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain))) ||
            (search && search.length > 120) ||
            (cursor && cursor.length > 2048)) {
          return json({ error: 'invalid discovery filter' }, { status: 400 }, cors);
        }
        const limitRaw = url.searchParams.get('limit');
        const limit = limitRaw && /^\d+$/.test(limitRaw) ? Math.min(Math.max(Number(limitRaw), 1), 50) : 20;
        const page = await queryItems(sql, {
          tag: url.searchParams.get('tag'),
          domain: url.searchParams.get('domain'),
          search: url.searchParams.get('q'),
          cursor: url.searchParams.get('cursor'),
          limit,
        });
        return json({ items: page.items.map(publicItem), nextCursor: page.nextCursor }, {}, cors);
      }
      if (path === '/api/v1/facets') {
        return json(await listFacets(sql), {}, cors);
      }
      return json({ error: 'not found' }, { status: 404 }, cors);
    }

    if (path === '/admin' || path.startsWith('/admin/')) {
      // The public listener must fail closed even when the Cloudflare WAF
      // is bypassed through Railway's direct origin or an alternate domain.
      if (!adminEnabled) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
      // Admin API: no CORS — it must never be callable from a browser page on
      // another origin, and the token must never ship in any frontend bundle.
      if (!adminLimiter.allow(clientKey(req))) return json({ error: 'rate limited' }, { status: 429 });
      const auth = req.headers.get('authorization');
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
      if (!tokenMatches(token, cfg.adminToken)) return json({ error: 'unauthorized' }, { status: 401 });

      if (path === '/admin/subscriptions' && req.method === 'GET') {
        return json({ subscriptions: (await listAll(sql)).map(publicSubscription) });
      }
      if (path === '/admin/subscriptions' && req.method === 'POST') {
        const bytes = await readLimited(req, 16_384);
        if (!bytes) return json({ error: 'payload too large' }, { status: 413 });
        let parsed: unknown;
        try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return json({ error: 'invalid JSON' }, { status: 400 }); }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'expected a JSON object' }, { status: 400 });
        const body = parsed as Partial<SubscribeInput> & { type?: string };
        if (body.type !== 'tag' && body.type !== 'instance' && body.type !== 'actor') return json({ error: 'type must be tag, instance or actor' }, { status: 400 });
        if (typeof body.value !== 'string' || !body.value.trim() || body.value.length > 500) return json({ error: 'value is required' }, { status: 400 });
        if (body.type === 'actor' && body.kind !== undefined && body.kind !== 'mastodon' && body.kind !== 'litepub') return json({ error: 'kind must be mastodon or litepub' }, { status: 400 });
        const result = await subscribe(gateway, sql, cfg.origin, body as SubscribeInput);
        if (!result.ok) return json({ error: result.error }, { status: result.status });
        return json({ subscription: publicSubscription(result.subscription), created: result.created }, { status: result.created ? 201 : 200 });
      }
      const subMatch = /^\/admin\/subscriptions\/([0-9a-f-]{36})(\/retry)?$/.exec(path);
      if (subMatch) {
        const id = subMatch[1]!;
        const action = subMatch[2];
        if (req.method === 'DELETE' && !action) {
          const result = await unsubscribe(gateway, sql, id);
          if (!result.ok) return json({ error: result.error }, { status: result.status });
          return json({ subscription: publicSubscription(result.subscription) });
        }
        if (req.method === 'POST' && action === '/retry') {
          const result = await retrySubscription(gateway, sql, cfg.origin, id);
          if (!result.ok) return json({ error: result.error }, { status: result.status });
          return json({ subscription: publicSubscription(result.subscription) });
        }
        return json({ error: 'method not allowed' }, { status: 405 });
      }
      return json({ error: 'not found' }, { status: 404 });
    }

    // Federation paths (actor, inbox, webfinger, nodeinfo): body-limited, then Fedify.
    if (req.method === 'POST') {
      if (!federationLimiter.allow(clientKey(req))) {
        return new Response('Too many federation requests', {
          status: 429,
          headers: { 'retry-after': '60', 'cache-control': 'no-store' },
        });
      }
      const bytes = await readLimited(req, cfg.maxBodyBytes);
      if (!bytes) return new Response('Payload too large', { status: 413 });
      return gateway.fetch(new Request(req.url, { method: 'POST', headers: req.headers, body: bytes as Uint8Array<ArrayBuffer> }));
    }
    if (req.method === 'GET' || req.method === 'HEAD') return gateway.fetch(req);
    log('http.rejected', { reason: 'method', path: path.slice(0, 32) });
    return new Response('Method not allowed', { status: 405 });
  };
}
