import { fromBonfireArticles } from './spotlight';

const QUERY = `{feedActivities(first:20,filter:{feedName:"articles"}){edges{node{id date canonicalUri boostCount likeCount repliesCount objectPostContent{name summary htmlBody} subject{... on User{character{username canonicalUri} profile{name icon}}} media{url mediaType}}}}}`;

import type { RecentArticlesResult } from './bonfire.functions';

/** Public read of Fedizen's Bonfire GraphQL "articles" feed — the same data as Bonfire's Recent Articles. */
export async function fetchRecentArticles(): Promise<RecentArticlesResult> {
  try {
    const res = await fetch('https://fedizen.net/api/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: QUERY }), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`Fedizen articles failed [${res.status}]`); return { articles: [], error: 'unavailable' }; }
    const json = await res.json() as { data?: { feedActivities?: { edges?: { node: never }[] } }; errors?: unknown };
    if (json.errors || !json.data?.feedActivities) { console.error('Fedizen articles GraphQL error', JSON.stringify(json.errors).slice(0, 500)); return { articles: [], error: 'unavailable' }; }
    return { articles: fromBonfireArticles((json.data.feedActivities.edges ?? []).map(e => e.node)) };
  } catch (e) { console.error('Fedizen articles fetch error', e); return { articles: [], error: 'unavailable' }; }
}
