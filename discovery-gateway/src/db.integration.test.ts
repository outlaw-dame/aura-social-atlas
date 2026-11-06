/**
 * Real PostgreSQL integration tests. CI starts a disposable PostgreSQL 16
 * service; no remote federation or production data is touched.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres, { type Sql } from 'postgres';
import { Service } from '@fedify/vocab';
import { InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import { buildGateway } from './federation.ts';
import { createHandler } from './http.ts';
import { loadConfig } from './config.ts';
import { authorizeIngest } from './policy.ts';
import {
  acceptedSubscriptionActors, createSubscription, deleteItem, getSubscription,
  initSchema, insertItem, listFacets, loadKeyPair, pruneItems, queryItems,
  saveKeyPair, setPendingFollowId, setSubscriptionState, subscriptionByFollowId,
  type GatewayItem,
} from './db.ts';
import { retrySubscription, subscribe } from './subscribe.ts';
import type { Gateway } from './federation.ts';

const databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL;
const dbTest = databaseUrl ? test : test.skip;
let sql: Sql;
const prefix = `https://origin.example/posts/${crypto.randomUUID()}/`;
const relay = 'https://relay.fedi.buzz/tag/integration';
const author = 'https://origin.example/actors/alex';

function item(id: string, activityId = id + '/activity', hashtags = ['integration']): Omit<GatewayItem, 'ingestedAt'> {
  return {
    id, activityId, relayActor: relay, authorId: author, authorName: 'Alex',
    authorHandle: '@alex@origin.example', authorUrl: author, objectOrigin: 'https://origin.example',
    url: id, summary: null, text: `hello ${id}`, hashtags, publishedAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  if (!databaseUrl) return;
  sql = postgres(databaseUrl, { max: 8, connect_timeout: 5 });
  await initSchema(sql);
  await sql`TRUNCATE gateway_items, gateway_seen, gateway_subscriptions, gateway_keys`;
});
afterAll(async () => {
  if (sql) await sql.end({ timeout: 5 });
});

describe('PostgreSQL persistence and subscription lifecycle', () => {
  dbTest('schema initializes repeatedly without resetting state', async () => {
    await initSchema(sql);
    expect(await queryItems(sql, { limit: 10 })).toEqual({ items: [], nextCursor: null });
  });

  dbTest('subscription uniqueness, accepted actor IDs and follow correlation', async () => {
    const input = {
      kind: 'fedibuzz-tag' as const, actorUrl: relay, actorHost: 'relay.fedi.buzz',
      selector: 'integration', followActivityId: `${prefix}follow-1`,
    };
    const first = await createSubscription(sql, input);
    const second = await createSubscription(sql, { ...input, followActivityId: `${prefix}follow-2` });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.subscription.id).toBe(first.subscription.id);
    expect((await subscriptionByFollowId(sql, input.followActivityId))?.id).toBe(first.subscription.id);
    expect(await acceptedSubscriptionActors(sql)).toEqual(new Set());
    await setSubscriptionState(sql, first.subscription.id, 'accepted');
    expect(await acceptedSubscriptionActors(sql)).toEqual(new Set([relay]));
    const changed = await setPendingFollowId(sql, first.subscription.id, `${prefix}retry`);
    expect(changed).toBe(false);
    await setSubscriptionState(sql, first.subscription.id, 'rejected');
    expect(await setPendingFollowId(sql, first.subscription.id, `${prefix}retry`)).toBe(true);
    expect(await subscriptionByFollowId(sql, input.followActivityId)).toBeNull();
    expect((await subscriptionByFollowId(sql, `${prefix}retry`))?.state).toBe('pending');
  });

  dbTest('concurrent duplicate subscription inserts admit exactly one winner', async () => {
    const actorUrl = 'https://relay.example/actors/race';
    const input = {
      kind: 'litepub' as const, actorUrl, actorHost: 'relay.example', selector: null,
      followActivityId: `${prefix}race`,
    };
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      createSubscription(sql, { ...input, followActivityId: `${prefix}race-${i}` })));
    expect(attempts.filter(a => a.created).length).toBe(1);
    expect(new Set(attempts.map(a => a.subscription.id)).size).toBe(1);
  });

  dbTest('concurrent duplicate posts store exactly one row', async () => {
    const id = prefix + 'race';
    const inserted = await Promise.all(Array.from({ length: 16 }, () => insertItem(sql, item(id))));
    expect(inserted.filter(Boolean).length).toBe(1);
    const found = await queryItems(sql, { limit: 30 });
    expect(found.items.filter(p => p.id === id).length).toBe(1);
  });

  dbTest('repeated activity IDs cannot create a second canonical object', async () => {
    const activityId = prefix + 'same-activity';
    const first = await insertItem(sql, item(prefix + 'object-one', activityId));
    expect(first).toBe(true);
    // Conflict on activity_id is also deduplicated instead of a 500 that
    // could repeatedly requeue a previously accepted activity.
    const second = await insertItem(sql, item(prefix + 'object-two', activityId));
    expect(second).toBe(false);
  });

  dbTest('key storage is idempotent and never overwrites an existing actor identity', async () => {
    const id = 'integration-actor';
    await Promise.all(Array.from({ length: 4 }, (_, i) =>
      saveKeyPair(sql, id, { kty: 'RSA', n: String(i) }, { kty: 'RSA', n: 'public' })));
    const value = await loadKeyPair(sql, id);
    expect(value?.privateKey).toBeDefined();
    expect(typeof value?.privateKey).toBe('object');
    const initial = JSON.stringify(value?.privateKey);
    await saveKeyPair(sql, id, { kty: 'RSA', n: 'replacement' }, { kty: 'RSA', n: 'other' });
    expect(JSON.stringify((await loadKeyPair(sql, id))?.privateKey)).toBe(initial);
  });

  dbTest('cursor pagination, facet filters, and author-scoped deletion', async () => {
    const base = prefix + 'paging/';
    for (let i = 0; i < 6; i++) await insertItem(sql, item(base + i, undefined, [i % 2 ? 'odd' : 'even']));
    const page1 = await queryItems(sql, { limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await queryItems(sql, { limit: 2, cursor: page1.nextCursor });
    expect(page2.items.length).toBe(2);
    expect(new Set([...page1.items, ...page2.items].map(p => p.id)).size).toBe(4);
    const even = await queryItems(sql, { limit: 30, tag: 'even' });
    expect(even.items.filter(p => p.id.startsWith(base)).length).toBe(3);
    const filtered = await queryItems(sql, { limit: 30, domain: 'origin.example' });
    expect(filtered.items.length).toBeGreaterThanOrEqual(6);
    const facets = await listFacets(sql);
    expect(facets.domains).toContain('origin.example');
    expect(await deleteItem(sql, base + 0, 'https://attacker.example/actor')).toBe(false);
    expect(await deleteItem(sql, base + 0, author)).toBe(true);
    expect(await deleteItem(sql, base + 0, author)).toBe(false);
  });

  dbTest('retention bounds oldest rows, not current records', async () => {
    const before = await queryItems(sql, { limit: 100 });
    expect(before.items.length).toBeGreaterThan(2);
    await pruneItems(sql, 2);
    const after = await queryItems(sql, { limit: 100 });
    expect(after.items.length).toBe(2);
  });

  dbTest('Follow retries persist the new correlation ID before delivery', async () => {
    const sub = await createSubscription(sql, {
      kind: 'litepub', actorUrl: 'https://relay.example/actors/retry',
      actorHost: 'relay.example', selector: null, followActivityId: prefix + 'initial',
    });
    await setSubscriptionState(sql, sub.subscription.id, 'rejected');
    let recordedId = '';
    const gateway = {
      lookupActor: async (url: string) => new Service({ id: new URL(url), inbox: new URL('https://relay.example/inbox') }),
      sendFollow: async (_actor: unknown, id: string) => {
        recordedId = id;
        expect((await getSubscription(sql, sub.subscription.id))?.followActivityId).toBe(id);
      },
    } as unknown as Gateway;
    const result = await retrySubscription(gateway, sql, 'https://gateway.example', sub.subscription.id);
    expect(result.ok).toBe(true);
    expect(recordedId).toMatch(/^https:\/\/gateway\.example\/activities\//);
    expect((await subscriptionByFollowId(sql, recordedId))?.state).toBe('pending');
  });

  dbTest('Fedify serves a stable service actor with its persistent public key', async () => {
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456',
      DATABASE_URL: databaseUrl!,
    });
    const gateway = buildGateway(cfg, {
      kv: new MemoryKvStore(),
      queue: new InProcessMessageQueue(),
      sql,
    });
    const req = new Request('https://gateway.example/actor', {
      headers: { Accept: 'application/activity+json' },
    });
    const first = await gateway.fetch(req);
    expect(first.status).toBe(200);
    const actor = await first.json() as Record<string, unknown>;
    expect(actor['type']).toBe('Service');
    expect(actor['id']).toBe('https://gateway.example/actor');
    expect(actor['inbox']).toBe('https://gateway.example/actors/gateway/inbox');
    expect(actor['publicKey'] ?? actor['publicKeys'] ?? actor['assertionMethod']).toBeDefined();
    const pair = await loadKeyPair(sql, 'gateway');
    expect(pair?.privateKey).toBeDefined();
    // Simulate a new process with fresh in-memory Fedify caches and the same
    // durable PostgreSQL state. The public signing identity must not rotate.
    const restarted = buildGateway(cfg, {
      kv: new MemoryKvStore(),
      queue: new InProcessMessageQueue(),
      sql,
    });
    const second = await restarted.fetch(req);
    expect(second.status).toBe(200);
    const restartedActor = await second.json() as Record<string, unknown>;
    expect(restartedActor['publicKey'] ?? restartedActor['publicKeys'] ?? restartedActor['assertionMethod'])
      .toEqual(actor['publicKey'] ?? actor['publicKeys'] ?? actor['assertionMethod']);
    expect(await loadKeyPair(sql, 'gateway')).toEqual(pair);

    // Assert persisted signing keys can still create verifiable signatures.
    // This checks cryptographic key integrity, not full HTTP-signature interop.
    const message = new TextEncoder().encode('gateway key persistence regression');
    const privateKey = await crypto.subtle.importKey('jwk', pair!.privateKey as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const publicKey = await crypto.subtle.importKey('jwk', pair!.publicKey as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, message);
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, message)).toBe(true);
  });

  dbTest('public read endpoint and admin mutations enforce credentials', async () => {
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456',
      GATEWAY_CORS_ORIGINS: 'https://app.example',
      DATABASE_URL: databaseUrl!,
    });
    const gateway = {
      fetch: async () => new Response('Not found', { status: 404 }),
      lookupActor: async () => null,
    } as unknown as Gateway;
    const handle = createHandler({ cfg, gateway, sql });
    const anonymous = await handle(new Request('https://gateway.example/admin/subscriptions'));
    expect(anonymous.status).toBe(401);
    const headers = { Authorization: `Bearer ${cfg.adminToken}` };
    const wrongMethod = await handle(new Request('https://gateway.example/admin/subscriptions', {
      method: 'POST', headers, body: JSON.stringify([]),
    }));
    expect(wrongMethod.status).toBe(400);
    const pub = await handle(new Request('https://gateway.example/api/v1/items?limit=2', {
      headers: { Origin: 'https://app.example' },
    }));
    expect(pub.status).toBe(200);
    expect(pub.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const data = await pub.json() as { items: unknown[]; nextCursor: string | null };
    expect(Array.isArray(data.items)).toBe(true);
    const blocked = await handle(new Request('https://gateway.example/api/v1/items?tag=../secret'));
    expect(blocked.status).toBe(400);
  });

  dbTest('unsigned remote Accept cannot activate a pending relay subscription', async () => {
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456',
      DATABASE_URL: databaseUrl!,
    });
    const gw = buildGateway(cfg, {
      kv: new MemoryKvStore(), queue: new InProcessMessageQueue(), sql,
    });
    const actor = 'https://unsigned.example/actors/relay';
    const followId = prefix + 'unsigned-follow';
    const sub = await createSubscription(sql, {
      kind: 'litepub', actorUrl: actor, actorHost: 'unsigned.example',
      selector: null, followActivityId: followId,
    });
    expect(sub.subscription.state).toBe('pending');
    const response = await gw.fetch(new Request('https://gateway.example/actors/gateway/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/activity+json' },
      body: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: prefix + 'unsigned-accept', type: 'Accept', actor,
        object: followId, to: ['https://www.w3.org/ns/activitystreams#Public'],
      }),
    }));
    // Some inbox implementations deliberately acknowledge unverified traffic
    // with 202 to prevent signature probing. The durable state is authoritative.
    expect(response.status).toBeLessThan(500);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect((await getSubscription(sql, sub.subscription.id))?.state).toBe('pending');
  });

  dbTest('unsigned public Create cannot bypass inbox verification or create a discovery record', async () => {
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456',
      DATABASE_URL: databaseUrl!,
    });
    const gw = buildGateway(cfg, {
      kv: new MemoryKvStore(), queue: new InProcessMessageQueue(), sql,
    });
    const actor = 'https://unsigned.example/actors/announcer';
    const sub = await createSubscription(sql, {
      kind: 'litepub', actorUrl: actor, actorHost: 'unsigned.example',
      selector: null, followActivityId: prefix + 'announcer-follow',
    });
    await setSubscriptionState(sql, sub.subscription.id, 'accepted');
    // A same-origin Create contains everything necessary for the ingestion
    // policy to accept it if authentication is ever accidentally bypassed.
    // Unlike Announce, it does not require a remote origin lookup fixture.
    const id = `https://unsigned.example/notes/${crypto.randomUUID()}`;
    const activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://unsigned.example/activities/${crypto.randomUUID()}`,
      type: 'Create', actor,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      object: {
        id, type: 'Note', attributedTo: actor,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        content: 'Unsigned activity must not be cached',
      },
    };
    // Prove the otherwise-public payload would pass our content policy.
    // The inbox signature verification is the only remaining barrier.
    expect(authorizeIngest({ body: activity, subscribedActors: new Set([actor]) }).ok).toBe(true);
    const response = await gw.fetch(new Request('https://gateway.example/actors/gateway/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/activity+json' },
      body: JSON.stringify(activity),
    }));
    expect(response.status).toBeLessThan(500);
    await new Promise(resolve => setTimeout(resolve, 30));
    const found = await queryItems(sql, { limit: 50 });
    expect(found.items.some(item => item.id === id)).toBe(false);
  });

  dbTest('Mastodon relay adapter fails closed before actor lookup or storage', async () => {
    let called = false;
    const gateway = { lookupActor: async () => { called = true; return null; } } as unknown as Gateway;
    const result = await subscribe(gateway, sql, 'https://gateway.example', {
      type: 'actor', value: 'https://relay.example/actor', kind: 'mastodon',
    });
    expect(result).toMatchObject({ ok: false, status: 501 });
    expect(called).toBe(false);
  });
});
