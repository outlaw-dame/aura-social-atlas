import { fromBonfireArticles, fromBonfirePosts, type BonfireActivityNode } from './spotlight';

const query = (feed: string) => `{feedActivities(first:20,filter:{feedName:"${feed}"}){edges{node{id date canonicalUri boostCount likeCount repliesCount objectPostContent{name summary htmlBody} subject{... on User{character{username canonicalUri} profile{name icon}}} media{url mediaType} object{... on Post{creator{... on User{character{username canonicalUri} profile{name icon}}}}}}}}}`;

import type { RecentArticlesResult, PublicFeedResult } from './bonfire.functions';

/** Public read of Fedizen's Bonfire GraphQL "articles" feed — the same data as Bonfire's Recent Articles. */
async function feed(name: string): Promise<BonfireActivityNode[] | null> {
  try {
    const res = await fetch('https://fedizen.net/api/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: query(name) }), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`Fedizen ${name} feed failed [${res.status}]`); return null; }
    const json = await res.json() as { data?: { feedActivities?: { edges?: { node: BonfireActivityNode }[] } }; errors?: unknown };
    if (json.errors || !json.data?.feedActivities) { console.error(`Fedizen ${name} GraphQL error`, JSON.stringify(json.errors).slice(0, 500)); return null; }
    return (json.data.feedActivities.edges ?? []).map(e => e.node);
  } catch (e) { console.error(`Fedizen ${name} fetch error`, e); return null; }
}

/** Public Bonfire "local" feed: what Fedizen members are posting, no sign-in needed. */
export async function fetchPublicFeed(): Promise<PublicFeedResult> {
  const nodes = await feed('local');
  return nodes ? { posts: fromBonfirePosts(nodes) } : { posts: [], error: 'unavailable' };
}

export async function fetchRecentArticles(): Promise<RecentArticlesResult> {
  try {
    const res = await fetch('https://fedizen.net/api/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: query('articles') }), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`Fedizen articles failed [${res.status}]`); return { articles: [], error: 'unavailable' }; }
    const json = await res.json() as { data?: { feedActivities?: { edges?: { node: never }[] } }; errors?: unknown };
    if (json.errors || !json.data?.feedActivities) { console.error('Fedizen articles GraphQL error', JSON.stringify(json.errors).slice(0, 500)); return { articles: [], error: 'unavailable' }; }
    return { articles: fromBonfireArticles((json.data.feedActivities.edges ?? []).map(e => e.node)) };
  } catch (e) { console.error('Fedizen articles fetch error', e); return { articles: [], error: 'unavailable' }; }
}
