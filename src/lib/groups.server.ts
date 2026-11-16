import { FEDIZEN_USER_AGENT } from './fedizen-http';
/**
 * Groups — public reads from Fedizen's Bonfire GraphQL API (v1.1.0-rc.1). No sign-in: Bonfire applies each
 * group's boundaries for an anonymous reader, so hidden groups and members-only posts are never returned.
 * Membership (join, leave, follow, and whether you're in) goes through the person's own Fedizen connection:
 * Bonfire's `/api/v1-bonfire/groups/:id/join|leave` and, for announcement channels, Mastodon follow/unfollow.
 */
import { FEDIZEN } from './fedizen-feed';
import { fromBonfirePosts, type BonfireActivityNode } from './spotlight';
import { groupFromBonfire, groupsFromBonfire, membershipFrom, problemFromStatus, type Group, type GroupAction, type GroupPost, type Membership, type MembershipProblem } from './groups';
import { hasScope } from './fedizen-feed';

const GRAPHQL = `${FEDIZEN}/api/graphql`;
const GROUP_FIELDS = 'id name summary type membersCount isDisabled parentCategoryId boundaries{key slug} character{username canonicalUri} profile{name summary icon image}';
// Measured on fedizen.net (rc.1, 817 categories): `boundaries` and `membersCount` are the slow fields (~1 s and ~0.5 s per
// 100), so the topic lookup skips them. Bonfire caps `limit` at 100 (more is a 500), so the directory pages by cursor.
const TOPIC_FIELDS = 'id name summary type isDisabled parentCategoryId character{username canonicalUri} profile{name icon}';
const PAGE = 100;
const MAX_PAGES = 30;
// Activity subjects can be a User or a Category (a group boosting a post into its feed, FEP-1b12).
const ACTOR = '... on User{character{username canonicalUri} profile{name icon}} ... on Category{character{username canonicalUri} profile{name icon}}';
const FEED = `query($subjects:[String]){feedActivities(first:20,filter:{feedName:"known_groups",subjects:$subjects}){edges{node{id date canonicalUri verb{verb} objectPostContent{name summary htmlBody} subject{${ACTOR}} media{url mediaType} object{... on Post{id creator{${ACTOR}}}}}}}}`;

export const net: { fetch?: typeof fetch } = {};

type GqlResult<T> = { data?: T; errors?: { message?: string }[] };
async function gqlRaw<T>(query: string, variables: Record<string, unknown> = {}): Promise<GqlResult<T> | null> {
  try {
    const res = await (net.fetch ?? fetch)(GRAPHQL, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`Fedizen groups request failed [${res.status}]`); return null; }
    return await res.json() as GqlResult<T>;
  } catch (e) { console.error('Fedizen groups fetch error', e); return null; }
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await (net.fetch ?? fetch)(GRAPHQL, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': FEDIZEN_USER_AGENT },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`Fedizen groups request failed [${res.status}]`); return null; }
    const json = await res.json() as { data?: T; errors?: unknown };
    if (json.errors || !json.data) { console.error('Fedizen groups GraphQL error', JSON.stringify(json.errors).slice(0, 500)); return null; }
    return json.data;
  } catch (e) { console.error('Fedizen groups fetch error', e); return null; }
}

/** Posts reach a group through the group's boost, so the booster is the group, not a person who boosted. */
/** Bonfire's REST API knows a post by its object id (the same ULID), so group posts can be liked, boosted,
 *  saved and replied to like any other. */
const groupPosts = (nodes: BonfireActivityNode[]): GroupPost[] => {
  const objectOf = new Map(nodes.map(n => [n.id, n.object?.id ?? n.id]));
  return fromBonfirePosts(nodes).map(({ boostedBy, ...p }) => {
    const objectId = objectOf.get(p.id);
    return { ...p, group: boostedBy, ...(objectId && /^[A-Za-z0-9_-]{1,64}$/.test(objectId) ? { objectId } : {}) };
  });
};

/** Group posts that keep every group a post was boosted into: the shared mapping shows each post once, under its
 *  first booster, so the others are gathered here first. */
function withEveryGroup(nodes: BonfireActivityNode[]): GroupPost[] {
  const groupsOf = new Map<string, string[]>(), keyOfFirst = new Map<string, string>();
  for (const raw of nodes) {
    const key = raw.object?.id ?? raw.id;
    if (!groupsOf.has(key)) { groupsOf.set(key, []); keyOfFirst.set(raw.id, key); }
    const boost = raw.verb?.verb === 'Boost' || raw.verb?.verb === 'Announce';
    const name = boost ? (raw.subject?.profile?.name || raw.subject?.character?.username) : undefined;
    const list = groupsOf.get(key)!;
    if (name && !list.includes(name)) list.push(name);
  }
  return groupPosts(nodes).map(p => {
    const all = groupsOf.get(keyOfFirst.get(p.id) ?? '') ?? [];
    return all.length ? { ...p, groups: all } : p;
  });
}

type Page = { categories?: { pageInfo?: { endCursor?: string | null; hasNextPage?: boolean }; edges?: unknown[] } };
const PAGE_QUERY = (fields: string) => `query($after:[Cursor!]){categories(limit:${PAGE},after:$after){pageInfo{endCursor hasNextPage} edges{${fields}}}}`;
const cursorOk = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c);

/** One page of the groups Fedizen knows (its own and those mirrored from other servers), newest first. */
export async function listGroups(after?: string): Promise<{ groups: Group[]; next: string | null } | null> {
  const d = await gql<Page>(PAGE_QUERY(GROUP_FIELDS), { after: after ? [after] : null });
  if (!d?.categories) return null;
  const info = d.categories.pageInfo;
  return { groups: groupsFromBonfire(d.categories.edges), next: info?.hasNextPage && cursorOk(info.endCursor) ? info.endCursor : null };
}

/** A group's topics: every category whose parent it is, read with the fast fields only. */
async function topicsOf(id: string): Promise<Group[]> {
  const out: Group[] = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const d: Page | null = await gql<Page>(PAGE_QUERY(TOPIC_FIELDS), { after: after ? [after] : null });
    if (!d?.categories) break;
    out.push(...groupsFromBonfire(d.categories.edges).filter(g => g.parentId === id));
    const info: { endCursor?: string | null; hasNextPage?: boolean } | undefined = d.categories.pageInfo;
    after = info?.hasNextPage && cursorOk(info.endCursor) ? info.endCursor : null;
    if (!after) break;
  }
  return out;
}

/** One group, its topics, and its latest posts (with `postsError` when only the posts couldn't be read); 'not-found' when Fedizen has no such group you can see, null when Fedizen can't be read. */
export async function getGroup(id: string): Promise<{ group: Group; topics: Group[]; posts: GroupPost[]; postsError?: 'unavailable' } | 'not-found' | null> {
  const [one, topics, feed] = await Promise.all([
    gqlRaw<{ category?: unknown }>(`query($id:ID){category(categoryId:$id){${GROUP_FIELDS}}}`, { id }),
    topicsOf(id),
    gql<{ feedActivities?: { edges?: { node: BonfireActivityNode }[] } }>(FEED, { subjects: [id] }),
  ]);
  if (!one) return null;
  // Bonfire answers an unknown (or hidden) id with an error " Not Found." and a null category.
  if (one.errors?.some(e => /not found/i.test(e.message ?? ''))) return 'not-found';
  if (one.errors || !one.data) return null;
  const group = groupFromBonfire(one.data.category);
  if (!group) return 'not-found';
  return {
    group,
    topics,
    posts: groupPosts((feed?.feedActivities?.edges ?? []).map(e => e.node)),
    // A failed feed read is not an empty group: say so, so the page can offer a retry.
    ...(feed?.feedActivities ? {} : { postsError: 'unavailable' as const }),
  };
}

// Bonfire's "Top discussions" preset (bonfire_social runtime_config, :trending_discussions) is the most-replied
// activities of the last day; For You asks the same of the groups you're in, over a week so quiet groups count too.
const POPULAR = `query($subjects:[String]){feedActivities(first:20,filter:{feedName:"known_groups",subjects:$subjects,sortBy:REPLY_COUNT,sortOrder:DESC,timeLimit:7}){edges{node{id date canonicalUri verb{verb} objectPostContent{name summary htmlBody} subject{${ACTOR}} media{url mediaType} object{... on Post{id creator{${ACTOR}}}}}}}}`;

/**
 * The most-discussed posts of the past week in these groups, most replies first. Groups are asked about 50 at a time
 * (four queries at once); each batch's posts come back in reply order and are interleaved, so every batch's top post
 * ranks above any batch's second. `complete` is false when a batch couldn't be read; null when none could.
 */
export async function popularInGroups(ids: string[]): Promise<{ posts: GroupPost[]; complete: boolean } | null> {
  if (!ids.length) return { posts: [], complete: true };
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
  const lists: GroupPost[][] = [];
  let failed = 0;
  for (let i = 0; i < batches.length; i += 4) {
    const results = await Promise.all(batches.slice(i, i + 4).map(b =>
      gql<{ feedActivities?: { edges?: { node: BonfireActivityNode }[] } }>(POPULAR, { subjects: b }).catch(() => null)));
    for (const d of results) {
      if (!d?.feedActivities) { failed++; continue; }
      lists.push(withEveryGroup((d.feedActivities.edges ?? []).map(e => e.node)));
    }
  }
  if (failed === batches.length) return null;
  // Interleave, and when one post reached groups in different batches keep it once with all of them.
  const posts: GroupPost[] = [];
  const byUrl = new Map<string, GroupPost>();
  for (let k = 0; lists.some(l => k < l.length); k++) for (const l of lists) {
    if (k >= l.length) continue;
    const p = l[k], had = byUrl.get(p.url);
    if (had) { had.groups = [...new Set([...(had.groups ?? []), ...(p.groups ?? [])])]; continue; }
    byUrl.set(p.url, p); posts.push(p);
  }
  return { posts, complete: !failed };
}

/* Every group in the directory (public, the same for everyone), read page by page and kept briefly. */
let directory: { at: number; groups: Group[]; complete: boolean } | null = null;
const DIRECTORY_TTL = 10 * 60_000;
async function allGroups(): Promise<{ groups: Group[]; complete: boolean } | null> {
  if (directory && Date.now() - directory.at < DIRECTORY_TTL) return directory;
  const groups: Group[] = [];
  let after: string | undefined;
  let complete = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await listGroups(after);
    if (!page) { if (!i) return null; break; }
    groups.push(...page.groups.filter(g => g.type === 'group'));
    if (!page.next) { complete = true; break; }
    after = page.next;
  }
  directory = { at: Date.now(), groups, complete };
  return directory;
}

/* A person's memberships, kept briefly so each For You load doesn't re-check the whole directory. */
const joinedCache = new Map<string, { at: number; value: { groups: Group[]; complete: boolean } }>();
const JOINED_TTL = 5 * 60_000, JOINED_MAX = 500;

/**
 * The groups this person has joined. Bonfire's groups index has no member filter, so this walks the whole directory
 * and asks relationships about 40 groups at a time (four requests at once). `complete` is false when part of the
 * directory or of the membership checks couldn't be read; null when none of it could.
 */
export async function joinedGroups(userId: string): Promise<{ groups: Group[]; complete: boolean } | null> {
  const hit = joinedCache.get(userId);
  if (hit && Date.now() - hit.at < JOINED_TTL) return hit.value;
  const dir = await allGroups();
  if (!dir) return null;
  const batches: Group[][] = [];
  for (let i = 0; i < dir.groups.length; i += 40) batches.push(dir.groups.slice(i, i + 40));
  const joined: Group[] = [];
  let failed = 0;
  for (let i = 0; i < batches.length; i += 4) {
    const results = await Promise.all(batches.slice(i, i + 4).map(b => memberships(userId, b.map(g => g.id)).catch(() => null)));
    results.forEach((m, k) => {
      if (!m?.ok) { failed++; return; }
      joined.push(...batches[i + k].filter(g => m.memberships[g.id] === 'member'));
    });
  }
  if (batches.length && failed === batches.length) return null;
  const value = { groups: joined, complete: dir.complete && !failed };
  if (value.complete) {
    if (joinedCache.size >= JOINED_MAX) joinedCache.delete(joinedCache.keys().next().value as string);
    joinedCache.set(userId, { at: Date.now(), value });
  }
  return value;
}
/** Forget cached memberships (after joining or leaving a group, and in tests). */
export function forgetJoinedGroups(userId?: string) { if (userId) joinedCache.delete(userId); else { joinedCache.clear(); directory = null; } }

/** The latest posts across every group Fedizen knows (Bonfire's "All known groups" feed). */
export async function latestInGroups(): Promise<GroupPost[] | null> {
  const d = await gql<{ feedActivities?: { edges?: { node: BonfireActivityNode }[] } }>(FEED, { subjects: null });
  return d?.feedActivities ? groupPosts((d.feedActivities.edges ?? []).map(e => e.node)) : null;
}

/* ── Membership through the person's Fedizen connection ─────────────────────────────────────────── */

type Conn = { access_token: string; scope?: string | null } | null;
export const membershipNet: { token?: (userId: string) => Promise<Conn>; send?: typeof import('./fedizen.server').fedizenSend; get?: typeof import('./fedizen.server').fedizenGet } = {};
const fz = () => import('./fedizen.server');

/** Your membership of each group, from Fedizen's relationships (members follow their groups). */
export async function memberships(userId: string, ids: string[]): Promise<{ ok: true; memberships: Record<string, Membership> } | { ok: false; reason: MembershipProblem }> {
  const t = await (membershipNet.token ?? (await fz()).tokenFor)(userId);
  if (!t) return { ok: false, reason: 'not-connected' };
  const q = ids.map(id => `id%5B%5D=${encodeURIComponent(id)}`).join('&');
  const r = await (membershipNet.get ?? (await fz()).fedizenGet)(t.access_token, `/api/v1/accounts/relationships?${q}`);
  if (r.status !== 200) return { ok: false, reason: problemFromStatus(r.status) };
  const out: Record<string, Membership> = {};
  for (const rel of r.data) if (rel && typeof rel === 'object' && typeof (rel as { id?: unknown }).id === 'string') out[(rel as { id: string }).id] = membershipFrom(rel);
  return { ok: true, memberships: out };
}

/** Joins (or follows, for an announcement channel) or leaves a group as the signed-in person. */
export async function setMembership(userId: string, id: string, action: GroupAction, on: boolean): Promise<{ ok: true; membership: Membership } | { ok: false; reason: MembershipProblem }> {
  const t = await (membershipNet.token ?? (await fz()).tokenFor)(userId);
  if (!t) return { ok: false, reason: 'not-connected' };
  if (!hasScope(t.scope, 'write')) return { ok: false, reason: 'needs-permission' };
  const path = action === 'follow'
    ? `/api/v1/accounts/${encodeURIComponent(id)}/${on ? 'follow' : 'unfollow'}`
    : `/api/v1-bonfire/groups/${encodeURIComponent(id)}/${on ? 'join' : 'leave'}`;
  const r = await (membershipNet.send ?? (await fz()).fedizenSend)(t.access_token, 'POST', path);
  forgetJoinedGroups(userId);
  if (r.status < 200 || r.status >= 300) return { ok: false, reason: problemFromStatus(r.status) };
  return { ok: true, membership: membershipFrom(r.data) };
}
