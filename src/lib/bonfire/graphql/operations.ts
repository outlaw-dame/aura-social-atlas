/**
 * GraphQL documents observed on the running Fedizen installation on
 * 2026-11-09, from PRs #82, #92 and #93.
 *
 * These are static server-owned documents. Root fields and nested types were
 * introspected, but delegated OAuth authorization and data permissions have
 * not yet passed a consented live acceptance test.
 */
import type { BonfireActivityNode } from '../../spotlight';

export type PublicFeedName = 'local' | 'articles';

/** Reuse the already live-accepted public Activity projection for private reads. */
export const ACTIVITY_SELECTION = `id date canonicalUri verb{verb} boostCount likeCount repliesCount
  objectPostContent{name summary htmlBody}
  subject{... on User{character{username canonicalUri} profile{name icon}}}
  media{url mediaType}
  object{... on Post{id creator{... on User{character{username canonicalUri} profile{name icon}}}}}`;

export const publicFeedDocument = (feed: PublicFeedName) =>
  `{feedActivities(first:20,filter:{feedName:"${feed}"}){edges{node{${ACTIVITY_SELECTION}}}}}`;

export const NATIVE_ME_DOCUMENT = `query AtlasNativeMe {
  me { accountId user { id character { username canonicalUri } profile { name icon } } }
}`;

export const NATIVE_HOME_DOCUMENT = `query AtlasNativeHome($first:Int!, $after:String) {
  me {
    myFeed(first:$first, after:$after) {
      edges { cursor node { ${ACTIVITY_SELECTION} } }
      pageInfo { endCursor hasNextPage hasPreviousPage startCursor }
    }
  }
}`;

export const NATIVE_NOTIFICATIONS_DOCUMENT = `query AtlasNativeNotifications($first:Int!, $after:String) {
  me {
    notifications(first:$first, after:$after) {
      edges { cursor node { ${ACTIVITY_SELECTION} } }
      pageInfo { endCursor hasNextPage hasPreviousPage startCursor }
    }
  }
}`;

/** Fail closed on a partial or malformed response rather than fake an empty feed. */
export function validatedBonfireNodes(edges: unknown, max = 20): BonfireActivityNode[] {
  if (!Array.isArray(edges) || edges.length > max || !edges.every(e =>
    e && typeof e === 'object' && 'node' in e &&
    e.node && typeof e.node === 'object' &&
    typeof e.node.id === 'string' && e.node.id.length > 0)) {
    throw new Error('Invalid Bonfire feed edges');
  }
  return edges.map(e => e.node as BonfireActivityNode);
}
