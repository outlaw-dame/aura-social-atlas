import { fromBonfireArticles, fromBonfirePosts, type BonfireActivityNode } from './spotlight';
import type { RecentArticlesResult, PublicFeedResult } from './bonfire.functions';

/**
 * This public, anonymous read path remains candidate-schema based until the
 * operator captures Fedizen's deployed GraphQL contract (Phase A).
 * No authentication or private data should pass through this function.
 */
type PublicFeedName = 'local' | 'articles';
const ENDPOINT = 'https://fedizen.net/api/graphql';
const FEED_QUERY = (feed: PublicFeedName) =>
  `{feedActivities(first:20,filter:{feedName:"${feed}"}){edges{node{id date canonicalUri verb{verb} boostCount likeCount repliesCount objectPostContent{name summary htmlBody} subject{... on User{character{username canonicalUri} profile{name icon}}} media{url mediaType} object{... on Post{id creator{... on User{character{username canonicalUri} profile{name icon}}}}}}}}}`;

type GraphQLFeedResponse = {
  data?: { feedActivities?: { edges?: Array<{ node: BonfireActivityNode }> } | null } | null;
  errors?: unknown;
};

async function readPublicFeed(name: PublicFeedName): Promise<BonfireActivityNode[] | null> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: FEED_QUERY(name) }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      console.error('Bonfire public feed HTTP failure', { feed: name, status: response.status });
      return null;
    }
    const payload = await response.json() as GraphQLFeedResponse;
    // GraphQL can return HTTP 200 with partial data + errors. Fail closed so
    // callers never confuse an incomplete response with a complete timeline.
    if (payload.errors != null || !payload.data?.feedActivities ||
      !Array.isArray(payload.data.feedActivities.edges) ||
      !payload.data.feedActivities.edges.every(e => e && e.node && typeof e.node.id === 'string')) {
      console.error('Bonfire public feed invalid GraphQL result', { feed: name });
      return null;
    }
    return payload.data.feedActivities.edges.map(e => e.node);
  } catch {
    // Never log network errors containing request data or unexpected remote text.
    console.error('Bonfire public feed request failed', { feed: name });
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
