/**
 * Who may quote a new post. Browser-safe and server-safe.
 *
 * Mastodon 4.5 (docs.joinmastodon.org/client/quotes) offers three: `public` "Anybody can quote", `followers`
 * "Only followers can quote", `nobody` "Just me"; private and direct posts are always `nobody`.
 *
 * Bonfire goes further: a post's boundary grants a `:quote` verb, and separately a `:request` verb, so besides
 * "may quote" and "may not" there is "may ask, and the author approves" (bonfire_social lib/quotes.ex
 * `check_quote_permission/3`: the author → yes; `can?(user, [:read, :quote])` → yes; `can?(user, [:read,
 * :request])` → a quote request; else no). Its "public" preset grants `:request` to everyone and `:quote` to nobody
 * (bonfire_boundaries runtime_config.ex `preset_acls`), so on Fedizen's own composer people ask first; its
 * "unlisted" preset grants neither. Those defaults have moved between releases, so Atlas always says which it means,
 * through GraphQL `createPost(permissions:)` (`BoundaryPermissionInput { permission, can, cannot }`, seen on
 * fedizen.net's live schema; bonfire_social `create_post/2` → `VerbGrants.transform_to_verb_grants_format/1`).
 *
 * Atlas offers the three choices people can tell apart at a glance. "Only followers" is left out: Bonfire grants it
 * through the author's own followers circle, and Fedizen's API (`myCircles`) lists circles without saying which one
 * that is.
 */

export type QuotePolicy = 'anyone' | 'ask' | 'nobody';

export const QUOTE_POLICIES: { id: QuotePolicy; label: string; short: string; note?: string }[] = [
  { id: 'anyone', label: 'Anyone can quote', short: 'Anyone' },
  { id: 'ask', label: 'Anyone can ask to quote', short: 'Ask first', note: 'You approve each one' },
  { id: 'nobody', label: 'Only you can quote', short: 'Just me' },
];

/** Bonfire's built-in circles (bonfire_boundaries runtime_config.ex `circles`): everyone on this instance, and everyone elsewhere. */
export const LOCAL_CIRCLE = '3SERSFR0MY0VR10CA11NSTANCE';
export const FEDIVERSE_CIRCLE = '7EDERATEDW1THANACT1V1TYPVB';
const EVERYONE = [LOCAL_CIRCLE, FEDIVERSE_CIRCLE];

export type BoundaryPermission = { permission: 'quote' | 'request' | 'see' | 'read' | 'reply'; can: string[]; cannot: string[] };

/** The verbs a circle gets on a post shared with it: find it, read it, answer it. */
export const CIRCLE_VERBS = ['see', 'read', 'reply'] as const;

/**
 * `createPost(permissions:)` for a post only these circles may see, read and reply to. Nobody may quote it or ask to,
 * as with followers-only posts.
 */
export function circlePermissions(circleIds: string[]): BoundaryPermission[] {
  return [
    ...CIRCLE_VERBS.map(permission => ({ permission, can: [...circleIds], cannot: [] })),
    ...quotePermissions('nobody'),
  ];
}

/**
 * What Fedizen's stored grants say about these circles reading the post: 'confirmed' when every circle may read it,
 * 'missing' when grants came back without that, 'unknown' when none came back. On rc.1 the single-post query
 * (`Bonfire.Posts.read`, bonfire_posts) doesn't preload the post's ACL, so `permissionGrants` answers [] for every
 * post (bonfire_social social_api_graphql.ex: `e(post, :controlled, :acl, :grants, nil) || %{}` → []); an empty
 * answer says nothing about the circle.
 */
export function circleReadCheck(grants: { permission: string; can?: { id: string }[] | null }[] | null | undefined, circleIds: string[]): 'confirmed' | 'missing' | 'unknown' {
  if (!grants?.length || !circleIds.length) return 'unknown';
  const readers = new Set(grants.filter(g => g.permission === 'read').flatMap(g => (g.can ?? []).map(c => c.id)));
  return circleIds.every(id => readers.has(id)) ? 'confirmed' : 'missing';
}

/**
 * The `createPost(permissions:)` that make a post's quoting follow the choice, whatever the preset grants.
 *
 * Every entry carries both `can` and `cannot`, even when one is empty: bonfire_social's `create_post/2` reads each
 * entry with the pattern `%{permission: verb, can: can_ids, cannot: cannot_ids}`, and Absinthe leaves out input
 * fields the client didn't send, so an entry missing either key fails that match and Fedizen answers 500 without
 * posting (seen live on fedizen.net; bonfire_social lib/api/social_api_graphql.ex, and its post_boundary_test.exs
 * always sends both).
 */
export function quotePermissions(policy: QuotePolicy, reach: 'everyone' | 'local' = 'everyone'): BoundaryPermission[] {
  // A Fedizen-only post is read only on Fedizen, so only people there are offered quoting or asking to quote.
  const who = reach === 'local' ? [LOCAL_CIRCLE] : EVERYONE;
  switch (policy) {
    case 'anyone': return [{ permission: 'quote', can: who, cannot: [] }];
    case 'ask': return [{ permission: 'request', can: who, cannot: [] }];
    case 'nobody': return [{ permission: 'quote', can: [], cannot: EVERYONE }, { permission: 'request', can: [], cannot: EVERYONE }];
  }
}

export const DEFAULT_QUOTE_POLICY: QuotePolicy = 'ask';
const KEY = 'atlas.quotePolicy';
const isPolicy = (v: unknown): v is QuotePolicy => v === 'anyone' || v === 'ask' || v === 'nobody';

/** The last choice on this device (a convenience; posts carry their own). */
export function savedQuotePolicy(): QuotePolicy {
  try { const v = globalThis.localStorage?.getItem(KEY); return isPolicy(v) ? v : DEFAULT_QUOTE_POLICY; } catch { return DEFAULT_QUOTE_POLICY; }
}
export function saveQuotePolicy(p: QuotePolicy) {
  try { globalThis.localStorage?.setItem(KEY, p); } catch { /* private mode: the choice holds for this post */ }
}
