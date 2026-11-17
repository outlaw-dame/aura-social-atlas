import { actorFromWebfinger, isPublicHttpsUrl, normalizeHost, parseHandle } from './article-author';
import { PODCAST_ACCEPT, dohLookup, fetchActor, safeFetch, type Lookup } from './article-author.server';
import { claimedAcct, cleanText, podcastDetails, postsFromOutbox, profileFromActor, type FediProfile, type FediProfileTarget } from './fedi-profile';
import { htmlToParagraphs } from './spotlight';
import { mfmSourceOf, mfmToRich } from './mfm';

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

/**
 * The budget covers the whole load, discovery included: past it the dialog gets null (it says the profile couldn't
 * load) while the load carries on and caches its result, so opening it again is instant.
 */
export async function loadFediProfile(target: FediProfileTarget, budgetMs = 4000, f: FetchLike = fetch, l: Lookup = dohLookup): Promise<FediProfile | null> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(r => { timer = setTimeout(() => r(null), budgetMs); });
  try {
    return await Promise.race([build(target, () => Math.max(0, budgetMs - (Date.now() - started)), f, l).catch(() => null), deadline]);
  } finally { clearTimeout(timer); }
}

async function build(target: FediProfileTarget, remaining: () => number, f: FetchLike, l: Lookup): Promise<FediProfile | null> {
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
  if (!actor || !actorId || !base) {
    // Many Mastodon servers answer actor documents only to signed requests ("authorized fetch"), which Atlas doesn't
    // make. Their public Mastodon API still answers, from the same origin server: read the profile there.
    const viaApi = await profileFromMastodonApi(target, f, l).catch(() => null);
    if (viaApi) { remember(viaApi.actor, viaApi); if (target.actor && target.actor !== viaApi.actor) remember(target.actor, viaApi); return viaApi; }
    if (actorId) remember(actorId, null);
    return null;
  }
  const id = base.actor;
  const link = (k: string) => { const v = actor[k]; const u = typeof v === 'string' ? v : isObj(v) ? String(v.id ?? '') : ''; return isPublicHttpsUrl(u) && sameHost(u, id) ? u : undefined; };

  const profile: FediProfile = { ...base, acctVerified: false, posts: [] };
  const work = Promise.all([
    // The handle is theirs only if their handle's server points WebFinger back at this actor.
    (async () => { const a = claimedAcct(actor); profile.acctVerified = !!a && (await webfingerActor(a, f, l)) === id; })(),
    // Castopod tells a podcast from a person only when asked for its podcast view.
    (async () => {
      const pod = podcastDetails(await getJson(id, PODCAST_ACCEPT, f, l), id);
      if (pod) { profile.kind = 'podcast'; profile.podcast = pod; }
    })(),
    ...(['followers', 'following'] as const).map(async k => {
      const u = link(k); if (!u) return;
      const c = await getJson(u, AP, f, l);
      if (isObj(c) && typeof c.totalItems === 'number' && c.totalItems >= 0) profile[k] = Math.floor(c.totalItems);
    }),
    // Bonfire's actor carries no `image` (its banner isn't federated), but its Mastodon API has it as `header`.
    // Asked only of the actor's own server, and kept only if that account is this actor.
    (async () => {
      if (profile.header) return;
      const header = await bannerFromMastodonApi(actor, id, f, l);
      if (header) profile.header = header;
    })(),
    (async () => {
      const u = link('outbox'); if (!u) { profile.postsHidden = true; return; }
      const box = await getJson(u, AP, f, l);
      if (!isObj(box)) { profile.postsHidden = true; return; }
      if (typeof box.totalItems === 'number' && box.totalItems >= 0) profile.postCount = Math.floor(box.totalItems);
      let page: unknown = box.orderedItems || box.items ? box : box.first;
      if (typeof page === 'string') page = isPublicHttpsUrl(page) && sameHost(page, id) ? await getJson(page, AP, f, l) : null;
      // PeerTube's outbox refers to its videos by URL (a Create of its own, an Announce of a channel's), so fetch the
      // newest few from this same server and read them as if they were embedded.
      if (isObj(page)) page = await withReferencedObjects(page, id, f, l);
      profile.posts = postsFromOutbox(page, id, 10, o => { const src = mfmSourceOf(o); return src ? mfmToRich(src) : undefined; });
      if (!profile.posts.length && !isObj(page)) profile.postsHidden = true;
    })(),
  ].map(p => p.catch(() => undefined)));
  // Whatever misses the budget still lands in the cache when it finishes, for the next open.
  void work.then(() => { const full = { ...profile, posts: [...profile.posts] }; remember(id, full); if (id !== actorId) remember(actorId, full); });
  await Promise.race([work, new Promise(r => setTimeout(r, remaining()))]);
  const done = { ...profile, posts: [...profile.posts] };
  remember(id, done);
  if (id !== actorId) remember(actorId, done);
  return done;
}

/** An actor's banner from its own server's Mastodon API (`/api/v1/accounts/lookup`), when its actor lacks one. The
 *  account must be this actor: its id is the actor id's last segment (Bonfire) or its url/uri is the actor id. */
export async function bannerFromMastodonApi(actor: Record<string, unknown>, id: string, f: FetchLike, l: Lookup): Promise<string | undefined> {
  const user = typeof actor.preferredUsername === 'string' ? actor.preferredUsername.replace(/^@/, '') : '';
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(user)) return undefined;
  const host = new URL(id).host;
  const a = await getJson(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`, 'application/json', f, l);
  if (!isObj(a)) return undefined;
  const last = new URL(id).pathname.split('/').filter(Boolean).pop();
  const same = (typeof a.id === 'string' && a.id === last) || a.uri === id || a.url === id;
  const header = typeof a.header === 'string' ? a.header : undefined;
  return same && header && isPublicHttpsUrl(header) && header.length <= 2048 && !/\/missing\.png$/.test(header) ? header : undefined;
}

type MastoAccount = {
  id?: unknown; username?: unknown; acct?: unknown; display_name?: unknown; url?: unknown; uri?: unknown; avatar?: unknown; header?: unknown;
  note?: unknown; fields?: unknown; created_at?: unknown; followers_count?: unknown; following_count?: unknown; statuses_count?: unknown;
  bot?: unknown; group?: unknown; locked?: unknown;
};
type MastoStatus = {
  id?: unknown; url?: unknown; uri?: unknown; created_at?: unknown; content?: unknown; spoiler_text?: unknown; sensitive?: unknown;
  visibility?: unknown; reblog?: unknown; media_attachments?: { type?: unknown; preview_url?: unknown }[];
};
const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
const picture = (v: unknown) => { const u = s(v); return u && isPublicHttpsUrl(u) && u.length <= 2048 && !/\/missing\.png$/.test(u) ? u : undefined; };

/**
 * A profile from its own server's public Mastodon API (`/api/v1/accounts/lookup`, then its public posts), for servers
 * that won't hand an unsigned request the actor document. Only the server the handle (or actor) names is asked, and
 * an account it returns must be the one asked for: its uri/url is the actor we were given, or its handle is the one
 * we asked about. The handle counts as verified only if WebFinger agrees, as for any profile.
 */
export async function profileFromMastodonApi(target: FediProfileTarget, f: FetchLike, l: Lookup): Promise<FediProfile | null> {
  const handle = parseHandle(target.acct);
  let host = handle?.split('@')[1], user = handle?.split('@')[0];
  if (!host && isPublicHttpsUrl(target.actor)) {
    const u = new URL(target.actor);
    const m = /^\/(?:users|@)\/?([A-Za-z0-9_.-]{1,64})\/?$/.exec(u.pathname);
    if (m) { host = u.host; user = m[1]; }
  }
  if (!host || !user) return null;
  const tryHosts = [host];
  // A handle's domain may delegate to another server (example.com → social.example.com): ask the actor's host too.
  if (isPublicHttpsUrl(target.actor) && new URL(target.actor).host !== host) tryHosts.push(new URL(target.actor).host);
  for (const h of tryHosts) {
    const a = await getJson(`https://${h}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`, 'application/json', f, l) as MastoAccount | null;
    if (!isObj(a) || !s(a.id)) continue;
    const actor = s(a.uri) && isPublicHttpsUrl(s(a.uri)) ? s(a.uri)! : s(a.url) && isPublicHttpsUrl(s(a.url)) ? s(a.url)! : undefined;
    if (!actor || new URL(actor).host !== h) continue;
    const sameActor = !target.actor || target.actor === actor || target.actor === s(a.url);
    const sameUser = (s(a.username) ?? '').toLowerCase() === user.toLowerCase();
    if (!sameActor || !sameUser) continue;
    const acct = handle ?? `${user}@${h}`;
    const name = cleanText(s(a.display_name) ?? '', 80) || cleanText(s(a.username) ?? '', 64);
    const created = s(a.created_at);
    const fields = (Array.isArray(a.fields) ? a.fields : []).filter(isObj)
      .map(x => ({ name: cleanText(s(x.name) ?? '', 60), value: cleanText(htmlToParagraphs(s(x.value) ?? '').join(' '), 200) }))
      .filter(x => x.name && x.value).slice(0, 8);
    const [verified, statuses] = await Promise.all([
      webfingerActor(acct, f, l).then(id => id === actor).catch(() => false),
      getJson(`https://${h}/api/v1/accounts/${encodeURIComponent(s(a.id)!)}/statuses?limit=10&exclude_reblogs=true`, 'application/json', f, l).catch(() => null),
    ]);
    const posts = (Array.isArray(statuses) ? statuses as MastoStatus[] : []).filter(isObj)
      .filter(p => !p.reblog && (p.visibility === 'public' || p.visibility === 'unlisted'))
      .flatMap(p => {
        const url = s(p.url) ?? s(p.uri);
        if (!s(p.id) || !url || !isPublicHttpsUrl(url)) return [];
        const paragraphs = htmlToParagraphs(s(p.content) ?? '').map(t => cleanText(t, 1200)).filter(Boolean);
        const image = ((Array.isArray(p.media_attachments) ? p.media_attachments : []) as { type?: unknown; preview_url?: unknown }[]).filter(m => m.type === 'image').map(m => picture(m.preview_url)).find(Boolean);
        const cw = cleanText(s(p.spoiler_text) ?? '', 300);
        if (!paragraphs.length && !image) return [];
        return [{ id: s(p.id)!, url, ...(s(p.created_at) ? { date: s(p.created_at) } : {}), paragraphs, ...(cw ? { cw } : {}), ...(image ? { image } : {}), ...(p.sensitive === true && image ? { sensitive: true } : {}) }];
      }).slice(0, 10);
    return {
      actor, acct: `@${acct}`, acctVerified: verified, url: s(a.url) && isPublicHttpsUrl(s(a.url)) ? s(a.url)! : actor, host: normalizeHost(h), name: name || user,
      ...(picture(a.avatar) ? { avatar: picture(a.avatar) } : {}), ...(picture(a.header) ? { header: picture(a.header) } : {}),
      bio: htmlToParagraphs(s(a.note) ?? '').map(t => cleanText(t, 600)).filter(Boolean).slice(0, 8),
      fields, ...(created && !Number.isNaN(Date.parse(created)) ? { joined: created } : {}),
      followers: n(a.followers_count), following: n(a.following_count), postCount: n(a.statuses_count),
      kind: a.group === true ? 'group' : a.bot === true ? 'bot' : 'person', locked: a.locked === true,
      posts, ...(Array.isArray(statuses) ? {} : { postsHidden: true }),
    };
  }
  return null;
}

async function withReferencedObjects(page: Record<string, unknown>, actorId: string, f: FetchLike, l: Lookup): Promise<Record<string, unknown>> {
  const items = (Array.isArray(page.orderedItems) ? page.orderedItems : Array.isArray(page.items) ? page.items : []) as unknown[];
  const refs = items.slice(0, 8).filter(isObj).filter(i => ['Create', 'Announce'].includes(String(i.type)) && typeof i.object === 'string' && isPublicHttpsUrl(i.object) && sameHost(i.object, actorId));
  if (!refs.length) return page;
  const objects = await Promise.all(refs.slice(0, 6).map(i => getJson(i.object as string, AP, f, l)));
  const resolved = objects
    .map((o, k) => (isObj(o) && o.id === refs[k].object ? { type: 'Create', to: o.to, cc: o.cc, object: o } : null))
    .filter(Boolean);
  return { ...page, orderedItems: [...resolved, ...items.filter(i => !refs.includes(i as never))] };
}

function remember(key: string, profile: FediProfile | null) {
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), profile });
}
export function _clearFediProfileCache() { cache.clear(); }
