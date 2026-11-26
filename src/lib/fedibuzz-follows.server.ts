/**
 * FediBuzz relays followed from the person's Fedizen account (server only). See src/lib/fedibuzz.ts.
 *
 * Following a hashtag in Atlas also follows FediBuzz's relay for it, so public posts with the tag from across the
 * fediverse are pushed to Fedizen (as the relay's boosts) and can be acted on there. These relay accounts are plumbing,
 * not people: Atlas leaves them out of the following count and shows their boosts as where the post came from.
 */
import { fedizenGet, fedizenSend, PAGE_CURSOR } from './fedizen.server';
import { relayFromAcct, tagRelay, type Relayed, type TagRelay } from './fedibuzz';
import { webfingerActor } from './fedi-profile.server';

const PAGES = 25; // 25 × 80 accounts: far past what a person follows by hand
const TTL = 10 * 60_000;

export type RelayFollows = { relays: Relayed[]; complete: boolean };
/** Everyone the person follows on Fedizen, as full lowercase handles (`ann@mastodon.social`, `bea@fedizen.net`). */
export type Following = { accts: string[]; complete: boolean };
const cache = new Map<string, { at: number; value: Following }>();

/** Forget what was read for this person (after following or unfollowing someone, or a relay). */
export function forgetRelayFollows(userId: string) { cache.delete(userId); }

/** The person's Fedizen account id, from their own handle. */
async function myId(token: string, handle: string): Promise<string | null> {
  const acct = handle.replace(/^@/, '').split('@')[0];
  if (!acct || !/^[A-Za-z0-9_.-]{1,64}$/.test(acct)) return null;
  const r = await fedizenGet(token, `/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`).catch(() => null);
  const id = r?.status === 200 ? (r.data[0] as { id?: string } | undefined)?.id : undefined;
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** A Mastodon `acct` as a full handle: local accounts (no @) are Fedizen's own. */
export function fullAcct(acct: string | null | undefined): string | null {
  const a = (acct ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!a) return null;
  return a.includes('@') ? a : `${a}@fedizen.net`;
}

/**
 * Who the person follows, read from their following list a page at a time (cached 10 min, shared by the relay count
 * and Voices to know). `complete` is false when the list couldn't all be read; what was found is still right.
 */
export async function following(userId: string, token: string, handle: string | null | undefined): Promise<Following> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const id = handle ? await myId(token, handle) : null;
  if (!id) return { accts: [], complete: false };
  const accts: string[] = [];
  let next: string | undefined, complete = false;
  for (let page = 0; page < PAGES; page++) {
    const cursor = next ? encodeURIComponent(next) : undefined;
    if (cursor && !PAGE_CURSOR.test(cursor)) break;
    const r = await fedizenGet(token, `/api/v1/accounts/${id}/following?limit=80${cursor ? `&max_id=${cursor}` : ''}`).catch(() => null);
    if (!r || r.status !== 200) break;
    for (const a of r.data as { acct?: string }[]) { const f = fullAcct(a.acct); if (f) accts.push(f); }
    if (!r.next || !r.data.length) { complete = true; break; }
    next = r.next;
  }
  const value = { accts, complete };
  cache.set(userId, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return value;
}

/** Which FediBuzz relays the person follows (from `following`). */
export async function relayFollows(userId: string, token: string, handle: string | null | undefined): Promise<RelayFollows> {
  const f = await following(userId, token, handle);
  return { relays: f.accts.flatMap(a => { const r = relayFromAcct(a); return r ? [r] : []; }), complete: f.complete };
}

/**
 * Follows (or unfollows) a hashtag's relay from the person's Fedizen account, once FediBuzz's WebFinger confirms the
 * handle is that relay. 'none' when it isn't followed afterwards; 'failed' when it couldn't be changed.
 */
export async function followRelay(token: string, relay: TagRelay, on: boolean): Promise<'following' | 'requested' | 'none' | 'failed'> {
  if ((await webfingerActor(relay.acct).catch(() => null)) !== relay.actor) return 'failed';
  const found = await fedizenGet(token, `/api/v1/accounts/lookup?acct=${encodeURIComponent(relay.acct)}`).catch(() => null);
  const id = found?.status === 200 ? (found.data[0] as { id?: string } | undefined)?.id : undefined;
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return on ? 'failed' : 'none';
  const r = await fedizenSend(token, 'POST', `/api/v1/accounts/${id}/${on ? 'follow' : 'unfollow'}`).catch(() => null);
  if (!r || r.status < 200 || r.status >= 300) return 'failed';
  const rel = r.data as { following?: boolean | null; requested?: boolean | null } | null;
  return rel?.following ? 'following' : rel?.requested ? 'requested' : on ? 'requested' : 'none';
}

/** The relays for followed hashtags that aren't followed yet (only tags FediBuzz names exactly), at most `max`. */
export function missingTagRelays(followedTags: string[], follows: RelayFollows, max = 10): TagRelay[] {
  const have = new Set(follows.relays.filter(r => r.kind === 'tag').map(r => r.value));
  const out: TagRelay[] = [];
  for (const t of followedTags) {
    const relay = tagRelay(t);
    if (relay && !have.has(relay.key) && !out.some(o => o.key === relay.key)) out.push(relay);
    if (out.length >= max) break;
  }
  return out;
}

/* ── Other spellings of a followed hashtag (src/lib/tag-variants.ts) ─────────────────────────────────────────────── */

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const variantDeps = {
  db: async (): Promise<Db> => (await import('@/integrations/supabase/client.server')).supabaseAdmin as unknown as Db,
  /** Recent public posts with the tag, as text: the person's Fedizen tag feed and mastodon.social's public one. */
  samples: async (token: string, tag: string): Promise<string[]> => {
    const { htmlToParagraphs } = await import('./spotlight');
    const text = (list: unknown) => (Array.isArray(list) ? list : []).map(s => htmlToParagraphs(String((s as { content?: unknown })?.content ?? '')).join('\n'));
    const [own, pub] = await Promise.all([
      fedizenGet(token, `/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=20`).then(r => (r.status === 200 ? text(r.data) : [])).catch(() => []),
      fetch(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`, { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(6000) })
        .then(async r => (r.ok ? text(await r.json()) : [])).catch(() => []),
    ]);
    return [...own, ...pub];
  },
};
const VARIANTS = 'atlas_tag_variants';

/** Each followed hashtag's spellings Atlas follows for it (tag → spellings). Empty when the table can't be read. */
export async function storedVariants(userId: string): Promise<Map<string, string[]>> {
  try {
    const db = await variantDeps.db();
    const { data, error } = await db.from(VARIANTS).select('tag, variants').eq('user_id', userId);
    if (error || !Array.isArray(data)) return new Map();
    return new Map((data as { tag: string; variants: string[] }[]).map(r => [r.tag, Array.isArray(r.variants) ? r.variants : []]));
  } catch { return new Map(); }
}

/** Whether another followed hashtag brings `tag` in as one of its spellings (so its relay must stay). */
export async function neededAsSpelling(userId: string, tag: string): Promise<boolean> {
  const key = tag.toLowerCase();
  for (const [t, vs] of await storedVariants(userId)) if (t !== key && vs.includes(key)) return true;
  return false;
}

async function saveVariants(userId: string, tag: string, variants: string[]) {
  const db = await variantDeps.db();
  await db.from(VARIANTS).upsert({ user_id: userId, tag, variants, updated_at: new Date().toISOString() });
}
async function dropVariants(userId: string, tag: string) {
  const db = await variantDeps.db();
  await db.from(VARIANTS).delete().eq('user_id', userId).eq('tag', tag);
}

/**
 * Following `tag`: finds its other spellings in recent public posts and follows their relays too, then keeps the list.
 * Returns the spellings followed. Best effort: nothing here can undo the hashtag follow itself.
 */
export async function followSpellings(userId: string, token: string, tag: string): Promise<string[]> {
  const { findSpellings } = await import('./tag-variants');
  const key = tag.toLowerCase();
  const found = findSpellings(key, await variantDeps.samples(token, key).catch(() => []), tag);
  const followedRelays: string[] = [];
  for (const v of found) {
    const relay = tagRelay(v);
    if (!relay) continue;
    const state = await followRelay(token, relay, true).catch(() => 'failed' as const);
    if (state === 'following' || state === 'requested') followedRelays.push(v);
  }
  await saveVariants(userId, key, followedRelays).catch(() => undefined);
  return followedRelays;
}

/**
 * Unfollowing `tag`: unfollows the relays of its spellings, except any another followed hashtag still brings in or
 * the person follows as a hashtag of its own, and forgets the list.
 */
export async function unfollowSpellings(userId: string, token: string, tag: string, followedTags: string[]) {
  const key = tag.toLowerCase();
  const all = await storedVariants(userId);
  const mine = all.get(key) ?? [];
  const keep = new Set([...followedTags.map(t => t.toLowerCase()), ...[...all.entries()].filter(([t]) => t !== key).flatMap(([, v]) => v)]);
  for (const v of mine) {
    if (keep.has(v)) continue;
    const relay = tagRelay(v);
    if (relay) await followRelay(token, relay, false).catch(() => 'failed');
  }
  await dropVariants(userId, key).catch(() => undefined);
}
