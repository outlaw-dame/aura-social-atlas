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
 * A new Public or Quiet public post through Bonfire's `createPost`, for what Fedizen's Mastodon REST
 * `POST /api/v1/statuses` can't say (bonfire_posts masto_adapter.ex builds a post from status, spoiler_text,
 * media_ids, sensitive and in_reply_to_id only):
 * - `quoteId`: quote a post (FEP-044f; Mastodon 4.5's `quoted_status_id` isn't taken).
 * - `permissions`: who may quote it (lib/quote-policy; Mastodon's `quote_approval_policy` isn't taken either).
 * Arguments from bonfire_social social_api_graphql.ex (`create_post`: post_content, boundary, permissions,
 * uploaded_media, quote_id), in the camelCase Fedizen's live schema shows. `boundary` takes Bonfire's post presets
 * (bonfire_boundaries runtime_config.ex `preset_acls`, 60fc2e7): "public", "unlisted", or "local" (people signed in
 * to Fedizen read and reply; REST has no visibility for it, and reads it back as "unlisted").
 */
/**
 * A post one or more of the person's circles may read and reply to. On Fedizen's rc.1, `createPost(toCircles:)` only
 * reaches the circles' feeds: `Acls.prepare_cast` reads `to_circles` from its opts, while the resolver puts it in the
 * post attrs, so it grants nothing. Access comes from `boundary: "private"` (no preset grants) and `permissions`
 * granting each circle see, read and reply (bonfire_social social_api_graphql.ex `create_post`, d64795d →
 * VerbGrants.transform_to_verb_grants_format/1).
 */
export const CREATE_CIRCLE_POST_DOCUMENT = `mutation AtlasCreateCirclePost($postContent: PostContentInput!, $toCircles: [ID], $uploadedMedia: [ID], $permissions: [BoundaryPermissionInput]) {
  createPost(postContent: $postContent, boundary: "private", toCircles: $toCircles, uploadedMedia: $uploadedMedia, permissions: $permissions) { id activity { canonicalUri } }
}`;

/** What a post grants, as Fedizen stored it (`Post.permissionGrants`, bonfire_social social_api_graphql.ex). */
export const POST_GRANTS_DOCUMENT = `query AtlasPostGrants($id: ID) {
  post(filter: { id: $id }) { id permissionGrants { permission can { id } } }
}`;

export const CREATE_POST_DOCUMENT = `mutation AtlasCreatePost($postContent: PostContentInput!, $boundary: String, $quoteId: ID, $uploadedMedia: [ID], $permissions: [BoundaryPermissionInput]) {
  createPost(postContent: $postContent, boundary: $boundary, quoteId: $quoteId, uploadedMedia: $uploadedMedia, permissions: $permissions) { id activity { canonicalUri } }
}`;

/**
 * The signed-in person's own Fedizen profile, as `updateUser` edits it (bonfire_me me_api_graphql.ex at the commit
 * Fedizen's v1.1.0-rc.1 pins, ef9c2a9: `profile_input` is name, summary, website, location).
 */
export const MY_PROFILE_DOCUMENT = `query AtlasMyProfile {
  me { user { id character { username } profile { name summary website location } } }
}`;

/** Edits it (text fields only; images go through UPDATE_MY_PROFILE_IMAGES_DOCUMENT). */
export const UPDATE_MY_PROFILE_DOCUMENT = `mutation AtlasUpdateMyProfile($profile: ProfileInput) {
  updateUser(profile: $profile) { user { id character { username } profile { name summary website location } } }
}`;

/**
 * Replaces the profile picture (`icon`) or banner (`image`): `updateUser(images: ImagesUpload)`, whose fields are
 * Absinthe `Upload`s sent as multipart parts (bonfire_files Bonfire.Files.GraphQL.upload at 368bd01: IconUploader
 * and ImageUploader). The profile's `icon` and `image` come back as their new addresses.
 */
export const UPDATE_MY_PROFILE_IMAGES_DOCUMENT = `mutation AtlasUpdateMyProfileImages($images: ImagesUpload) {
  updateUser(images: $images) { user { id profile { icon image } } }
}`;

/**
 * Your own circles with their descriptions (bonfire_boundaries `boundaries_api_graphql.ex`, 60fc2e7: `my_circles`,
 * `Circle { id name summary }`). Built-in and stereotyped circles (followers, blocked…) are left out, as REST
 * /api/v1/lists does.
 */
export const MY_CIRCLES_DOCUMENT = `query AtlasMyCircles {
  myCircles(filter: { excludeStereotypes: true, excludeBuiltIns: true }) { id name summary }
}`;

/**
 * Creates or changes a circle. `update_circle` writes `summary` from its input every time, so leaving it out erases the
 * description; Atlas always sends it. (REST PUT /api/v1/lists/:id goes through the same function without a summary,
 * so it erases descriptions too: Atlas renames through this.)
 */
export const CREATE_CIRCLE_DOCUMENT = `mutation AtlasCreateCircle($circle: CircleInput!) {
  createCircle(circle: $circle) { id name summary }
}`;
export const UPDATE_CIRCLE_DOCUMENT = `mutation AtlasUpdateCircle($id: ID!, $circle: CircleInput!) {
  updateCircle(id: $id, circle: $circle) { id name summary }
}`;

/**
 * Who a post can go to: Bonfire's presets and the person's own saved audiences (custom ACLs they named on Fedizen).
 * Each `id` is usable as `createPost(boundary:)` (`boundary_options`, bonfire_boundaries 60fc2e7).
 */
export const POST_AUDIENCES_DOCUMENT = `query AtlasPostAudiences {
  boundaries { options { id label description custom } }
}`;

/**
 * The server an account lives on, as Bonfire knows it: `character.peered.peerId` (bonfire_me me_api_graphql.ex at
 * ef9c2a9, the commit Fedizen's v1.1.0-rc.1 pins). Local accounts have no `peered`.
 */
export const ACCOUNT_SERVER_DOCUMENT = `query AtlasAccountServer($username: String!) {
  user(filter: { username: $username }) { id character { username peered { peerId canonicalUri } } }
}`;

/**
 * Blocking a whole server for yourself. Bonfire has no API for it (no /api/v1/domain_blocks, no GraphQL field for
 * instances), but `blockUser`/`unblockUser` hand their id to Bonfire.Boundaries.Blocks.block/unblock, which take "users
 * or instances" and block a Peer through its instance circle (bonfire_boundaries blocks.ex). After a block the
 * resolver loads the id as a user, which a server isn't, so success comes back as an error; only "Could not block
 * user" means it didn't take. Until Bonfire adds Mastodon's domain_blocks (docs/upstream/bonfire-domain-blocks.md), this
 * is the only way for an app.
 */
export const BLOCK_SERVER_DOCUMENT = `mutation AtlasBlockServer($id: ID!) { blockUser(id: $id) { id } }`;
export const UNBLOCK_SERVER_DOCUMENT = `mutation AtlasUnblockServer($id: ID!) { unblockUser(id: $id) { id } }`;
