/**
 * Durable PostgreSQL state: actor keypairs, subscriptions (with the Follow
 * activity id we sent), ingested items with full provenance, and atomic
 * duplicate suppression. All writes are idempotent; dedup uses a single
 * INSERT ... ON CONFLICT DO NOTHING guarded by a primary key, which is atomic
 * across processes on real PostgreSQL.
 *
 * The schema is created up front so a misconfigured database fails at startup,
 * not on first delivery. Tables are gateway-owned and additive only.
 */

import type { Sql } from 'postgres';

export type SubscriptionKind = 'mastodon' | 'litepub' | 'fedibuzz-tag' | 'fedibuzz-instance';
export type SubscriptionState = 'pending' | 'accepted' | 'rejected' | 'disabled';

export type Subscription = {
  id: string;
  kind: SubscriptionKind;
  actorUrl: string;
  actorHost: string;
  /** FediBuzz tag or instance domain; null for plain mastodon/litepub follows. */
  selector: string | null;
  state: SubscriptionState;
  followActivityId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GatewayItem = {
  id: string; // canonical object id (the original post URL)
  activityId: string; // id of the activity that delivered it
  relayActor: string; // actor URL of the subscription that delivered it
  authorId: string | null;
  authorName: string | null;
  authorHandle: string | null;
  authorUrl: string | null;
  objectOrigin: string;
  url: string | null; // canonical human-facing URL
  summary: string | null;
  text: string;
  hashtags: string[];
  publishedAt: string | null;
  ingestedAt: string;
};

export type ItemPage = { items: GatewayItem[]; nextCursor: string | null };

export async function initSchema(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS gateway_keys (
      actor_identifier TEXT PRIMARY KEY,
      private_key JSONB NOT NULL,
      public_key JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS gateway_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind TEXT NOT NULL CHECK (kind IN ('mastodon','litepub','fedibuzz-tag','fedibuzz-instance')),
      actor_url TEXT NOT NULL UNIQUE,
      actor_host TEXT NOT NULL,
      selector TEXT,
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','rejected','disabled')),
      follow_activity_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS gateway_items (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL UNIQUE,
      relay_actor TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT,
      author_handle TEXT,
      author_url TEXT,
      object_origin TEXT NOT NULL,
      url TEXT,
      summary TEXT,
      text TEXT NOT NULL,
      hashtags JSONB NOT NULL DEFAULT '[]',
      published_at TIMESTAMPTZ,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS gateway_items_ingested ON gateway_items (ingested_at DESC, id)`;
  await sql`CREATE INDEX IF NOT EXISTS gateway_items_origin ON gateway_items (object_origin)`;
  await sql`CREATE INDEX IF NOT EXISTS gateway_items_hashtags ON gateway_items USING gin (hashtags)`;
  await sql`
    CREATE TABLE IF NOT EXISTS gateway_seen (
      activity_id TEXT PRIMARY KEY,
      seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
}

// ---- keys ----

export async function loadKeyPair(sql: Sql, identifier: string): Promise<{ privateKey: unknown; publicKey: unknown } | null> {
  const rows = await sql`SELECT private_key, public_key FROM gateway_keys WHERE actor_identifier = ${identifier}`;
  const row = rows[0] as { private_key: unknown; public_key: unknown } | undefined;
  return row ? { privateKey: row.private_key, publicKey: row.public_key } : null;
}

export async function saveKeyPair(sql: Sql, identifier: string, privateKey: unknown, publicKey: unknown): Promise<void> {
  await sql`
    INSERT INTO gateway_keys (actor_identifier, private_key, public_key)
    VALUES (${identifier}, ${JSON.stringify(privateKey)}, ${JSON.stringify(publicKey)})
    ON CONFLICT (actor_identifier) DO NOTHING`;
}

// ---- subscriptions ----

type SubRow = { id: string; kind: SubscriptionKind; actor_url: string; actor_host: string; selector: string | null; state: SubscriptionState; follow_activity_id: string | null; created_at: Date; updated_at: Date };

function toSubscription(r: SubRow): Subscription {
  return { id: r.id, kind: r.kind, actorUrl: r.actor_url, actorHost: r.actor_host, selector: r.selector, state: r.state, followActivityId: r.follow_activity_id, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
}

/** Insert-if-absent; returns the existing row when the actor URL is already subscribed (idempotent). */
export async function createSubscription(sql: Sql, sub: { kind: SubscriptionKind; actorUrl: string; actorHost: string; selector: string | null; followActivityId: string }): Promise<{ subscription: Subscription; created: boolean }> {
  const inserted = await sql<SubRow[]>`
    INSERT INTO gateway_subscriptions (kind, actor_url, actor_host, selector, follow_activity_id)
    VALUES (${sub.kind}, ${sub.actorUrl}, ${sub.actorHost}, ${sub.selector}, ${sub.followActivityId})
    ON CONFLICT (actor_url) DO NOTHING
    RETURNING *`;
  if (inserted[0]) return { subscription: toSubscription(inserted[0]), created: true };
  const existing = await sql<SubRow[]>`SELECT * FROM gateway_subscriptions WHERE actor_url = ${sub.actorUrl}`;
  if (!existing[0]) throw new Error('subscription insert raced and row vanished');
  return { subscription: toSubscription(existing[0]), created: false };
}

export async function listSubscriptions(sql: Sql): Promise<Subscription[]> {
  const rows = await sql<SubRow[]>`SELECT * FROM gateway_subscriptions ORDER BY created_at ASC`;
  return rows.map(toSubscription);
}

export async function getSubscription(sql: Sql, id: string): Promise<Subscription | null> {
  const rows = await sql<SubRow[]>`SELECT * FROM gateway_subscriptions WHERE id = ${id}`;
  return rows[0] ? toSubscription(rows[0]) : null;
}

export async function setSubscriptionState(sql: Sql, id: string, state: SubscriptionState): Promise<void> {
  await sql`UPDATE gateway_subscriptions SET state = ${state}, updated_at = now() WHERE id = ${id}`;
}

/** Accepted subscriptions whose actor host matches (for the ingest gate). */
export async function acceptedSubscriptionHosts(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ actor_host: string }[]>`SELECT actor_host FROM gateway_subscriptions WHERE state = 'accepted'`;
  return new Set(rows.map(r => r.actor_host));
}

/** Find a subscription by the Follow activity id we sent (for Accept/Reject correlation). */
export async function subscriptionByFollowId(sql: Sql, followActivityId: string): Promise<Subscription | null> {
  const rows = await sql<SubRow[]>`SELECT * FROM gateway_subscriptions WHERE follow_activity_id = ${followActivityId}`;
  return rows[0] ? toSubscription(rows[0]) : null;
}

// ---- seen (atomic dedup) ----

/** True for exactly one caller across all processes; false for duplicates. */
export async function claimActivity(sql: Sql, activityId: string): Promise<boolean> {
  const rows = await sql`INSERT INTO gateway_seen (activity_id) VALUES (${activityId}) ON CONFLICT (activity_id) DO NOTHING RETURNING activity_id`;
  return rows.length === 1;
}

// ---- items ----

type ItemRow = { id: string; activity_id: string; relay_actor: string; author_id: string | null; author_name: string | null; author_handle: string | null; author_url: string | null; object_origin: string; url: string | null; summary: string | null; text: string; hashtags: string[]; published_at: Date | null; ingested_at: Date };

function toItem(r: ItemRow): GatewayItem {
  return { id: r.id, activityId: r.activity_id, relayActor: r.relay_actor, authorId: r.author_id, authorName: r.author_name, authorHandle: r.author_handle, authorUrl: r.author_url, objectOrigin: r.object_origin, url: r.url, summary: r.summary, text: r.text, hashtags: r.hashtags ?? [], publishedAt: r.published_at?.toISOString() ?? null, ingestedAt: r.ingested_at.toISOString() };
}

export async function insertItem(sql: Sql, item: Omit<GatewayItem, 'ingestedAt'>): Promise<boolean> {
  const rows = await sql`
    INSERT INTO gateway_items (id, activity_id, relay_actor, author_id, author_name, author_handle, author_url, object_origin, url, summary, text, hashtags, published_at)
    VALUES (${item.id}, ${item.activityId}, ${item.relayActor}, ${item.authorId}, ${item.authorName}, ${item.authorHandle}, ${item.authorUrl}, ${item.objectOrigin}, ${item.url}, ${item.summary}, ${item.text}, ${JSON.stringify(item.hashtags)}, ${item.publishedAt})
    ON CONFLICT (id) DO NOTHING
    RETURNING id`;
  return rows.length === 1;
}

export type ItemQuery = { tag?: string | null; domain?: string | null; search?: string | null; cursor?: string | null; limit: number };

/**
 * Keyset pagination over (ingested_at, id). The cursor is the last item's id;
 * stable because ids are canonical object URLs and ingestion is append-only.
 */
export async function queryItems(sql: Sql, q: ItemQuery): Promise<ItemPage> {
  let cursorRow: { ingested_at: Date; id: string } | undefined;
  if (q.cursor) {
    const rows = await sql<{ ingested_at: Date; id: string }[]>`SELECT ingested_at, id FROM gateway_items WHERE id = ${q.cursor}`;
    cursorRow = rows[0];
    if (!cursorRow) return { items: [], nextCursor: null };
  }
  const tag = q.tag?.replace(/^#/, '').trim().toLowerCase() || null;
  const domain = q.domain?.trim().toLowerCase() || null;
  const search = q.search?.trim() || null;
  const rows = await sql<ItemRow[]>`
    SELECT * FROM gateway_items
    WHERE (${tag}::text IS NULL OR hashtags @> ${JSON.stringify([tag ?? ''])}::jsonb)
      AND (${domain}::text IS NULL OR object_origin = ${'https://' + (domain ?? '')})
      AND (${search}::text IS NULL OR text ILIKE ${'%' + (search ?? '') + '%'} OR author_name ILIKE ${'%' + (search ?? '') + '%'} OR author_handle ILIKE ${'%' + (search ?? '') + '%'})
      AND (${cursorRow?.id ?? null}::text IS NULL OR (ingested_at, id) < (${cursorRow?.ingested_at ?? new Date(0)}, ${cursorRow?.id ?? ''}))
    ORDER BY ingested_at DESC, id DESC
    LIMIT ${q.limit + 1}`;
  const items = rows.slice(0, q.limit).map(toItem);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > q.limit && last ? last.id : null };
}

/** Distinct filter facets for the read API: subscribed tags and seen origins. */
export async function listFacets(sql: Sql): Promise<{ tags: string[]; domains: string[] }> {
  const tagRows = await sql<{ selector: string }[]>`SELECT DISTINCT selector FROM gateway_subscriptions WHERE kind = 'fedibuzz-tag' AND state = 'accepted' AND selector IS NOT NULL ORDER BY selector`;
  const domainRows = await sql<{ origin: string }[]>`SELECT DISTINCT object_origin AS origin FROM gateway_items ORDER BY origin LIMIT 200`;
  return {
    tags: tagRows.map(r => r.selector),
    domains: domainRows.map(r => r.origin.replace(/^https:\/\//, '')),
  };
}

export async function deleteItem(sql: Sql, objectId: string): Promise<void> {
  await sql`DELETE FROM gateway_items WHERE id = ${objectId}`;
}

/** Keep the table bounded; removes the oldest rows beyond maxItems. */
export async function pruneItems(sql: Sql, maxItems: number): Promise<void> {
  await sql`
    DELETE FROM gateway_items WHERE id IN (
      SELECT id FROM gateway_items ORDER BY ingested_at DESC, id DESC OFFSET ${maxItems}
    )`;
}
