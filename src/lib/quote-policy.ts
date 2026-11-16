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

export type BoundaryPermission = { permission: 'quote' | 'request'; can?: string[]; cannot?: string[] };

/** The `createPost(permissions:)` that make a post's quoting follow the choice, whatever the preset grants. */
export function quotePermissions(policy: QuotePolicy): BoundaryPermission[] {
  switch (policy) {
    case 'anyone': return [{ permission: 'quote', can: EVERYONE }];
    case 'ask': return [{ permission: 'request', can: EVERYONE }];
    case 'nobody': return [{ permission: 'quote', cannot: EVERYONE }, { permission: 'request', cannot: EVERYONE }];
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
