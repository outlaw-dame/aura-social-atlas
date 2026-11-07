/**
 * Groups — public reads from Fedizen's Bonfire GraphQL API (v1.1.0-rc.1). No sign-in: Bonfire applies each
 * group's boundaries for an anonymous reader, so hidden groups and members-only posts are never returned.
 * Joining, posting and moderating happen on Fedizen (Atlas's Fedizen permission is read-only).
 */
import { FEDIZEN } from './fedizen-feed';
import { fromBonfirePosts, type BonfireActivityNode } from './spotlight';
import { groupFromBonfire, groupsFromBonfire, type Group, type GroupPost } from './groups';

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
