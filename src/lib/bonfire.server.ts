import { fromBonfireArticles, fromBonfirePosts, type BonfireActivityNode } from './spotlight';
import { BonfireGraphQLError, requestBonfireGraphQL } from './bonfire-graphql.server';
import { isFeedCursor, publicFeedDocument, validatedBonfireNodes, type PublicFeedName } from './bonfire/graphql/operations';
import type { RecentArticlesResult, PublicFeedResult } from './bonfire.functions';

/**
 * The public feed operation remains a candidate contract until the actual
 * installed Fedizen GraphQL schema has been captured (Phase A).
 */
type FeedPage = { nodes: BonfireActivityNode[]; next?: string };

function validatePublicFeed(data: unknown): FeedPage {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid GraphQL data');
  }
  const feed = (data as Record<string, unknown>).feedActivities;
  if (!feed || typeof feed !== 'object' || Array.isArray(feed)) {
    throw new Error('Invalid GraphQL feed');
  }
  const info = (feed as Record<string, unknown>).pageInfo as { hasNextPage?: unknown; endCursor?: unknown } | null | undefined;
  const next = info?.hasNextPage === true && isFeedCursor(info.endCursor) ? info.endCursor : undefined;
  return { nodes: validatedBonfireNodes((feed as Record<string, unknown>).edges), ...(next ? { next } : {}) };
}

async function readPublicFeed<T>(
  name: PublicFeedName,
  normalize: (nodes: BonfireActivityNode[]) => T,
  after?: string,
): Promise<{ items: T; next?: string } | null> {
  try {
    const page = await requestBonfireGraphQL({
      operation: 'query',
      document: publicFeedDocument(name, after),
      validate: validatePublicFeed,
    });
    // Normalize inside the same failure boundary: nested remote fields can be
    // malformed even after the top-level GraphQL edge shape is valid.
    return { items: normalize(page.nodes), ...(page.next ? { next: page.next } : {}) };
  } catch (e) {
    // Why, without the response: GraphQL errors and bodies can carry private data.
    const why = e instanceof BonfireGraphQLError ? { kind: e.kind, status: e.status, detail: e.detail } : { kind: 'normalize' };
    console.error('Bonfire public feed unavailable', { feed: name, ...why });
    return null;
  }
}

export async function fetchPublicFeed(): Promise<PublicFeedResult> {
  const page = await readPublicFeed('local', fromBonfirePosts);
  return page ? { posts: page.items } : { posts: [], error: 'unavailable' };
}

/** Fedizen's articles feed, a page at a time: `next` is the cursor for the page after this one. */
export async function fetchRecentArticles(after?: string): Promise<RecentArticlesResult> {
  if (after !== undefined && !isFeedCursor(after)) return { articles: [], error: 'unavailable' };
  const page = await readPublicFeed('articles', fromBonfireArticles, after);
  if (!page) return { articles: [], error: 'unavailable' };
  // Where each was published and who wrote it, verified there (bounded; what isn't known in time is left out).
  const { withOriginsAndAuthors } = await import('./article-origins.server');
  const articles = await withOriginsAndAuthors(page.items).catch(() => page.items);
  return { articles, ...(page.next ? { next: page.next } : {}) };
}
