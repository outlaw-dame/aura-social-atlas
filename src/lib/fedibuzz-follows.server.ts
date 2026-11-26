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
