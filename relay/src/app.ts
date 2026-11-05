import { createRelay, type Relay, type RelayOptions } from '@fedify/relay';
import { InProcessMessageQueue, MemoryKvStore, getAuthenticatedDocumentLoader, type KvStore, type MessageQueue } from '@fedify/fedify';
import { getDocumentLoader } from '@fedify/vocab-runtime';
import type { Activity } from '@fedify/vocab';
import type { InboxContext } from '@fedify/fedify';
import { Temporal } from 'temporal-polyfill';
import { claimedActor, isAllowedActor, type RelayConfig } from './policy.ts';
import { authorizeForward, prefilterRaw } from './visibility.ts';

type InboxCtx = InboxContext<unknown>;
export type LoaderOverrides = { documentLoaderFactory?: RelayOptions['documentLoaderFactory']; authenticatedDocumentLoaderFactory?: RelayOptions['authenticatedDocumentLoaderFactory'] };

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

export const SEEN_TTL = Temporal.Duration.from({ hours: 48 });

/**
 * Atomically claims an activity id: true for exactly one caller across all processes sharing the store.
 * Uses KvStore.cas(key, undefined, value) — for PostgresKvStore this is a single
 * INSERT ... ON CONFLICT (key) DO UPDATE ... WHERE expired, guarded by the table's primary key.
 */
export async function claimActivityId(kv: KvStore, id: string): Promise<boolean> {
  if (typeof kv.cas !== 'function') throw new Error('KvStore without atomic cas(); refusing to relay.');
  return kv.cas(['atlas-relay', 'seen', id], undefined, 1, { ttl: SEEN_TTL });
}

/** The policy hooks an undocumented method; only run on the exact version it was verified against. */
export const VERIFIED_FEDIFY_VERSION = '2.4.5';
export function assertSupportedRelayVersion(installed = installedVersions()) {
  for (const [name, v] of Object.entries(installed)) {
    if (v !== VERIFIED_FEDIFY_VERSION) throw new Error(`${name}@${v} is not the verified ${VERIFIED_FEDIFY_VERSION}; refusing to start (the forwarding policy hooks @fedify/relay internals).`);
  }
}
function installedVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['@fedify/relay', '@fedify/fedify', '@fedify/vocab', '@fedify/vocab-runtime', '@fedify/postgres']) {
    out[name] = (require(`${name}/package.json`) as { version: string }).version;
  }
  return out;
}

/** Reads a request body as raw bytes, aborting as soon as the limit is exceeded (never buffers an oversized body). */
export async function readLimited(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
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
export function buildRelay(cfg: RelayConfig, stores: Stores, testLoaders: LoaderOverrides = {}) {
  // SSRF guard: Fedify validates every URL and redirect hop against public DNS results; we never allow private addresses.
  const loaderOpts = { allowPrivateAddress: false, maxRedirection: cfg.maxRedirects, timeout: cfg.fetchTimeoutMs, userAgent: { software: 'AtlasRelay/1.0', url: cfg.origin } };
  const relay: Relay = createRelay(cfg.protocol, {
    kv: stores.kv,
    queue: stores.queue,
    origin: cfg.origin,
    name: 'Atlas Relay',
    // testLoaders exist only so tests can serve fake remote actors; main.ts never passes them.
    documentLoaderFactory: testLoaders.documentLoaderFactory ?? ((o) => getDocumentLoader({ ...o, ...loaderOpts })),
    authenticatedDocumentLoaderFactory: testLoaders.authenticatedDocumentLoaderFactory ?? ((identity, o) => getAuthenticatedDocumentLoader(identity, { ...o, ...loaderOpts })),
    // Subscriptions: only explicitly allowlisted instances; everyone else gets a Reject.
    subscriptionHandler: async (_ctx, actor) => {
      const ok = isAllowedActor(actor.id, cfg.allowedDomains);
      log(ok ? 'subscription.approved' : 'subscription.rejected', { host: hostOf(actor.id) });
      return ok;
    },
  });

  // Hosts of servers whose relay subscription is currently accepted.
  async function subscriberHosts(): Promise<Set<string>> {
    const hosts = new Set<string>();
    for await (const f of relay.listFollowers()) if (f.state === 'accepted') { try { hosts.add(new URL(f.actorId).hostname.toLowerCase()); } catch { /* skip */ } }
    return hosts;
  }

  // Authoritative gate inside Fedify's verified inbox pipeline. deliverActivity is the internal hook both
  // relay types call for Create/Update/Delete/Move/Announce; fail closed if a library update removes it.
  assertSupportedRelayVersion();
  const internal = relay as unknown as { deliverActivity?: (ctx: InboxCtx, activity: Activity, exclude: URL[]) => Promise<void> };
  if (typeof internal.deliverActivity !== 'function') throw new Error('@fedify/relay internals changed: refusing to start without the forwarding policy hook.');
  const deliver = internal.deliverActivity.bind(relay);
  internal.deliverActivity = async (ctx, activity, exclude) => {
    const decision = await authorizeForward(activity, {
      allowedDomains: cfg.allowedDomains,
      subscriberHosts,
      loadObject: async (a) => { try { return await a.getObject({ documentLoader: ctx.documentLoader, contextLoader: ctx.contextLoader, crossOrigin: 'ignore' }); } catch { return null; } },
      markSeen: (id) => claimActivityId(stores.kv, id),
    });
    if (!decision.ok) { log('forward.dropped', { host: hostOf(activity.actorId), reason: decision.reason }); return; }
    log('forward.accepted', { host: hostOf(activity.actorId) });
    await deliver(ctx, activity, exclude);
  };

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
      // Pre-filter on claimed fields only; Fedify then verifies the signature and signer/actor match,
      // and authorizeForward re-checks everything on the verified activity before relaying.
      const actor = claimedActor(body);
      const pre = isAllowedActor(actor, cfg.allowedDomains)
        ? prefilterRaw({ body, allowedDomains: cfg.allowedDomains, subscriberHosts: await subscriberHosts() })
        : { ok: false as const, status: 403, reason: 'actor not allowlisted' };
      if (!pre.ok) { log('inbound.blocked', { host: hostOf(actor), reason: pre.reason }); return new Response(pre.status === 403 ? 'Forbidden' : 'Rejected', { status: pre.status }); }
      // Forward the exact original bytes and headers so Digest / HTTP signatures stay valid.
      return relay.fetch(new Request(req.url, { method: 'POST', headers: req.headers, body: bytes as Uint8Array<ArrayBuffer> }));
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
