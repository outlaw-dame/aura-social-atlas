import { fromBonfireArticles, fromBonfirePosts, type BonfireActivityNode } from './spotlight';
import { requestBonfireGraphQL } from './bonfire-graphql.server';
import type { RecentArticlesResult, PublicFeedResult } from './bonfire.functions';

/**
 * The public feed operation remains a candidate contract until the actual
 * installed Fedizen GraphQL schema has been captured (Phase A).
 */
type PublicFeedName = 'local' | 'articles';
const FEED_QUERY = (feed: PublicFeedName) =>
  `{feedActivities(first:20,filter:{feedName:"${feed}"}){edges{node{id date canonicalUri verb{verb} boostCount likeCount repliesCount objectPostContent{name summary htmlBody} subject{... on User{character{username canonicalUri} profile{name icon}}} media{url mediaType} object{... on Post{id creator{... on User{character{username canonicalUri} profile{name icon}}}}}}}}}`;

function validatePublicFeed(data: unknown): BonfireActivityNode[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid GraphQL data');
  const feed = (data as Record<string, unknown>).feedActivities;
  if (!feed || typeof feed !== 'object' || Array.isArray(feed)) throw new Error('Invalid feed');
  const edges = (feed as Record<string, unknown>).edges;
  if (!Array.isArray(edges) || !edges.every(e =>
    e && typeof e === 'object' && e.node && typeof e.node === 'object' &&
    typeof e.node.id === 'string')) throw new Error('Invalid feed edges');
  return edges.map(e => e.node as BonfireActivityNode);
}

async function readPublicFeed(name: PublicFeedName): Promise<BonfireActivityNode[] | null> {
  try {
    return await requestBonfireGraphQL({
      operation: 'query',
      document: FEED_QUERY(name),
      validate: validatePublicFeed,
    });
  } catch {
    console.error('Bonfire public feed unavailable', { feed: name });
    return null;
  }
}

export async function fetchPublicFeed(): Promise<PublicFeedResult> {
  const nodes = await readPublicFeed('local');
  return nodes ? { posts: fromBonfirePosts(nodes) } : { posts: [], error: 'unavailable' };
}

export async function fetchRecentArticles(): Promise<RecentArticlesResult> {
  const nodes = await readPublicFeed('articles');
  return nodes ? { articles: fromBonfireArticles(nodes) } : { articles: [], error: 'unavailable' };
}
