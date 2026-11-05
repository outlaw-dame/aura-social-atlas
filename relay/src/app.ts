import { createRelay, type Relay } from '@fedify/relay';
import { InProcessMessageQueue, MemoryKvStore, getAuthenticatedDocumentLoader, type KvStore, type MessageQueue } from '@fedify/fedify';
import { getDocumentLoader } from '@fedify/vocab-runtime';
import { claimedActor, isAllowedActor, type RelayConfig } from './policy.ts';

export type Stores = { kv: KvStore; queue: MessageQueue; ping: () => Promise<boolean>; close: () => Promise<void> };

/**
 * Durable PostgreSQL stores in production (tables are created up front so a
 * misconfigured database fails at startup, not on first delivery); memory only for local dev/tests.
 */
export async function storesFor(cfg: RelayConfig): Promise<Stores> {
  if (cfg.devMemoryStore) return { kv: new MemoryKvStore(), queue: new InProcessMessageQueue(), ping: async () => true, close: async () => {} };
  const [{ default: postgres }, { PostgresKvStore, PostgresMessageQueue }] = await Promise.all([import('postgres'), import('@fedify/postgres')]);
  const sql = postgres(cfg.databaseUrl!, { max: 10, idle_timeout: 30, connect_timeout: 10, onnotice: () => {} });
  const kv = new PostgresKvStore(sql);
  const queue = new PostgresMessageQueue(sql);
  await kv.initialize();
  await queue.initialize();
  return {
    kv, queue,
    ping: async () => { try { await sql`select 1`; return true; } catch { return false; } },
    close: async () => { await sql.end({ timeout: 5 }); },
  };
}

/** Reads a request body as raw bytes, aborting as soon as the limit is exceeded (never buffers an oversized body). */
export async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/** Builds one relay instance (one protocol, one origin) behind an allowlist gate and a minimal health endpoint. */
export function buildRelay(cfg: RelayConfig, stores: Stores) {
  // SSRF guard: Fedify validates every URL and redirect hop against public DNS results; we never allow private addresses.
  const loaderOpts = { allowPrivateAddress: false, maxRedirection: cfg.maxRedirects, timeout: cfg.fetchTimeoutMs, userAgent: { software: 'AtlasRelay/1.0', url: cfg.origin } };
  const relay: Relay = createRelay(cfg.protocol, {
    kv: stores.kv,
    queue: stores.queue,
    origin: cfg.origin,
    name: 'Atlas Relay',
    documentLoaderFactory: (o) => getDocumentLoader({ ...o, ...loaderOpts }),
    authenticatedDocumentLoaderFactory: (identity, o) => getAuthenticatedDocumentLoader(identity, { ...o, ...loaderOpts }),
    // Subscriptions: only explicitly allowlisted instances; everyone else gets a Reject.
    subscriptionHandler: async (_ctx, actor) => {
      const ok = isAllowedActor(actor.id, cfg.allowedDomains);
      log(ok ? 'subscription.approved' : 'subscription.rejected', { host: hostOf(actor.id) });
      return ok;
    },
  });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') {
      // Deliberately reveals nothing about followers, allowlist or configuration.
      const ok = await stores.ping();
      return Response.json({ ok }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
    }
    if (req.method === 'POST') {
      const bytes = await readLimited(req, cfg.maxBodyBytes);
      if (!bytes) return new Response('Payload too large', { status: 413 });
      let body: unknown;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return new Response('Invalid JSON', { status: 400 }); }
      // Pre-filter only; Fedify still verifies the HTTP signature and that the key owner matches the actor.
      const actor = claimedActor(body);
      if (!isAllowedActor(actor, cfg.allowedDomains)) { log('inbound.blocked', { host: hostOf(actor) }); return new Response('Forbidden', { status: 403 }); }
      // Forward the exact original bytes and headers so Digest / HTTP signatures stay valid.
      return relay.fetch(new Request(req.url, { method: 'POST', headers: req.headers, body: bytes }));
    }
    return relay.fetch(req);
  }

  return { relay, handle };
}

function hostOf(id: unknown): string | null {
  try { return new URL(String(id)).hostname; } catch { return null; }
}

/** Structured logs: event names and hostnames only — never bodies, headers, signatures or keys. */
export function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}
