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

/**
 * Profile and post-detail field names were observed on the live Fedizen
 * GraphQL deployment (PR #104). These are deliberately read-only selection
 * sets; no rawBody, permission grants, or private author metadata requested.
 * These documents require authenticated acceptance before UI promotion.
 */
export const NATIVE_PROFILE_BY_USERNAME_DOCUMENT = `query AtlasNativeProfileByUsername($username:String!) {
  user(filter:{username:$username}) {
    id character { username canonicalUri }
    profile { name summary icon image website location }
    followersCount followingCount statusesCount
  }
}`;

export const NATIVE_PROFILE_BY_ID_DOCUMENT = `query AtlasNativeProfileById($id:ID!) {
  user(filter:{id:$id}) {
    id character { username canonicalUri }
    profile { name summary icon image website location }
    followersCount followingCount statusesCount
  }
}`;

export const NATIVE_POST_BY_ID_DOCUMENT = `query AtlasNativePostById($id:ID!) {
  post(filter:{id:$id}) {
    id postContent { name summary htmlBody }
    creator { ... on User { character { username canonicalUri } profile { name icon } } }
    activity {
      id date canonicalUri
      repliesCount likeCount boostCount
      likedByMe boostedByMe bookmarkedByMe
    }
  }
}`;

/**
 * Quote a post (FEP-044f): Bonfire's `createPost` with `quoteId`. Fedizen's Mastodon REST `POST /api/v1/statuses`
 * doesn't take Mastodon 4.5's `quoted_status_id` (bonfire_posts masto_adapter.ex builds a post from status,
 * spoiler_text, media_ids and in_reply_to_id only), so quotes go through GraphQL, as Bonfire's own composer does.
 * Arguments from bonfire_social social_api_graphql.ex (`create_post`: post_content, boundary, uploaded_media,
 * quote_id), in the camelCase Fedizen's schema uses (the observed documents above).
 * `boundary` takes the same presets the REST adapter maps visibilities to: "public" or "unlisted".
 */
export const QUOTE_POST_DOCUMENT = `mutation AtlasQuotePost($postContent: PostContentInput!, $boundary: String, $quoteId: ID, $uploadedMedia: [ID]) {
  createPost(postContent: $postContent, boundary: $boundary, quoteId: $quoteId, uploadedMedia: $uploadedMedia) { id activity { canonicalUri } }
}`;
