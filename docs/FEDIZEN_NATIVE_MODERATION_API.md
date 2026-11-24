# Fedizen native moderation API: implementation contract (provider/flavor boundary)

**State (24 Nov 2026):** Provider contract, not deployed on Fedizen. Atlas now has an opt-in, owner-bound native GraphQL consumer, but the default remains OFF. Remote-actor Spotlight stays withheld until the endpoint is deployed, the owner's complete policy is authenticated and the native keyword semantics/UX are verified.

## Why this is necessary

Atlas already checks strict `GET /api/v1/blocks` and `GET /api/v1/mutes`, reusing the signed-in user's independent Fedizen grant. The upstream REST implementation `Bonfire.Boundaries.API.GraphQLMastoAdapter.list_restricted_accounts/3` converts only *user* identities and can silently discard unmappable objects; it does not return blocked remote-instance peers. `/api/v2/filters` is an empty compatibility stub. Thus a successful 200/[] from those endpoints **cannot prove the user has no domain blocks or native filters**.

Bonfire's boundaries source already contains the actual authority:
- `Bonfire.Boundaries.Blocks.user_block_circles(user, :silence | :ghost)` or `Blocks.list(type, current_user: user)` provides owner block-circle membership. **Important source-level correction (24 Nov 2026):** `Blocks.do_mutate_blocklists/3` converts a remote `Bonfire.Data.ActivityPub.Peer` into an instance **Circle** with `Circles.get_or_create(peer.display_hostname, Scaffold.Instance.activity_pub_circle())` and inserts **that Circle** into the owner's block lists. The `Blocks.list` preload `encircles: [:peer, subject: [:profile, :character]]` does **not** prove that the blocked instance is represented as an `encircle.peer`. The resolver must identify the blocked **subject circle** with the authoritative ActivityPub instance caretaker and resolve/validate its canonical associated peer hostname; generic user-circle names are not domain blocks.
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
  me { user { character { username } } }
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


## Atlas consumer: shipped code, deliberately disabled by default

The consumer is implemented in `src/lib/spotlight-native-moderation.server.ts` and integrated in `getViewerSpotlight`; the existing strict REST block/mute reads still run. The consumer **does not query GraphQL** unless the operator explicitly sets `ATLAS_BONFIRE_OWNER_MODERATION_READ=enabled` on the Atlas **server** after the provider's own implementation has been deployed and tested. Do not enable this against Fedizen rc.1.

The static GraphQL document includes `me.user.character.username` in the **same authenticated operation** as `viewerModeration`. The client compares that identity to the delegated Fedizen account associated with the authenticated Atlas session; there is no arbitrary `userId` argument. Null or mismatched identity, any GraphQL error/HTTP failure, `complete: false`, malformed arrays, unsafe domain, missing revision or overlong payload fails closed.

The provider MUST guarantee `complete: true` covers the *effective* owner policy, including personal ghost/silence blocked-domain peers and applicable instance-wide domain restrictions; a missing/truncated policy is `complete: false` rather than `[]`. `revision` must be stable for the same effective owner policy, must change after a relevant policy edit, and must never be an arbitrary request-time timestamp. It may be an opaque policy digest (no raw user data). The normalized hostnames are DNS domains (not display handles, URLs or peer record IDs); IDNs may be serialized in their ASCII punycode form.

For now **nonempty `rejectKeywords` or `warnKeywords` suppress remote Spotlight promotion** even with `complete: true`: Bonfire's actual keyword regex/word-boundary semantics and the Spotlight warn/reveal UX must be verified before any remote content can pass those rules. An invalid/missing keyword array is rejected entirely. This restriction is intentional, not a complete native keyword implementation. Native policies are not written to a public cache, Supabase service role or the discovery gateway.

### Activation gates (must all be proven)

1. Fedizen's running, version-pinned provider implements the authenticated `viewerModeration` resolver in its actual deployed GraphQL schema, with owner and effective-instance scope documented and independently tested.
2. Two consenting test accounts have distinct blocked domains and native keywords; each sees only their own effective policy. Unauthenticated or revoked bearers return no policy. Missing peer host, truncated lists, upstream timeout or malformed keyword data yields incomplete/denied.
3. Host provenance, IDNs/subdomains, blocked/muted accounts, backend-native reject and warn semantics, policy edits and revision changes are tested against the same Fedizen build.
4. Full Spotlight acceptance confirms configured native keyword rules have correct outcomes and warn/reveal UI, not just network success; only then consider relaxing the conservative keyword hold.
5. Only after successful tests and explicit operator decision should the **server-side** flag be enabled. Verify the account-scoped snapshot on refresh and direct Fedizen settings changes without cross-account caching.

This is a **provider API dependency** rather than a requirement to move Bonfire moderation decisions into Atlas or to fork Bonfire's entire architecture. A small additive extension in the existing `bonfire_boundaries` GraphQL resolver (or Fedizen flavor) is preferred.

## Implementation conditions

1. Obtain `GraphQL.current_user_or_not_logged_in(info)` and stop when there is no authenticated user. Do not trust a client-submitted identity.
2. Read the raw owner-only keyword settings in one read; keep reject/warn separate and preserve escaped/literal semantics. Bound lists and response size before JSON encoding. If a value is malformed, reject the snapshot rather than dropping a keyword unnoticed.
3. Traverse the owner's ghost/silence block circles, including subjects that are **instance circles**, not just users in `blocked_users`/`muted_users`. Check the blocked subject circle's caretaker against `Scaffold.Instance.activity_pub_circle()`, resolve it to an actual canonical peer, and normalize/validate its hostname. Never infer a domain from an arbitrary user-owned circle name or a remote user's display string. Reject unresolved or ambiguous instance-circle entries; a truncated/unresolved policy must return `complete: false`.
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
