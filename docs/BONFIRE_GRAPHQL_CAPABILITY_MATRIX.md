# Atlas Bonfire GraphQL Capability Matrix

> **Version:** 2026-11-08 / first draft. **Fedizen runtime schema inventory: NOT YET CAPTURED.** This table is a **research-backed candidate map**, *not a list of available production mutations*. Maintain alongside [implementation plan](ATLAS_IMPLEMENTATION_PLAN.md). Current primary test instance is `https://fedizen.net`, reported Bonfire Community v1.1.0-rc.1, actual image digest/extension set unconfirmed.

## Evidence protocol

**Status key:** `existing-client-code` (source read, not acceptance), `candidate-upstream` (exists in current upstream source or documentation, NOT checked on Fedizen), `observed-fedizen` (schema/operation witnessed on active instance, may still be unusable), `implemented-test`, `verified-live`, `released`, `not-exposed`, `forbidden`, `deferred`, `blocked`.

For each row, add **exact** deployed root field, args/return, type fragments, OAuth scope, relationship/boundary decision, request/response fixtures with PII removed, PR, CI link, live test date and deployed image digest. Fields are shown in camelCase as conventional GraphQL spelling; **introspection must verify casing, argument names and types**. A repository field name is not a deploy contract.

| Capability / phase | Candidate GraphQL operation(s) or present fallback | Evidence today | Current status | Atlas priority and acceptance |
| --- | --- | --- | --- | --- |
| Public local feed (A/C) | `feedActivities(filter:{feedName:"local"})` | Live 2026-11-09: minimal first:1 HTTP 200 ([run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42559791682)); actual Atlas first:20 query + normalization accepted, 20 posts ([run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42560027193)) | observed-fedizen | P0: verify ordering, cursors and canonical fidelity |
| Articles feed (A/C) | `feedActivities(filter:{feedName:"articles"})` | Live 2026-11-09: minimal first:1 HTTP 200 ([run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42559791682)); actual Atlas first:20 query + normalization accepted, 20 articles ([run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42560027193)) | observed-fedizen | P0: verify pagination, ordering and native article fidelity |
| Personal Home feed (A/C) | `feedActivities` (verify `feedName` and auth), existing scoped REST timeline fallback | Bonfire social schema; existing `fedizen.server.ts` REST client | candidate-upstream | P0: authenticated A/B results match native Home |
| Account / me (A/C) | `me`, `user`, `users`; `/api/v1/accounts/verify_credentials` fallback | `bonfire_me` source; REST implemented in client | candidate-upstream | P0: correct account and denied-scope behavior |
| User profile and counts (C) | `user` + profile/character/relationship, counts | `bonfire_me` source | candidate-upstream | P0: actual own/remote profile and permissions |
| Status / post (C) | `status`, `post`, `activity`, `object` | `bonfire_social` source | candidate-upstream | P0: canonical author, boundary, type and object |
| Threads (C) | `threadContext`, `replied` | `bonfire_social` source | candidate-upstream | P0: ancestors/replies/visibility and pagination |
| Post reactions/state (C) | `likedByMe`, `boostedByMe`, `bookmarkedByMe` + counts | `bonfire_social` activity source | candidate-upstream | P0: real viewer state, counts and update consistency |
| Notifications (C/F) | verify notification feed/activities and/or REST notifications | Existing client read-only REST path; exact GraphQL field not confirmed | existing-client-code | P0: verify GraphQL query, otherwise explicit tested REST fallback |
| Create post / reply (D) | `createPost` | `bonfire_social` source | candidate-upstream | P0: scoped authenticated create and read-after-write |
| Edit post (D) | `editPost` | `bonfire_social` source | candidate-upstream | P0: author-only edit, old-state invalidation |
| Delete post (D) | **No confirmed GraphQL mutation here**; inspect actual schema and authorized REST equivalent | Not verified | blocked | P0: do not invent; explicit deletion semantics |
| Follow / unfollow (D) | `follow`, `unfollow` | `bonfire_social` source | candidate-upstream | P0: pending/accepted/rejected state reconciliation |
| Follow request approval (D) | `acceptFollowRequest`, `rejectFollowRequest` | `bonfire_social` source | candidate-upstream | P0: owner-only validation |
| Like / unlike (D) | `like`, `unlike` | `bonfire_social` source | candidate-upstream | P0: no duplicate; consistent counters |
| Boost / undo boost (D) | `boost` and **inverse to discover** | `bonfire_social` source, inverse unverified | candidate-upstream | P0: no silent unsupported undo |
| Bookmark / unbookmark (D) | `bookmark`, `unbookmark` | `bonfire_social` source | candidate-upstream | P0: durable server-backed, not local saved flags |
| Report / flag (E) | `flag` | `bonfire_social` source | candidate-upstream | P1: reason/evidence policy, avoid harmful content in logs |
| Profile update (D/F) | `updateUser` | `bonfire_me` source | candidate-upstream | P0/P1: per-user auth, avatar media validation |
| Search users/posts (E/F) | `searchUsers`, `searchActivities` | `bonfire_search` source | candidate-upstream | P1: privacy-safe, limited and paginated |
| Groups/topics list/detail (F) | `categories`, `category`, `groupJoinRequests` | `bonfire_classify` source and docs | candidate-upstream | P1: installed extension, membership/role/follow distinction |
| Group membership (F) | `joinGroup`, `leaveGroup`, `addMember`, `removeMember`, `acceptJoinRequest` | `bonfire_classify` source | candidate-upstream | P1: owner/moderator policy and pending requests |
| Group create/update (F) | `createCategory`, `updateCategory` | `bonfire_classify` source | candidate-upstream | P1: explicit authorized boundary and group type |
| Messaging/private chat (F) | **Exact GraphQL schema unknown** | Bonfire social flavor bundles messages, public GraphQL surface unconfirmed | blocked | P1: only after endpoint, consent, E2E privacy verified |
| Realtime subscriptions (F) | `feedActivity` upstream; WS transport must be confirmed | `bonfire_social` source, API transport docs | candidate-upstream | P1: auth, reconnect, replay and fallback polling |
| Events (F) | `event` from `events_api_graphql.ex` | `bonfire_social` source | candidate-upstream | P2: only if installed/desired |
| Upload/media (E) | **GraphQL/upload route unknown** | No inspected deployed contract | blocked | P1: source-verified endpoint, type/size/alt, revoke |
| Instance moderation/boundaries (E/F) | permission grant fields + **boundary lookup to verify** | Bonfire groups docs / social GraphQL source | candidate-upstream | P1: server authoritative choices, deny tests |
| Polls, lists, tags, labels, settings (F) | **Version-specific operations pending inventory** | Feature references only; no confirmed GraphQL mapping | blocked | P1/P2: per installed extension and value |
| Optional relay discovery (H) | **Not Bonfire GraphQL:** independent `GET /api/v1/items` / `facets` | `discovery-gateway` + client code | existing-client-code | P2: never represent as Bonfire native feed |

### Atlas implementation evidence (not Fedizen compatibility evidence)

| Checkpoint | Repository evidence | What it establishes | What remains unverified |
| --- | --- | --- | --- |
| Public contract probe | PR #78, `scripts/probe-fedizen-graphql.mjs` | CI-tested sanitized anonymous probe; **not yet run live against Fedizen** | Actual GraphQL HTTP/data/errors response and enabled schema |
| Public feed consolidation | PR #79, `src/lib/bonfire.server.ts` | Tested shared local/articles path and explicit malformed/partial error states | Fedizen runtime query acceptance and pagination |
| Authorized REST read isolation | PR #80, `src/lib/fedizen.server.ts`, `fedizen.functions.ts` | Tested fixed-path bearer handling, malformed payload detection and independent Home/notification errors | Consented login, real API scopes, authorization and user mapping |
| Typed GraphQL boundary | PR #81, `src/lib/bonfire-graphql.server.ts` | Fixed-origin bounded transport, query-only retries, no mutation replay, cancellation and validation | Deployed schema matching, authorized GraphQL operations, native Home and mutations |

**Important:** CI mocks verify Atlas-side behavior, not production API availability, permission enforcement, or Bonfire-native social persistence. No row above upgrades a capability to `observed-fedizen` or `verified-live`. Record real operator-approved acceptance separately.

### Fedizen minimal public query acceptance — 2026-11-09 04:05 UTC

The [GitHub Actions acceptance run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42559791682) executed the bounded, anonymous, non-introspection probe from the Atlas repository against the real `https://fedizen.net/api/graphql` endpoint. Both `local` and `articles` returned `httpStatus:200`, `graphqlData:"object"`, `feedActivities:"object"`, `edges:1`, and `errors:[]`. Each requested `first:1` and only `node.id`.

**Scope limit:** The initial run established only minimal public projection support. The second run below also accepted the existing Atlas public query selection and normalization. Neither run proves private authorization, pagination, effective schema, deployed image digest or extension inventory. Do not increase the full-feature verified-live coverage numerator yet.

### Actual Atlas public read acceptance — 2026-11-09 04:07 UTC

The [second live GitHub Actions run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42560027193) invoked the existing `fetchPublicFeed()` and `fetchRecentArticles()` code, including the current GraphQL selection sets, request transport, response validation and normalization. Both `local` and `articles` emitted `status:"accepted"` and `items:20`. No post content, account data or raw errors were logged.

**Evidence boundary:** This verifies successful anonymous Atlas public reads on the currently deployed Fedizen instance at the time of the run. It does not verify Home, notifications, mutation support, account permissions, pagination consistency, source fidelity, exact installed extensions, or schema digest.

### Fedizen OIDC public discovery — 2026-11-09 04:11 UTC

The [public issuer metadata acceptance run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42560440836) retrieved `https://fedizen.net/.well-known/openid-configuration` using a bounded anonymous GET and tested only sanitized metadata comparisons. The reported fields were all `true`: `issuerMatches`, `authorizationEndpointSameOrigin`, `tokenEndpointSameOrigin`, `jwksEndpointSameOrigin`, `supportsAuthorizationCode`, `supportsAsymmetricIdTokenSigning`, `publishedPkceS256`, and `publishedOpenIdScope`.

**Scope limit:** This validates public OIDC issuer metadata, not the registered Atlas client, redirect URI, Supabase callback, PKCE exchange, nonce/state validation, signature acceptance, account mapping, refresh/revocation, or any delegated Bonfire GraphQL resource scope. Do not label login `verified-live` until a consented real sign-in and relevant account-isolation tests pass.

### Versioned schema capture record

| Field | Current value | Evidence / next action |
| --- | --- | --- |
| Fedizen host | `fedizen.net` | Existing client origin; no auth credentials in repo |
| Operator-reported Bonfire version | `v1.1.0-rc.1` | Confirm *actual* running OCI image digest and Co-op Cloud recipe |
| Bonfire GraphQL endpoint | `/api/graphql` | Live anonymous public-feed query accepted (HTTP 200, object data, zero GraphQL errors); authenticated API contract still unknown |
| Enabled extensions | **unknown** | Operator/source-matched inventory |
| Query schema hash | **unknown** | Sanitized operator GraphQL schema snapshot |
| Mutation schema hash | **unknown** | Permissioned introspection or offline export |
| OAuth resource scopes | **unknown for GraphQL**; OIDC `openid` is publicly advertised | Identity discovery verified [2026-11-09](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42560440836); delegated resource scopes and consent still require an authorized test account |
| GraphQL subscription transport | **unverified on Fedizen** | Versioned WS/HTTP capability and auth probe |
| Last schema-tested date | **Schema not captured**; public queries tested 2026-11-09 | Minimal acceptance at 04:05 UTC ([run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42559791682)); actual Atlas read acceptance at 04:07 UTC ([run](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42560027193)); auth/schema remain open |
| Client GraphQL coverage numerator / denominator | **0 verified / unknown eligible** | Only calculate after schema capture |

## Review and regression gates

- [ ] Freeze the exact effective Fedizen GraphQL schema and dependency revision, store a **sanitized** snapshot; run schema diff on every host upgrade.
- [ ] Build typed operations with accurate `data+errors` and union/interface fragments; no generically untyped GraphQL responses.
- [ ] Prove each operation with **anonymous/owner/other-user/denied/expired** auth cases where meaningful; log no tokens or private content.
- [ ] Verify returned object identity, audience and boundary; cross-check real interactions with native Bonfire UI for correct eventual consistency.
- [ ] Test pagination, empty/malformed responses, rate limits, 5xx, timeout and cancellation, safe retry budgets, duplicate mutation avoidance and data invalidation.
- [ ] Recalculate measured API surface coverage only for **eligible installed, user-facing operations**, and document explicit deferrals separately.
- [ ] No upstream schema field gets marked “verified-live” without a precise Fedizen runtime test record.

## Primary evidence register

- Maintainer API strategy: https://github.com/bonfire-networks/bonfire-app/issues/1260
- Social GraphQL schema: https://github.com/bonfire-networks/bonfire_social/blob/main/lib/api/social_api_graphql.ex
- Accounts GraphQL schema: https://github.com/bonfire-networks/bonfire_me/blob/main/lib/api/me_api_graphql.ex
- Search GraphQL schema: https://github.com/bonfire-networks/bonfire_search/blob/main/lib/api/search_api_graphql.ex
- Classify/groups GraphQL schema: https://github.com/bonfire-networks/bonfire_classify/blob/main/lib/graphql/schema.ex
- Bonfire GraphQL package: https://github.com/bonfire-networks/bonfire_api_graphql
- Bonfire docs GraphQL: https://docs.bonfirenetworks.org/Bonfire.API.Graphql.html
- Groups GraphQL docs: https://docs.bonfirenetworks.org/graphql_groups_api.html
- OAuth scopes docs: https://docs.bonfirenetworks.org/authentication.html
- REST partial coverage: https://docs.bonfirenetworks.org/routes.html

**Maintenance:** Update matrix and [plan](ATLAS_IMPLEMENTATION_PLAN.md) with each PR or Fedizen deployment; no unchecked “supported” claim from upstream alone.
