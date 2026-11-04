import { createRelay, type Relay } from '@fedify/relay';
import { InProcessMessageQueue, MemoryKvStore, type KvStore, type MessageQueue } from '@fedify/fedify';
import { claimedActor, isAllowedActor, type RelayConfig } from './policy.ts';

export type Stores = { kv: KvStore; queue: MessageQueue };

export async function storesFor(cfg: RelayConfig): Promise<Stores> {
  if (cfg.devMemoryStore) return { kv: new MemoryKvStore(), queue: new InProcessMessageQueue() };
  const [{ default: postgres }, { PostgresKvStore, PostgresMessageQueue }] = await Promise.all([import('postgres'), import('@fedify/postgres')]);
  const sql = postgres(cfg.databaseUrl!);
  return { kv: new PostgresKvStore(sql), queue: new PostgresMessageQueue(sql) };
}

/** Builds one relay instance (one protocol, one origin) behind an allowlist gate and a health endpoint. */
export function buildRelay(cfg: RelayConfig, stores: Stores) {
  const relay: Relay = createRelay(cfg.protocol, {
    kv: stores.kv,
    queue: stores.queue,
    origin: cfg.origin,
    // Subscriptions: only explicitly allowlisted instances; everyone else gets a Reject.
    subscriptionHandler: async (_ctx, actor) => {
      const ok = isAllowedActor(actor.id, cfg.allowedDomains);
      log(ok ? 'subscription.approved' : 'subscription.rejected', { actor: actor.id?.href });
      return ok;
    },
  });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/healthz') {
      let followers = 0;
      for await (const _ of relay.listFollowers()) followers++;
      return Response.json({ ok: true, protocol: cfg.protocol, actor: (await relay.getActorUri()).href, sharedInbox: (await relay.getSharedInboxUri()).href, followers, allowedDomains: cfg.allowedDomains.length });
    }
    if (req.method === 'POST') {
      const len = Number(req.headers.get('content-length') ?? 0);
      if (len > cfg.maxBodyBytes) return new Response('Payload too large', { status: 413 });
      const raw = await req.text();
      if (raw.length > cfg.maxBodyBytes) return new Response('Payload too large', { status: 413 });
      let body: unknown; try { body = JSON.parse(raw); } catch { return new Response('Invalid JSON', { status: 400 }); }
      // Fedify verifies the HTTP signature; this gate additionally stops non-allowlisted servers publishing through the relay.
      const actor = claimedActor(body);
      if (!isAllowedActor(actor, cfg.allowedDomains)) { log('inbound.blocked', { actor }); return new Response('Forbidden', { status: 403 }); }
      return relay.fetch(new Request(req.url, { method: 'POST', headers: req.headers, body: raw }));
    }
    return relay.fetch(req);
  }

  return { relay, handle };
}

export function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}
