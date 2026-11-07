/**
 * Real PostgreSQL integration tests. CI starts a disposable PostgreSQL 16
 * service; no remote federation or production data is touched.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres, { type Sql } from 'postgres';
import { Service } from '@fedify/vocab';
import { InProcessMessageQueue, MemoryKvStore, generateCryptoKeyPair, signRequest } from '@fedify/fedify';
import { getDocumentLoader, type DocumentLoaderFactory } from '@fedify/vocab-runtime';
import { buildGateway } from './federation.ts';
import { createHandler } from './http.ts';
import { loadConfig } from './config.ts';
import { authorizeIngest } from './policy.ts';
import {
  acceptedSubscriptionActors, createSubscription, deleteItem, getSubscription,
  initSchema, insertItem, listFacets, listSubscriptions, loadKeyPair, normalizeStoredHashtags, pruneItems, queryItems,
  saveKeyPair, setPendingFollowId, setSubscriptionState, settlePendingFollow, subscriptionByFollowId,
  type GatewayItem,
} from './db.ts';
import { retrySubscription, subscribe, unsubscribe } from './subscribe.ts';
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

  dbTest('IDOR: only the admin bearer may mutate even a known subscription UUID', async () => {
    const sub = await createSubscription(sql, {
      kind: 'litepub', actorUrl: 'https://relay.example/actors/idortest',
      actorHost: 'relay.example', selector: null, followActivityId: prefix + 'idor-follow',
    });
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456',
      DATABASE_URL: databaseUrl!,
    });
    let remoteCalls = 0;
    const gateway = {
      lookupActor: async () => { remoteCalls++; return null; },
      sendFollow: async () => { remoteCalls++; },
      sendUndoFollow: async () => { remoteCalls++; },
      fetch: async () => new Response('not found', { status: 404 }),
    } as unknown as Gateway;
    const handle = createHandler({ cfg, gateway, sql });
    const target = `https://gateway.example/admin/subscriptions/${sub.subscription.id}`;
    for (const method of ['DELETE', 'POST'] as const) {
      const url = method === 'POST' ? target + '/retry' : target;
      for (const authorization of [undefined, 'Bearer wrong-token']) {
        const headers = authorization ? { Authorization: authorization } : undefined;
        const response = await handle(new Request(url, { method, headers }));
        expect(response.status).toBe(401);
      }
    }
    expect((await getSubscription(sql, sub.subscription.id))?.state).toBe('pending');
    expect(remoteCalls).toBe(0);
  });

  dbTest('late signed responses cannot accept disabled, mismatched, or rotated subscriptions', async () => {
    const actorUrl = 'https://relay.example/actors/state-test';
    const oldFollow = prefix + 'state-old';
    const sub = await createSubscription(sql, {
      kind: 'litepub', actorUrl, actorHost: 'relay.example', selector: null,
      followActivityId: oldFollow,
    });
    expect(await settlePendingFollow(sql, oldFollow, 'https://other.example/actor', 'accepted')).toBe(false);
    expect(await settlePendingFollow(sql, prefix + 'fake', actorUrl, 'accepted')).toBe(false);
    await setSubscriptionState(sql, sub.subscription.id, 'disabled');
    expect(await settlePendingFollow(sql, oldFollow, actorUrl, 'accepted')).toBe(false);
    expect((await getSubscription(sql, sub.subscription.id))?.state).toBe('disabled');

    const newFollow = prefix + 'state-new';
    expect(await setPendingFollowId(sql, sub.subscription.id, newFollow)).toBe(true);
    expect(await settlePendingFollow(sql, oldFollow, actorUrl, 'accepted')).toBe(false);
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      settlePendingFollow(sql, newFollow, actorUrl, i % 2 ? 'rejected' : 'accepted')));
    expect(attempts.filter(Boolean).length).toBe(1);
    const settled = await getSubscription(sql, sub.subscription.id);
    expect(settled).not.toBeNull();
    expect(['accepted', 'rejected']).toContain(settled!.state);
    expect(await settlePendingFollow(sql, newFollow, actorUrl, 'accepted')).toBe(false);
  });

  dbTest('disabled sources cannot be silently reenabled through duplicate subscribe', async () => {
    const actorUrl = 'https://relay.example/actors/disabled-source';
    const sub = await createSubscription(sql, {
      kind: 'litepub', actorUrl, actorHost: 'relay.example', selector: null,
      followActivityId: prefix + 'disabled-source-follow',
    });
    await setSubscriptionState(sql, sub.subscription.id, 'disabled');
    let followCalls = 0;
    const gateway = {
      lookupActor: async () => new Service({
        id: new URL(actorUrl), inbox: new URL('https://relay.example/inbox'),
      }),
      sendFollow: async () => { followCalls++; },
    } as unknown as Gateway;
    const result = await subscribe(gateway, sql, 'https://gateway.example',
      { type: 'actor', value: actorUrl, kind: 'litepub' });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(followCalls).toBe(0);
    expect((await getSubscription(sql, sub.subscription.id))?.state).toBe('disabled');
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

  dbTest('hashtags persist as indexed JSONB arrays, filter correctly, and legacy strings do not break reads', async () => {
    const id = prefix + 'hashtag-shape';
    expect(await insertItem(sql, item(id, undefined, ['fediverse', 'testing']))).toBe(true);
    const row = await sql`SELECT jsonb_typeof(hashtags) AS kind FROM gateway_items WHERE id = ${id}`;
    expect(row[0]?.kind).toBe('array');
    const tagPage = await queryItems(sql, { tag: 'fediverse', limit: 10 });
    expect(tagPage.items.some(result => result.id === id && result.hashtags.includes('testing'))).toBe(true);

    // Simulate historical JSON.stringify() being inserted into a JSONB column.
    await sql`UPDATE gateway_items SET hashtags = ${sql.json(JSON.stringify(['legacy', 'valid']))} WHERE id = ${id}`;
    const legacy = await queryItems(sql, { limit: 30 });
    expect(legacy.items.find(result => result.id === id)?.hashtags).toEqual(['legacy', 'valid']);

    expect(normalizeStoredHashtags('not json')).toEqual([]);
    expect(normalizeStoredHashtags('{"unexpected":true}')).toEqual([]);
    expect(normalizeStoredHashtags(['ok', 42, null, 'x'])).toEqual(['ok', 'x']);
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

  dbTest('relay alias resolves to canonical actor ID for Follow and acceptance correlation', async () => {
    const alias = 'https://relay.example/@selective';
    const canonical = 'https://relay.example/actors/selective';
    const followIds: string[] = [];
    const gateway = {
      lookupActor: async () => new Service({
        id: new URL(canonical), inbox: new URL('https://relay.example/inbox'),
      }),
      sendFollow: async (_actor: unknown, followId: string) => { followIds.push(followId); },
    } as unknown as Gateway;
    const first = await subscribe(gateway, sql, 'https://gateway.example',
      { type: 'actor', value: alias, kind: 'litepub' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.subscription.actorUrl).toBe(canonical);
    expect(first.created).toBe(true);
    expect(followIds).toHaveLength(1);
    expect(await settlePendingFollow(sql, followIds[0]!, canonical, 'accepted')).toBe(true);
    const repeated = await subscribe(gateway, sql, 'https://gateway.example',
      { type: 'actor', value: alias, kind: 'litepub' });
    expect(repeated).toMatchObject({ ok: true, created: false });
    expect(followIds).toHaveLength(1);
    expect((await getSubscription(sql, first.subscription.id))?.state).toBe('accepted');
  });

  dbTest('legacy disabled alias is canonicalized without Follow or state bypass', async () => {
    const alias = 'https://relay.example/@legacy-disabled';
    const canonical = 'https://relay.example/actors/legacy-disabled';
    const previous = await createSubscription(sql, {
      kind: 'litepub', actorUrl: alias, actorHost: 'relay.example',
      selector: null, followActivityId: prefix + 'legacy-disabled-follow',
    });
    await setSubscriptionState(sql, previous.subscription.id, 'disabled');
    let delivered = 0;
    const gateway = {
      lookupActor: async () => new Service({
        id: new URL(canonical), inbox: new URL('https://relay.example/inbox'),
      }),
      sendFollow: async () => { delivered++; },
    } as unknown as Gateway;
    const result = await subscribe(gateway, sql, 'https://gateway.example',
      { type: 'actor', value: alias, kind: 'litepub' });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(delivered).toBe(0);
    const migrated = await getSubscription(sql, previous.subscription.id);
    expect(migrated?.actorUrl).toBe(canonical);
    expect(migrated?.state).toBe('disabled');
    expect(migrated?.followActivityId).toBe(prefix + 'legacy-disabled-follow');
    const all = await listSubscriptions(sql);
    expect(all.filter(x => x.actorUrl === canonical)).toHaveLength(1);
    expect(all.filter(x => x.actorUrl === alias)).toHaveLength(0);
  });

  dbTest('conflicting legacy and canonical rows never merge or reactivate silently', async () => {
    const alias = 'https://relay.example/@legacy-conflict';
    const canonical = 'https://relay.example/actors/legacy-conflict';
    const old = await createSubscription(sql, {
      kind: 'litepub', actorUrl: alias, actorHost: 'relay.example',
      selector: null, followActivityId: prefix + 'legacy-conflict-follow',
    });
    const canonicalRow = await createSubscription(sql, {
      kind: 'litepub', actorUrl: canonical, actorHost: 'relay.example',
      selector: null, followActivityId: prefix + 'canonical-conflict-follow',
    });
    await setSubscriptionState(sql, old.subscription.id, 'disabled');
    await setSubscriptionState(sql, canonicalRow.subscription.id, 'accepted');
    let delivered = 0;
    const gateway = {
      lookupActor: async () => new Service({
        id: new URL(canonical), inbox: new URL('https://relay.example/inbox'),
      }),
      sendFollow: async () => { delivered++; },
    } as unknown as Gateway;
    const result = await subscribe(gateway, sql, 'https://gateway.example',
      { type: 'actor', value: alias, kind: 'litepub' });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(delivered).toBe(0);
    expect((await getSubscription(sql, old.subscription.id))?.state).toBe('disabled');
    expect((await getSubscription(sql, old.subscription.id))?.actorUrl).toBe(alias);
    expect((await getSubscription(sql, canonicalRow.subscription.id))?.state).toBe('accepted');
    expect((await getSubscription(sql, canonicalRow.subscription.id))?.actorUrl).toBe(canonical);
  });

  dbTest('forged actor IDs and cross-origin inboxes are rejected before persistence or delivery', async () => {
    const target = 'https://relay.example/actors/selection';
    let followed = 0;
    const cases = [
      { id: 'https://attacker.example/actor', inbox: 'https://relay.example/inbox' },
      { id: 'http://relay.example/actor', inbox: 'https://relay.example/inbox' },
      { id: 'https://relay.example:8443/actor', inbox: 'https://relay.example/inbox' },
      { id: 'https://relay.example/actors/selection', inbox: 'https://attacker.example/inbox' },
      { id: 'https://relay.example/actors/selection', inbox: 'http://relay.example/inbox' },
    ];
    for (const bad of cases) {
      const gateway = {
        lookupActor: async () => new Service({
          id: new URL(bad.id), inbox: new URL(bad.inbox),
        }),
        sendFollow: async () => { followed++; },
      } as unknown as Gateway;
      const result = await subscribe(gateway, sql, 'https://gateway.example',
        { type: 'actor', value: target, kind: 'litepub' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
    expect(followed).toBe(0);
    const all = await listSubscriptions(sql);
    expect(all.some(x => x.actorUrl === target)).toBe(false);
  });

  dbTest('retries fail closed if the previously accepted actor moves identity or inbox', async () => {
    const url = 'https://relay.example/actors/retry-canonical';
    const sub = await createSubscription(sql, {
      kind: 'litepub', actorUrl: url, actorHost: 'relay.example',
      selector: null, followActivityId: prefix + 'retry-canonical-initial',
    });
    await setSubscriptionState(sql, sub.subscription.id, 'rejected');
    let delivered = 0;
    const maliciousGateway = {
      lookupActor: async () => new Service({
        id: new URL(url), inbox: new URL('https://attacker.example/inbox'),
      }),
      sendFollow: async () => { delivered++; },
      sendUndoFollow: async () => { delivered++; },
    } as unknown as Gateway;
    const outcome = await retrySubscription(maliciousGateway, sql,
      'https://gateway.example', sub.subscription.id);
    expect(outcome).toMatchObject({ ok: false, status: 502 });
    expect(delivered).toBe(0);
    expect((await getSubscription(sql, sub.subscription.id))?.followActivityId)
      .toBe(prefix + 'retry-canonical-initial');
    const unsub = await unsubscribe(maliciousGateway, sql, sub.subscription.id);
    expect(unsub).toMatchObject({ ok: true });
    expect(delivered).toBe(0);
    expect((await getSubscription(sql, sub.subscription.id))?.state).toBe('disabled');
  });

  dbTest('positive signed ActivityPub Accept, Create and Announce via real Fedify inbox', async () => {
    // All remote actor and origin documents are synthetic. The network guard
    // in test-preload.ts rejects every non-fixture external request.
    const actorId = 'https://relay.integration.example/actor';
    const keyId = new URL(actorId + '#main-key');
    const { privateKey, publicKey } = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
    const b64 = btoa(Array.from(spki, x => String.fromCharCode(x)).join(''));
    const pem = '-----BEGIN PUBLIC KEY-----\n' + b64.match(/.{1,64}/g)!.join('\n') + '\n-----END PUBLIC KEY-----';
    const actorDoc = {
      '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
      id: actorId, type: 'Service', inbox: actorId + '/inbox',
      publicKey: { id: keyId.href, owner: actorId, publicKeyPem: pem },
    };
    const originId = `https://origin.integration.example/notes/${crypto.randomUUID()}`;
    const authorId = 'https://origin.integration.example/actors/author';
    const originalNote = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        { Hashtag: 'as:Hashtag' },
      ],
      id: originId, type: 'Note', attributedTo: authorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      content: '<p>Original author public post</p>',
      tag: [{ type: 'Hashtag', href: 'https://origin.integration.example/tags/integration', name: '#integration' }],
    };
    const blockedOriginId = `https://origin.integration.example/notes/${crypto.randomUUID()}`;
    const fixtures = new Map<string, unknown>([[actorId, actorDoc], [keyId.href, actorDoc], [originId, originalNote], [blockedOriginId, { ...originalNote, id: blockedOriginId }]]);
    let blockedOriginLookups = 0;
    const documentLoaderFactory: DocumentLoaderFactory = options => {
      const defaultLoader = getDocumentLoader({ ...options, allowPrivateAddress: false });
      return async url => {
        if (url === blockedOriginId) blockedOriginLookups++;
        const fixture = fixtures.get(url);
        if (fixture) return { contextUrl: null, documentUrl: url, document: fixture };
        return defaultLoader(url);
      };
    };
    const cfg = loadConfig({
      GATEWAY_ORIGIN: 'https://gateway.example',
      GATEWAY_ADMIN_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456',
      DATABASE_URL: databaseUrl!,
    });
    const authenticationReports: Array<{ authentication: unknown; outcome: unknown; checks: unknown }> = [];
    const gw = buildGateway(cfg, {
      kv: new MemoryKvStore(),
      queue: new InProcessMessageQueue(),
      sql,
    }, { documentLoaderFactory, authenticatedDocumentLoaderFactory: (_identity, options) => documentLoaderFactory(options), onRequestFinished: report => {
      authenticationReports.push({
        authentication: report.authentication, outcome: report.outcome,
        checks: report.attempts.map(attempt => ({
          mechanism: attempt.mechanism, status: attempt.status, reason: 'reason' in attempt ? attempt.reason : null,
          checks: attempt.checks.map(check => ({
            mechanism: check.mechanism, status: check.status, reason: 'reason' in check ? check.reason : null,
            keyId: check.declaredKeyId, triedKeys: check.triedKeys.map(key => ({
              fields: Object.keys(key), id: key.id,
            })),
          })),
        })),
      });
    } });

    const workerStop = new AbortController();
    const worker = gw.federation.startQueue(undefined, { signal: workerStop.signal });
    try {
    const followId = prefix + 'positive-signed-follow';
    const subscription = await createSubscription(sql, {
      kind: 'litepub', actorUrl: actorId, actorHost: 'relay.integration.example',
      selector: null, followActivityId: followId,
    });
    const inbox = 'https://gateway.example/actors/gateway/inbox';
    async function postSigned(activity: Record<string, unknown>) {
      const request = new Request(inbox, {
        method: 'POST', headers: { 'content-type': 'application/activity+json' },
        body: JSON.stringify({ '@context': 'https://www.w3.org/ns/activitystreams', ...activity }),
      });
      const signed = await signRequest(request, privateKey, keyId, { spec: 'draft-cavage-http-signatures-12' });
      return gw.fetch(signed);
    }
    async function poll(assertion: () => Promise<boolean>): Promise<boolean> {
      for (let tries = 0; tries < 25; tries++) {
        if (await assertion()) return true;
        await Bun.sleep(20);
      }
      return false;
    }

    const accepted = await postSigned({
      id: actorId + '/activities/accept-' + crypto.randomUUID(),
      type: 'Accept', actor: actorId, object: followId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
    });
    expect(authenticationReports.some(report => (report.authentication as { status?: string }).status === 'verified')).toBe(true);
    expect(accepted.status).toBeLessThan(300);
    expect(await poll(async () => (await getSubscription(sql, subscription.subscription.id))?.state === 'accepted')).toBe(true);

    const authoredId = `https://relay.integration.example/notes/${crypto.randomUUID()}`;
    const created = await postSigned({
      id: actorId + '/activities/create-' + crypto.randomUUID(),
      type: 'Create', actor: actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      object: {
        id: authoredId, type: 'Note', attributedTo: actorId,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        content: '<p>Verified relay-authored public post</p>',
      },
    });
    expect(created.status).toBeLessThan(300);
    expect(await poll(async () => (await queryItems(sql, { limit: 50 })).items.some(x => x.id === authoredId))).toBe(true);

    const announced = await postSigned({
      id: actorId + '/activities/announce-' + crypto.randomUUID(),
      type: 'Announce', actor: actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      object: originId,
    });
    expect(announced.status).toBeLessThan(300);
    expect(await poll(async () => (await queryItems(sql, { limit: 50 })).items.some(x => x.id === originId))).toBe(true);
    const stored = (await queryItems(sql, { limit: 50 })).items.find(x => x.id === originId);
    expect(stored?.authorId).toBe(authorId);
    expect(stored?.relayActor).toBe(actorId);
    expect(stored?.hashtags).toEqual(['integration']);

    // A correctly signed message is not authorized once the subscription is disabled.
    // This also proves that disabled Announce cannot trigger even a fixture origin lookup.
    await setSubscriptionState(sql, subscription.subscription.id, 'disabled');
    const repeatedAccept = await postSigned({
      id: actorId + '/activities/late-accept-' + crypto.randomUUID(),
      type: 'Accept', actor: actorId, object: followId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
    });
    expect(repeatedAccept.status).toBeLessThan(300);

    const disabledCreateId = `https://relay.integration.example/notes/${crypto.randomUUID()}`;
    const disabledCreate = await postSigned({
      id: actorId + '/activities/disabled-create-' + crypto.randomUUID(),
      type: 'Create', actor: actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      object: {
        id: disabledCreateId, type: 'Note', attributedTo: actorId,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        content: '<p>Should not be ingested after unsubscribe</p>',
      },
    });
    expect(disabledCreate.status).toBeLessThan(300);

    const disabledAnnounce = await postSigned({
      id: actorId + '/activities/disabled-announce-' + crypto.randomUUID(),
      type: 'Announce', actor: actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      object: blockedOriginId,
    });
    expect(disabledAnnounce.status).toBeLessThan(300);
    // In-process queue delivery is asynchronous. Allow a bounded interval
    // before checking that signed late deliveries caused no persisted changes.
    await Bun.sleep(250);
    expect((await getSubscription(sql, subscription.subscription.id))?.state).toBe('disabled');
    expect(blockedOriginLookups).toBe(0);
    const afterDisable = (await queryItems(sql, { limit: 50 })).items;
    expect(afterDisable.some(x => x.id === disabledCreateId || x.id === blockedOriginId)).toBe(false);
    // Even a signature-verified reciprocal Follow is unsolicited after the
    // local source is disabled, and must not reactivate the subscription.
    const lateFollow = await postSigned({
      id: actorId + '/activities/late-follow-' + crypto.randomUUID(),
      type: 'Follow', actor: actorId,
      object: 'https://gateway.example/actors/gateway',
    });
    expect(lateFollow.status).toBeLessThan(300);
    await Bun.sleep(100);
    expect((await getSubscription(sql, subscription.subscription.id))?.state).toBe('disabled');
    } finally {
      workerStop.abort();
      await worker;
    }
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
