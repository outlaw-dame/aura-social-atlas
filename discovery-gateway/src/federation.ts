/**
 * Federation core: a standalone ActivityPub Service actor that subscribes to
 * selective relay actors (FediBuzz tag/instance, Mastodon-style, LitePub-style)
 * and ingests the public content they announce. This is a SUBSCRIBER built on
 * Fedify's federation APIs — not a relay server (createRelay) and not a client
 * of any particular instance.
 *
 * Trust model:
 *  - Inbound HTTP signatures are verified by Fedify before any listener runs.
 *  - Content is ingested only when policy.authorizeIngest approves it
 *    (accepted subscription + public-only + provenance checks).
 *  - The gateway never re-publishes, re-signs, or forwards remote content, and
 *    never writes to any remote server beyond signed Follow/Undo/Accept to
 *    explicitly subscribed relay actors.
 */

import { createFederation, getAuthenticatedDocumentLoader, type Context, type Federation, type InboxContext, type KvStore, type MessageQueue } from '@fedify/fedify';
import { getDocumentLoader } from '@fedify/vocab-runtime';
import { generateCryptoKeyPair, exportJwk, importJwk } from '@fedify/fedify';
import { Accept, Announce, Create, Delete, Follow, Reject, Service, Undo, PUBLIC_COLLECTION, type Activity, type Actor } from '@fedify/vocab';
import type { Sql } from 'postgres';
import type { GatewayConfig } from './config.ts';
import { acceptedSubscriptionActors, deleteItem, insertItem, listSubscriptions, loadKeyPair, pruneItems, saveKeyPair, setSubscriptionState, subscriptionByFollowId } from './db.ts';
import { authorizeIngest, isControlPlane } from './policy.ts';
import { cleanText, hashtagNames, htmlToText } from './sanitize.ts';
import { hostOf, checkRemoteUrl } from './urlguard.ts';
const checkSourceUrl = (id: string) => checkRemoteUrl(id).ok;

export const ACTOR_IDENTIFIER = 'gateway';

export type GatewayStores = { kv: KvStore; queue: MessageQueue; sql: Sql | null };

type Ctx = Context<unknown>;
type InboxCtx = InboxContext<unknown>;

function loaderOptions(cfg: GatewayConfig) {
  // SSRF guard: Fedify validates every URL and redirect hop against public DNS
  // results; private addresses are never allowed, redirects and timeouts capped.
  return { allowPrivateAddress: false, maxRedirection: cfg.maxRedirects, timeout: cfg.fetchTimeoutMs, userAgent: { software: 'AtlasDiscoveryGateway/1.0', url: cfg.origin } };
}

export function log(event: string, data: Record<string, unknown> = {}) {
  // Structured logs: event names and hostnames only — never bodies, headers, signatures or keys.
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}

export type Gateway = {
  federation: Federation<unknown>;
  /** Handle one HTTP request for federation paths (actor, inbox, webfinger). */
  fetch: (req: Request) => Promise<Response>;
  /** Send a Follow to a resolved relay actor and return the activity id used. */
  sendFollow: (relayActor: Actor, followActivityId: string, protocol: 'mastodon' | 'litepub' | 'fedibuzz-tag' | 'fedibuzz-instance') => Promise<void>;
  /** Send an Undo{Follow} for an existing subscription. */
  sendUndoFollow: (relayActor: Actor, followActivityId: string, protocol: 'mastodon' | 'litepub' | 'fedibuzz-tag' | 'fedibuzz-instance') => Promise<void>;
  /** Resolve a remote actor through the guarded loader. */
  lookupActor: (url: string) => Promise<Actor | null>;
};

export function buildGateway(cfg: GatewayConfig, stores: GatewayStores): Gateway {
  const federation = createFederation<unknown>({
    kv: stores.kv,
    queue: stores.queue,
    origin: cfg.origin,
    documentLoaderFactory: (o) => getDocumentLoader({ ...o, ...loaderOptions(cfg) }),
    authenticatedDocumentLoaderFactory: (identity, o) => getAuthenticatedDocumentLoader(identity, { ...o, ...loaderOptions(cfg) }),
  });

  federation
    .setActorDispatcher(`/actors/{identifier}`, async (ctx, identifier) => {
      if (identifier !== ACTOR_IDENTIFIER) return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new Service({
        id: ctx.getActorUri(identifier),
        preferredUsername: 'atlas-discovery-gateway',
        name: 'Atlas Discovery Gateway',
        summary: 'Read-only open social web discovery subscriber. Follows selective relay actors only; never re-publishes content.',
        inbox: ctx.getInboxUri(identifier),
        outbox: ctx.getOutboxUri(identifier),
        url: ctx.getActorUri(identifier),
        manuallyApprovesFollowers: false,
        publicKeys: keys.map(key => key.cryptographicKey),
        assertionMethods: keys.map(key => key.multikey),
      });
    })
    .mapActorAlias('/actor', ACTOR_IDENTIFIER)
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (identifier !== ACTOR_IDENTIFIER || !stores.sql) return [];
      const existing = await loadKeyPair(stores.sql, identifier);
      if (existing) {
        const [privateKey, publicKey] = await Promise.all([
          importJwk(existing.privateKey as JsonWebKey, 'private'),
          importJwk(existing.publicKey as JsonWebKey, 'public'),
        ]);
        return [{ privateKey, publicKey }];
      }
      const pair = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
      const [privateJwk, publicJwk] = await Promise.all([exportJwk(pair.privateKey), exportJwk(pair.publicKey)]);
      await saveKeyPair(stores.sql, identifier, privateJwk, publicJwk);
      // Concurrent workers may race on INSERT ... DO NOTHING. Always load
      // the winning durable key, never sign with a key we did not persist.
      const stored = await loadKeyPair(stores.sql, identifier);
      if (!stored) throw new Error('service actor signing key was not persisted');
      const [persistedPrivate, persistedPublic] = await Promise.all([
        importJwk(stored.privateKey as JsonWebKey, 'private'),
        importJwk(stored.publicKey as JsonWebKey, 'public'),
      ]);
      log('actor.keys.ready', {});
      return [{ privateKey: persistedPrivate, publicKey: persistedPublic }];
    });

  federation.setOutboxDispatcher(`/actors/{identifier}/outbox`, () => null); // we never publish

  const ingest = async (ctx: InboxCtx, activity: Activity) => {
    if (!stores.sql) return;
    const body = (await activity.toJsonLd({ format: 'compact' })) as Record<string, unknown>;
    const activityId = activity.id?.href;
    if (!activityId) { log('ingest.dropped', { reason: 'activity has no id' }); return; }
    const subscribedActors = await acceptedSubscriptionActors(stores.sql);
    // For Announce, the relay can authenticate its own announcement, NOT the
    // embedded third-party object. Re-fetch the canonical object from its
    // origin through Fedify's guarded document loader and check its metadata.
    if (activity instanceof Announce) {
      const originId = activity.objectId?.href;
      if (!originId) return;
      const checked = checkSourceUrl(originId);
      if (!checked) { log('ingest.dropped', { reason: 'invalid object origin' }); return; }
      const original = await ctx.lookupObject(originId);
      if (!original || original.id?.href !== originId) {
        log('ingest.dropped', { reason: 'origin object fetch failed' }); return;
      }
      body['object'] = await original.toJsonLd({ format: 'compact' });
    }
    const decision = authorizeIngest({ body, subscribedActors });
    if (!decision.ok) {
      log('ingest.dropped', { host: hostOf(activity.actorId), reason: decision.reason });
      return;
    }

    const embedded = decision.embedded;
    const content = typeof embedded?.['content'] === 'string' ? embedded['content'] : '';
    const summaryRaw = typeof embedded?.['summary'] === 'string' ? embedded['summary'] : null;
    const name = typeof embedded?.['name'] === 'string' ? embedded['name'] : null;
    const urlField = embedded?.['url'];
    const requestedUrl = typeof urlField === 'string' ? urlField
      : urlField && typeof urlField === 'object' && typeof (urlField as { href?: unknown }).href === 'string' ? (urlField as { href: string }).href
      : decision.objectId;
    const canonicalUrl = checkRemoteUrl(requestedUrl).ok ? requestedUrl : decision.objectId;
    const published = typeof embedded?.['published'] === 'string' ? embedded['published'] : null;

    // Author attribution from the embedded object only; never invent an author.
    let authorName: string | null = null;
    let authorHandle: string | null = null;
    let authorUrl: string | null = null;
    const attributed = embedded?.['attributedTo'];
    if (attributed && typeof attributed === 'object' && !Array.isArray(attributed)) {
      const a = attributed as Record<string, unknown>;
      if (typeof a['name'] === 'string') authorName = cleanText(a['name'], 120);
      if (typeof a['preferredUsername'] === 'string' && decision.authorId) {
        const authorHost = hostOf(decision.authorId);
        authorHandle = authorHost ? `@${cleanText(a['preferredUsername'], 64)}@${authorHost}` : null;
      }
      if (typeof a['url'] === 'string' && checkRemoteUrl(a['url']).ok) authorUrl = a['url'];
    }

    const text = htmlToText(content || name || '', cfg.maxTextLength);
    if (!text && !summaryRaw) { log('ingest.dropped', { reason: 'empty content' }); return; }

    // Insert is atomic on activity_id and object_id; don't claim before a
    // potentially failing fetch/insert (that would permanently lose retries).
    const inserted = await insertItem(stores.sql, {
      id: decision.objectId,
      activityId,
      relayActor: activity.actorId?.href ?? 'unknown',
      authorId: decision.authorId,
      authorName,
      authorHandle,
      authorUrl,
      objectOrigin: decision.objectOrigin,
      url: canonicalUrl,
      summary: summaryRaw ? cleanText(summaryRaw, 280) : null,
      text,
      hashtags: hashtagNames(embedded?.['tag']),
      publishedAt: published,
    });
    if (inserted) {
      log('ingest.stored', { origin: decision.objectOrigin, via: hostOf(activity.actorId) });
      await pruneItems(stores.sql, cfg.maxItems);
    }
  };

  const control = federation.setInboxListeners(`/actors/{identifier}/inbox`, `/inbox`);

  control
    .on(Follow, async (ctx, follow) => {
      // Reciprocal follows (LitePub relays follow back): accept only from actors
      // we explicitly subscribed to; everyone else gets a Reject.
      if (!stores.sql) return;
      const followerHost = hostOf(follow.actorId);
      const subs = await listSubscriptions(stores.sql);
      const known = subs.find(s => s.kind === 'litepub' && s.actorUrl === follow.actorId?.href && (s.state === 'pending' || s.state === 'accepted'));
      const followId = follow.id?.href;
      const forServiceActor = follow.objectId?.href === ctx.getActorUri(ACTOR_IDENTIFIER).href;
      if (!known || !followId || !forServiceActor) {
        if (followId && follow.actorId) {
          const remote = await ctx.lookupObject(follow.actorId.href);
          if (remote && 'inboxId' in remote && remote.inboxId) {
            const reject = new Reject({ id: new URL(`${cfg.origin}/activities/${crypto.randomUUID()}`), actor: ctx.getActorUri(ACTOR_IDENTIFIER), object: follow });
            await ctx.sendActivity({ identifier: ACTOR_IDENTIFIER }, remote as Actor, reject);
          }
        }
        log('follow.rejected', { host: followerHost });
        return;
      }
      const remote = await ctx.lookupObject(follow.actorId!.href);
      if (!remote || !('inboxId' in remote) || !remote.inboxId) {
        log('follow.rejected', { reason: 'missing verified recipient inbox' });
        return;
      }
      const accept = new Accept({ id: new URL(`${cfg.origin}/activities/${crypto.randomUUID()}`), actor: ctx.getActorUri(ACTOR_IDENTIFIER), object: follow });
      await ctx.sendActivity({ identifier: ACTOR_IDENTIFIER }, remote as Actor, accept);
      log('follow.accepted', { host: followerHost });
    })
    .on(Accept, async (_ctx, accept) => {
      if (!stores.sql) return;
      const objectId = accept.objectId?.href;
      if (!objectId) return;
      const sub = await subscriptionByFollowId(stores.sql, objectId);
      if (sub && sub.state === 'pending' && sub.actorUrl === accept.actorId?.href) {
        await setSubscriptionState(stores.sql, sub.id, 'accepted');
        log('subscription.accepted', { host: sub.actorHost });
      }
    })
    .on(Reject, async (_ctx, reject) => {
      if (!stores.sql) return;
      const objectId = reject.objectId?.href;
      if (!objectId) return;
      const sub = await subscriptionByFollowId(stores.sql, objectId);
      if (sub && sub.actorUrl === reject.actorId?.href) {
        await setSubscriptionState(stores.sql, sub.id, 'rejected');
        log('subscription.rejected', { host: sub.actorHost });
      }
    })
    .on(Undo, async (_ctx, undo) => {
      // A relay undoing its follow of us: nothing to tear down content-wise,
      // but record it so the ingest gate stops trusting that actor.
      if (!stores.sql) return;
      const actorHost = hostOf(undo.actorId);
      if (!actorHost) return;
      const subs = await listSubscriptions(stores.sql);
      for (const sub of subs) {
        if (sub.actorUrl === undo.actorId?.href && sub.state === 'accepted') {
          await setSubscriptionState(stores.sql, sub.id, 'disabled');
          log('subscription.disabled-by-remote', { host: actorHost });
        }
      }
    })
    .on(Create, ingest)
    .on(Announce, ingest)
    .on(Delete, async (_ctx, del) => {
      // Fedify verifies the Delete actor before this listener. Never let a
      // relay delete another person's post: delete only if it is precisely
      // the stored original author. A relay-authored Delete is not sufficient.
      if (!stores.sql || !del.actorId || !del.objectId) return;
      const removed = await deleteItem(stores.sql, del.objectId.href, del.actorId.href);
      log('delete.author_scoped', { removed });
    })
    .onError((_ctx, error) => {
      log('inbox.error', { reason: error instanceof Error ? error.name : 'unknown' });
    });

  async function requestContext(): Promise<Ctx> {
    return federation.createContext(new URL(`${cfg.origin}/`), undefined) as Ctx;
  }

  return {
    federation,
    fetch: (req) => federation.fetch(req, { contextData: undefined }),
    sendFollow: async (relayActor, followActivityId, protocol) => {
      const ctx = await requestContext();
      const follow = new Follow({
        id: new URL(followActivityId),
        actor: ctx.getActorUri(ACTOR_IDENTIFIER),
        object: protocol === 'mastodon' ? PUBLIC_COLLECTION : relayActor.id!,
      });
      await ctx.sendActivity({ identifier: ACTOR_IDENTIFIER }, relayActor, follow);
    },
    sendUndoFollow: async (relayActor, followActivityId, protocol) => {
      const ctx = await requestContext();
      const undo = new Undo({
        id: new URL(`${cfg.origin}/activities/${crypto.randomUUID()}`),
        actor: ctx.getActorUri(ACTOR_IDENTIFIER),
        object: new Follow({ id: new URL(followActivityId), actor: ctx.getActorUri(ACTOR_IDENTIFIER), object: protocol === 'mastodon' ? PUBLIC_COLLECTION : relayActor.id! }),
      });
      await ctx.sendActivity({ identifier: ACTOR_IDENTIFIER }, relayActor, undo);
    },
    lookupActor: async (url) => {
      const ctx = await requestContext();
      const obj = await ctx.lookupObject(url);
      if (obj && 'inboxId' in obj && obj.inboxId) return obj as Actor;
      return null;
    },
  };
}

export { isControlPlane };
