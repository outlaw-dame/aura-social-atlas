/**
 * Collections — server side: consent checks against the featured account's own server, reading Mastodon
 * collections, and storage of Atlas collections. Rules and types are in collections.ts.
 *
 * Remote reads use safeFetch (public https only, every hop resolved and checked, size and time limits).
 * Atlas tables are server-only (service role), so every write passes through here and consent can't be skipped.
 */
import { safeFetch, type Lookup } from './article-author.server';
import {
  COLLECTIONS_MAX, ITEMS_MAX, accountFromMastodon, collectionFromMastodon, featureDecision, mastodonCollectionApi,
  parseFediHandle, type Collection, type CollectionAccount, type CollectionInput,
} from './collections';

const JSON_ACCEPT = 'application/json';
const admin = async () => (await import('@/integrations/supabase/client.server')).supabaseAdmin;
const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return null; } };

/** Network seam for tests; production uses the real fetch and DNS-over-HTTPS check. */
export const net: { fetch?: (input: string, init?: RequestInit) => Promise<Response>; lookup?: Lookup } = {};

async function getJson(url: string): Promise<unknown> {
  const res = await safeFetch(url, JSON_ACCEPT, net.fetch, net.lookup);
  return res && res.type.includes('json') ? parse(res.text) : null;
}

/* ── Consent ─────────────────────────────────────────────────────────────────────────────────── */

export type FeatureCheck =
  | { ok: true; account: CollectionAccount }
  | { ok: false; reason: 'denied' | 'missing' | 'not-found' | 'unsupported-network'; account?: CollectionAccount };

const hostOf = (u: unknown) => { try { return typeof u === 'string' ? new URL(u).hostname.toLowerCase() : null; } catch { return null; } };
/** The lookup result is the host's own account `user`: local acct, and its uri and url on that host. */
function isAuthoritative(a: unknown, user: string, host: string): boolean {
  const x = a as { acct?: unknown; username?: unknown; uri?: unknown; url?: unknown };
  return typeof x.acct === 'string' && !x.acct.includes('@') && x.acct.toLowerCase() === user.toLowerCase()
    && hostOf(x.uri) === host && hostOf(x.url) === host;
}

/** Looks the account up on its own server and reads its feature_approval (Mastodon 4.6+). */
export async function checkFeatureable(handle: string): Promise<FeatureCheck> {
  const h = parseFediHandle(handle);
  if (!h) return { ok: false, reason: /bsky|\.rss|feed/i.test(handle) ? 'unsupported-network' : 'not-found' };
  const a = await getJson(`https://${h.host}/api/v1/accounts/lookup?acct=${encodeURIComponent(h.user)}`);
  const account = accountFromMastodon(a, h.host);
  // Only the account's own server can speak for it: the result must be a local account of the host we asked
  // (not a cached remote account, nor one claiming another server's identity).
  if (!account || !isAuthoritative(a, h.user, h.host)) return { ok: false, reason: 'not-found' };
  const approval = (a as { feature_approval?: unknown }).feature_approval;
  if (approval == null) return { ok: false, reason: 'missing', account };
  return featureDecision(approval as never) === 'automatic' ? { ok: true, account } : { ok: false, reason: 'denied', account };
}

/* ── Mastodon collections (read-only) ────────────────────────────────────────────────────────── */

/** Opens a shared Mastodon collection link inside Atlas. */
export async function readMastodonCollection(link: string): Promise<Collection | null> {
  const api = mastodonCollectionApi(link);
  if (!api) return null;
  return collectionFromMastodon(await getJson(api.api), api.host);
}

/** A Mastodon account's public (discoverable) collections, with their members when the server sends them. */
export async function readAccountCollections(handle: string): Promise<Collection[]> {
  const h = parseFediHandle(handle);
  if (!h) return [];
  const a = await getJson(`https://${h.host}/api/v1/accounts/lookup?acct=${encodeURIComponent(h.user)}`);
  const id = (a as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return [];
  const data = await getJson(`https://${h.host}/api/v1/accounts/${id}/collections?limit=20`);
  // Either an array of Collection, or { collections, accounts } with account previews.
  const list = Array.isArray(data) ? data : (data as { collections?: unknown[] } | null)?.collections ?? [];
  const accounts = Array.isArray(data) ? [a] : [a, ...((data as { accounts?: unknown[] }).accounts ?? [])];
  return list
    .map(c => collectionFromMastodon({ collection: c, accounts }, h.host))
    .filter((c): c is Collection => !!c && c.discoverable);
}

/* ── Atlas collections (storage) ─────────────────────────────────────────────────────────────── */

type Row = {
  id: string; owner_id: string; name: string; description: string | null; tag_name: string | null; language: string | null;
  sensitive: boolean; discoverable: boolean; created_at: string; updated_at: string;
  atlas_collection_items?: { actor_uri: string; acct: string; display_name: string | null; avatar_url: string | null; profile_url: string | null; state: string; position: number }[];
};
const SELECT = 'id, owner_id, name, description, tag_name, language, sensitive, discoverable, created_at, updated_at, atlas_collection_items(actor_uri, acct, display_name, avatar_url, profile_url, state, position)';

async function curatorFor(ownerId: string) {
  const db = await admin();
  const { data } = await db.from('profiles').select('display_name').eq('id', ownerId).maybeSingle();
  return { name: data?.display_name || 'Atlas member' };
}

function toCollection(r: Row, curator: Collection['curator'], viewerIsOwner: boolean, origin?: string): Collection {
  const items = (r.atlas_collection_items ?? [])
    .filter(i => viewerIsOwner || i.state === 'accepted')
    .sort((a, b) => a.position - b.position)
    .map(i => ({ actorUri: i.actor_uri, acct: i.acct, name: i.display_name || i.acct, avatar: i.avatar_url ?? undefined, url: i.profile_url ?? undefined, state: i.state === 'pending' ? 'pending' as const : 'accepted' as const }));
  return {
    id: r.id, source: 'atlas', name: r.name, description: r.description ?? undefined, tag: r.tag_name ?? undefined,
    language: r.language ?? undefined, sensitive: r.sensitive, discoverable: r.discoverable, curator, items,
    itemCount: items.length, url: origin ? `${origin}/app?collection=${r.id}` : undefined, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function listMine(userId: string, origin?: string): Promise<Collection[]> {
  const db = await admin();
  const { data, error } = await db.from('atlas_collections').select(SELECT).eq('owner_id', userId).order('created_at', { ascending: false }).limit(COLLECTIONS_MAX);
  if (error) throw error;
  const curator = await curatorFor(userId);
  return (data as Row[]).map(r => toCollection(r, curator, true, origin));
}

/** Anyone with the link can open a collection (unlisted ones too, as on Mastodon). */
export async function getOne(id: string, viewerId: string | null, origin?: string): Promise<Collection | null> {
  const db = await admin();
  const { data } = await db.from('atlas_collections').select(SELECT).eq('id', id).maybeSingle();
  if (!data) return null;
  const r = data as Row;
  return toCollection(r, await curatorFor(r.owner_id), viewerId === r.owner_id, origin);
}

const fields = (i: CollectionInput) => ({
  name: i.name, description: i.description ?? null, tag_name: i.tag ?? null, language: i.language ?? null,
  sensitive: i.sensitive, discoverable: i.discoverable,
});

export async function create(userId: string, input: CollectionInput): Promise<string> {
  const db = await admin();
  const { count } = await db.from('atlas_collections').select('id', { count: 'exact', head: true }).eq('owner_id', userId);
  if ((count ?? 0) >= COLLECTIONS_MAX) throw new Error(`You can have up to ${COLLECTIONS_MAX} collections.`);
  const { data, error } = await db.from('atlas_collections').insert({ owner_id: userId, ...fields(input) }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function assertOwner(userId: string, id: string) {
  const db = await admin();
  const { data } = await db.from('atlas_collections').select('owner_id').eq('id', id).maybeSingle();
  if (!data || data.owner_id !== userId) throw new Error('Only the person who made this collection can change it.');
  return db;
}

export async function update(userId: string, id: string, input: CollectionInput) {
  const db = await assertOwner(userId, id);
  const { error } = await db.from('atlas_collections').update({ ...fields(input), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function remove(userId: string, id: string) {
  const db = await assertOwner(userId, id);
  const { error } = await db.from('atlas_collections').delete().eq('id', id);
  if (error) throw error;
}

/** Adds an account only if its own server says it can be featured. */
export async function addItem(userId: string, id: string, handle: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = await assertOwner(userId, id);
  const { count } = await db.from('atlas_collection_items').select('id', { count: 'exact', head: true }).eq('collection_id', id);
  if ((count ?? 0) >= ITEMS_MAX) return { ok: false, reason: `A collection can hold up to ${ITEMS_MAX} accounts.` };
  const check = await checkFeatureable(handle);
  if (!check.ok) return { ok: false, reason: check.reason };
  const a = check.account;
  const { error } = await db.from('atlas_collection_items').insert({
    collection_id: id, actor_uri: a.actorUri, acct: a.acct, display_name: a.name, avatar_url: a.avatar ?? null,
    profile_url: a.url ?? null, state: 'accepted', position: count ?? 0,
  });
  if (error) return { ok: false, reason: error.code === '23505' ? 'Already in this collection.' : 'Couldn’t add them. Try again.' };
  await db.from('atlas_collections').update({ updated_at: new Date().toISOString() }).eq('id', id);
  return { ok: true };
}

export async function removeItem(userId: string, id: string, actorUri: string) {
  const db = await assertOwner(userId, id);
  const { error } = await db.from('atlas_collection_items').delete().eq('collection_id', id).eq('actor_uri', actorUri);
  if (error) throw error;
}
