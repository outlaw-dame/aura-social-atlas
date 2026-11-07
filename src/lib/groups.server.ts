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
// Activity subjects can be a User or a Category (a group boosting a post into its feed, FEP-1b12).
const ACTOR = '... on User{character{username canonicalUri} profile{name icon}} ... on Category{character{username canonicalUri} profile{name icon}}';
const FEED = `query($subjects:[String]){feedActivities(first:20,filter:{feedName:"known_groups",subjects:$subjects}){edges{node{id date canonicalUri verb{verb} objectPostContent{name summary htmlBody} subject{${ACTOR}} media{url mediaType} object{... on Post{id creator{${ACTOR}}}}}}}}`;

export const net: { fetch?: typeof fetch } = {};

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await (net.fetch ?? fetch)(GRAPHQL, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`Fedizen groups request failed [${res.status}]`); return null; }
    const json = await res.json() as { data?: T; errors?: unknown };
    if (json.errors || !json.data) { console.error('Fedizen groups GraphQL error', JSON.stringify(json.errors).slice(0, 500)); return null; }
    return json.data;
  } catch (e) { console.error('Fedizen groups fetch error', e); return null; }
}

/** Posts reach a group through the group's boost, so the booster is the group, not a person who boosted. */
const groupPosts = (nodes: BonfireActivityNode[]): GroupPost[] =>
  fromBonfirePosts(nodes).map(({ boostedBy, ...p }) => ({ ...p, group: boostedBy }));

/** Every group and topic Fedizen knows (its own and those mirrored from other servers). */
export async function listGroups(): Promise<Group[] | null> {
  const d = await gql<{ categories?: { edges?: unknown[] } }>(`{categories(limit:100){edges{${GROUP_FIELDS}}}}`);
  return d?.categories ? groupsFromBonfire(d.categories.edges) : null;
}

/** One group, its topics, and its latest posts (with `postsError` when only the posts couldn't be read); 'not-found' when Fedizen has no such group you can see, null when Fedizen can't be read. */
export async function getGroup(id: string): Promise<{ group: Group; topics: Group[]; posts: GroupPost[]; postsError?: 'unavailable' } | 'not-found' | null> {
  const [one, all, feed] = await Promise.all([
    gql<{ category?: unknown }>(`query($id:ID){category(categoryId:$id){${GROUP_FIELDS}}}`, { id }),
    listGroups(),
    gql<{ feedActivities?: { edges?: { node: BonfireActivityNode }[] } }>(FEED, { subjects: [id] }),
  ]);
  if (!one) return null;
  const group = groupFromBonfire(one.category);
  if (!group) return 'not-found';
  return {
    group,
    topics: (all ?? []).filter(g => g.parentId === id),
    posts: groupPosts((feed?.feedActivities?.edges ?? []).map(e => e.node)),
    // A failed feed read is not an empty group: say so, so the page can offer a retry.
    ...(feed?.feedActivities ? {} : { postsError: 'unavailable' as const }),
  };
}

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
  const q = ids.map(id => `id[]=${encodeURIComponent(id)}`).join('&');
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
  if (r.status < 200 || r.status >= 300) return { ok: false, reason: problemFromStatus(r.status) };
  return { ok: true, membership: membershipFrom(r.data) };
}
