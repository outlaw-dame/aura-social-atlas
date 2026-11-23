# Fedizen native moderation API: implementation contract (provider/flavor boundary)

**State:** Source-verified design for the Fedizen Bonfire provider. NOT deployed on Fedizen. Atlas must keep remote-actor Spotlight withheld until a complete owner-authorized policy is available.

## Why this is necessary

Atlas already checks strict `GET /api/v1/blocks` and `GET /api/v1/mutes`, reusing the signed-in user's independent Fedizen grant. The upstream REST implementation `Bonfire.Boundaries.API.GraphQLMastoAdapter.list_restricted_accounts/3` converts only *user* identities and can silently discard unmappable objects; it does not return blocked remote-instance peers. `/api/v2/filters` is an empty compatibility stub. Thus a successful 200/[] from those endpoints **cannot prove the user has no domain blocks or native filters**.

Bonfire's boundaries source already contains the actual authority:
- `Bonfire.Boundaries.Blocks.user_block_circles(user, :silence | :ghost)` or `Blocks.list(type, current_user: user)`. The list preloads `encircles: [:peer, subject: [:profile, :character]]`, unlike Mastodon account-list REST mappers, so the *peer* side is the one to inspect for remote-instance blocks.
- `Bonfire.Boundaries.BlockKeywords.block_keywords_lists(current_user: user)` compiles the two native keyword lists. **For API serialization**, read the owner's raw `Bonfire.Common.Settings.get([:activity_pub, :mrf_keyword], nil, current_user: user, one_scope_only: true)` with authorization checked by the GraphQL resolver. Return only `reject` and `warn`, never compiled regex structures, internal settings blobs or admin settings.
- Bonfire's boundary UI uses the same `Blocks.user_block_circles` source for owner vs instance-wide tabs; it already distinguishes `:instance_wide` permissions.

Primary source paths:
- https://github.com/bonfire-networks/bonfire_boundaries/blob/main/lib/blocks.ex
- https://github.com/bonfire-networks/bonfire_boundaries/blob/main/lib/block_keywords.ex
- https://github.com/bonfire-networks/bonfire_boundaries/blob/main/lib/api/boundaries_api_graphql.ex
- https://github.com/bonfire-networks/bonfire_ui_boundaries/blob/main/lib/web/components/blocks/blocks_live.ex
- https://github.com/bonfire-networks/bonfire_boundaries/blob/main/lib/api/graphql_masto_adapter.ex
- https://github.com/bonfire-networks/bonfire_api_graphql/blob/main/lib/web/instance_controller.ex

## Proposed compact, owner-only GraphQL shape

Use an **explicit, additive** Bonfire/Fedizen flavor extension instead of dumping entire settings or creating an Atlas-side mirror:

```graphql
query AtlasViewerModeration {
  viewerModeration {
    revision
    complete
    blockedDomains
    rejectKeywords
    warnKeywords
  }
}
```

Every field is owner-scoped from the authenticated GraphQL context; the query accepts **no** `userId` selector. A nullable object or `complete: false` means **withhold remote Spotlight**. `blockedDomains` is a normalized array of explicitly blocked remote instance hostnames (including both ghost/silence as applicable), not instances the viewer merely follows or peers used for global federation.

The fields must never leak scope from another account, an administrator's unrelated lists, or actor-level blocks mistaken for a whole domain. For admin/global policies, expose a separate effective-policy field only where relevant and authorized. `revision` is a stable owner-policy change token or digest, not a fabricated current-time stamp; a policy update must invalidate it. If revision cannot be computed reliably, omit it and use bounded revalidation without claiming push consistency.

## Implementation conditions

1. Obtain `GraphQL.current_user_or_not_logged_in(info)` and stop when there is no authenticated user. Do not trust a client-submitted identity.
2. Read the raw owner-only keyword settings in one read; keep reject/warn separate and preserve escaped/literal semantics. Bound lists and response size before JSON encoding. If a value is malformed, reject the snapshot rather than dropping a keyword unnoticed.
3. Traverse actual owner-owned ghost/silence circles and their peer members, not only people returned by `blocked_users` / `muted_users`. Normalize peer hostnames from canonical verified origins, reject ambiguous entries, and do not derive a domain from arbitrary display strings.
4. Implement bounded pagination or a complete enumerable response with a server-side upper cap **and explicit incomplete marker**. Never return a truncated list as `complete: true`.
5. Separate instance-wide blocks and owner blocks. A personal Spotlight query must honor both when the user is affected, without leaking administrative details from hidden policies.
6. Require normal delegated read authorization for the account. Compare owner identity to the linked Fedizen grant on the Atlas side before merging policy. Do not re-enable the native GraphQL read feature flag for unrelated private reads.
7. Use no cache that shares owner policy with another account. Recheck on window focus and every two minutes at most, immediately invalidate when Atlas writes a block/mute. Direct changes in Fedizen are allowed a bounded staleness window unless the provider returns a valid revision/push event.
8. Tests: two distinct owner accounts with disjoint domains/keywords; empty actual policy; 401/403 and invalid bearer; malformed peer; very long lists; pagination incomplete; blocked+muted; remote actor host mismatch, subdomain and IDN; cross-account isolation; native warn vs reject; policy revision after update; Bonfire runtime under the **deployed** version.

## Atlas integration acceptance

The existing `SpotlightModeration` contract includes `domainCoverage: 'unavailable' | 'complete'`. Until a verified owner-authorized adapter returns `complete`, Atlas must keep remote-source recommendations suppressed. Use Bonfire raw keyword rules as a **provider-origin input to the existing content-filter engine**; do not create an additional LLM or word-matching stack. Preserve native `warn` as a warning/reveal UX, not an unexplained silent drop once that UX exists.

## Disallowed shortcuts

Do not scrape Phoenix LiveView / HTML settings pages; do not use public `/api/v1/instance/domain_blocks` as a substitute for personal blocks; do not infer 'zero blocks' from an unsupported Mastodon endpoint's 404/[]; do not use Atlas's server service role to impersonate a Fedizen user; do not use static settings snapshots as persistent authority.

**Implementation issue:** https://github.com/outlaw-dame/aura-social-atlas/issues/239
