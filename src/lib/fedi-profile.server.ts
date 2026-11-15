import { actorFromWebfinger, isPublicHttpsUrl, normalizeHost, parseHandle } from './article-author';
import { dohLookup, fetchActor, safeFetch, type Lookup } from './article-author.server';
import { claimedAcct, postsFromOutbox, profileFromActor, type FediProfile, type FediProfileTarget } from './fedi-profile';

/**
 * Reads a fediverse account for Atlas's own profile view: the actor from its server (never a copy someone else
 * embedded), its handle confirmed through WebFinger, follower counts and the newest public posts from its outbox.
 * Every request goes through safeFetch (public https only, every hop's address checked, redirects re-validated,
 * timeout and size cap); the whole read has a time budget, and what misses it is simply left out.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const AP = 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
const JRD = 'application/jrd+json, application/json';
const json = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function getJson(url: string, accept: string, f: FetchLike, l: Lookup): Promise<unknown> {
  const r = await safeFetch(url, accept, f, l);
  return r && r.type.includes('json') ? json(r.text) : null;
}
/** Same host only: a server answers for its own collections, not someone else's. */
const sameHost = (a: string, b: string) => normalizeHost(new URL(a).hostname) === normalizeHost(new URL(b).hostname);

export async function webfingerActor(acct: string, f: FetchLike = fetch, l: Lookup = dohLookup): Promise<string | null> {
  const h = parseHandle(acct);
  if (!h) return null;
  return actorFromWebfinger(await getJson(`https://${h.split('@')[1]}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${h}`)}`, JRD, f, l));
}

const cache = new Map<string, { at: number; profile: FediProfile | null }>();
const TTL = 10 * 60_000, MISS_TTL = 60_000, MAX = 300;

export async function loadFediProfile(target: FediProfileTarget, budgetMs = 4000, f: FetchLike = fetch, l: Lookup = dohLookup): Promise<FediProfile | null> {
  // A profile link that isn't an actor document (some servers only serve HTML there) falls back to the handle.
  const candidates = [isPublicHttpsUrl(target.actor) ? target.actor : null, target.acct ? 'acct' : null].filter(Boolean) as string[];
  let actorId: string | null = null;
  let actor: Awaited<ReturnType<typeof fetchActor>> = null;
  for (const c of candidates) {
    const id = c === 'acct' ? await webfingerActor(target.acct!, f, l) : c;
    if (!id) continue;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < (hit.profile ? TTL : MISS_TTL)) { if (hit.profile) return hit.profile; continue; }
    actor = await fetchActor(id, f, l);
    if (actor) { actorId = id; break; }
    remember(id, null);
  }
  const base = actor && profileFromActor(actor);
  if (!actor || !actorId || !base) { if (actorId) remember(actorId, null); return null; }
  const id = base.actor;
  const link = (k: string) => { const v = actor[k]; const u = typeof v === 'string' ? v : isObj(v) ? String(v.id ?? '') : ''; return isPublicHttpsUrl(u) && sameHost(u, id) ? u : undefined; };

  const profile: FediProfile = { ...base, acctVerified: false, posts: [] };
  const work = Promise.all([
    // The handle is theirs only if their handle's server points WebFinger back at this actor.
    (async () => { const a = claimedAcct(actor); profile.acctVerified = !!a && (await webfingerActor(a, f, l)) === id; })(),
    ...(['followers', 'following'] as const).map(async k => {
      const u = link(k); if (!u) return;
      const c = await getJson(u, AP, f, l);
      if (isObj(c) && typeof c.totalItems === 'number' && c.totalItems >= 0) profile[k] = Math.floor(c.totalItems);
    }),
    (async () => {
      const u = link('outbox'); if (!u) { profile.postsHidden = true; return; }
      const box = await getJson(u, AP, f, l);
      if (!isObj(box)) { profile.postsHidden = true; return; }
      if (typeof box.totalItems === 'number' && box.totalItems >= 0) profile.postCount = Math.floor(box.totalItems);
      let page: unknown = box.orderedItems || box.items ? box : box.first;
      if (typeof page === 'string') page = isPublicHttpsUrl(page) && sameHost(page, id) ? await getJson(page, AP, f, l) : null;
      profile.posts = postsFromOutbox(page, id);
      if (!profile.posts.length && !isObj(page)) profile.postsHidden = true;
    })(),
  ].map(p => p.catch(() => undefined)));
  // Whatever misses the budget still lands in the cache when it finishes, for the next open.
  void work.then(() => { const full = { ...profile, posts: [...profile.posts] }; remember(id, full); if (id !== actorId) remember(actorId, full); });
  await Promise.race([work, new Promise(r => setTimeout(r, budgetMs))]);
  const done = { ...profile, posts: [...profile.posts] };
  remember(id, done);
  if (id !== actorId) remember(actorId, done);
  return done;
}

function remember(key: string, profile: FediProfile | null) {
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), profile });
}
export function _clearFediProfileCache() { cache.clear(); }
