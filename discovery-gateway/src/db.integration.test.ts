/**
 * Real PostgreSQL integration tests. CI starts a disposable PostgreSQL 16
 * service; no remote federation or production data is touched.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres, { type Sql } from 'postgres';
import { Service } from '@fedify/vocab';
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
