# Atlas Bonfire GraphQL Capability Matrix

> **Version:** 2026-11-22. **This is the progress tracker for Atlas's Bonfire API work.** The status table below is current; the dated sections after it are the original 2026-11-08/09 evidence record, kept unchanged. Fedizen (`https://fedizen.net`) reports Bonfire Community **v1.1.0-rc.1**; Bonfire **v1.1.0** was released on 2026-11-18. Maintain alongside the [implementation plan](ATLAS_IMPLEMENTATION_PLAN.md).

## Where Atlas stands (2026-11-22, updated after Railway became the primary backend)

Atlas reaches Fedizen two ways: Bonfire's **GraphQL** API (`/api/graphql`) and Bonfire's **Mastodon-compatible REST** API (`masto_compatible_router`). Every REST call goes through the allowlist in `src/lib/fedizen.server.ts` (`READS` / `WRITES`, a schema per route); every GraphQL document is in `src/lib/bonfire/graphql/operations.ts` or the public readers (`bonfire.server.ts`, `groups.server.ts`).

**How the GraphQL column was checked:** the GraphQL `field` definitions of `bonfire_social`, `bonfire_me`, `bonfire_social_graph`, `bonfire_classify`, `bonfire_files`, `bonfire_search`, `bonfire_messages` and `bonfire_api_graphql` were read at the exact commits pinned by bonfire-app's `mix.lock` for **v1.1.0-rc.1** and for **v1.1.0**. The two are the same for every operation below; the only difference is that v1.1.0 drops the events fields from `bonfire_social`. So upgrading Fedizen to v1.1.0 adds nothing to GraphQL; v1.1.0's changes are in its own pages, federation, notifications and the Mastodon API. "In schema" means defined in that source and, where marked, seen in Fedizen's live root introspection (2026-11-09); it is **not** proof that the operation works for a signed-in person on Fedizen.

Status key: **in use** (Atlas calls it today), **flag-gated** (written and tested, off unless `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS=verified`; **on** for Railway, the primary backend, since 2026-11-22; also set on the Lovable preview), **in schema** (defined upstream, not used by Atlas), **none** (no GraphQL operation in these extensions), **missing** (Atlas has no way to do this yet), **broken** (in use, failing on Fedizen).

| Capability | Atlas today | GraphQL on Bonfire rc.1 / 1.1.0 | GraphQL status | Next |
| --- | --- | --- | --- | --- |
| Public local feed | GraphQL `feedActivities(feedName:"local")` | same | **in use**, live-accepted 2026-11-09 | Pagination and ordering checks |
| Articles (Recent articles, Spotlight) | GraphQL `feedActivities(feedName:"articles")` | same | **in use**, live-accepted 2026-11-09 | — |
| Groups directory, group page, group posts | GraphQL `categories`, `category`, `feedActivities(feedName:"known_groups")`, read signed out | same | **in use** | — |
| For You: busy discussions in joined groups | GraphQL feed `sortBy: REPLY_COUNT`, `timeLimit: 7` | same | **in use** | — |
| Create a post (Public / Quiet public / Fedizen only, CW, media, quote policy, quotes) | GraphQL `createPost` (`createPostOnFedizen`; Fedizen only = `boundary: "local"`, which REST can't express) | `createPost` (live root) | **in use** | Signed-in acceptance record |
| Reply | REST `POST /api/v1/statuses` (`in_reply_to_id`, visibility) | `createPost(replyTo:)` (live root) | in schema | Roadmap 2: `createPost(replyTo:)` only if replies need Bonfire boundaries |
| Home timeline | Railway: GraphQL `me.myFeed` (flag on); REST `/api/v1/timelines/home` where the flag is off | `me.myFeed` picks the page, order and cursor; each post's details come from REST `/api/v1/statuses/:id` (GraphQL lacks visibility, language, mentions, polls, cards, video, quotes on rc.1); slow cards are read right after (`getNativeHomeDetails`); new posts from `getNativeBonfireHomeLatest` (#213, #219) | **in use** on Railway (owner checks pass, #123) | Consented second-account isolation test |
| Notifications / Activity | REST `/api/v2/notifications` (grouped), markers | `me.notifications` (live schema) | **flag-gated** | Same as Home |
| Post detail and conversation | REST `/api/v1/statuses/:id`, `/context` (oldest 80 replies) | `post(filter:{id})` (live schema) flag-gated; `threadContext` in schema (no paging; first 15 branches in big threads) | flag-gated / in schema | Stay on REST (roadmap 3) |
| Profiles (others) | ActivityPub actor read directly (`loadFediProfile`) | `user(filter:{id|username})` (live schema) | **flag-gated** | — |
| Edit own profile on Fedizen | GraphQL `me.user.profile` read; `updateUser(profile:)` (name, bio, website, location); `updateUser(images:)` multipart upload (picture → `icon`, banner → `image`) | `updateUser(profile: ProfileInput, images: ImagesUpload)` (bonfire_me `ef9c2a9`) | **in use** (text fields; picture and banner pending a live upload check) | Atlas accepts JPEG, PNG, WebP, GIF up to 5 MB (Bonfire's `UPLOAD_LIMIT_IMAGES` default; bonfire_files `368bd01` also takes APNG and SVG, which Atlas doesn't send) |
| Edit post | REST `PUT /api/v1/statuses/:id` + `/source` | `editPost` | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Delete post | REST `DELETE /api/v1/statuses/:id` | generic `delete` (any context, `bonfire_api_graphql`) | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Like / unlike | REST `favourite` / `unfavourite` | `like`, `unlike` (live root) | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Boost / undo boost | REST `reblog` / `unreblog` | `boost` only; **no undo-boost operation** | in schema (half) | Stay on REST: GraphQL can't undo a boost |
| Bookmark / unbookmark, Saved | REST `bookmark` / `unbookmark`, `/api/v1/bookmarks` | `bookmark` (live root), `unbookmark` | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Liked posts, who liked / boosted | REST `/api/v1/favourites`, `favourited_by` / `reblogged_by` | `likersOf`, `boostersOf`, `me.likeActivities` | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Follow / unfollow | REST `accounts/:id/follow` / `unfollow` (+ `accounts/lookup`) | `follow`, `unfollow` (live root) | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Follow requests: list | REST `/api/v1/follow_requests` | **no list query** (only `requested` on relationships) | none | Fixed (#193): Bonfire returns every request, ignoring `limit` |
| Follow requests: accept / decline | REST `follow_requests/:id/authorize` / `reject` | `acceptFollowRequest`, `rejectFollowRequest` | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Group join / leave | REST `/api/v1-bonfire/groups/:id/join` / `leave` | `joinGroup`, `leaveGroup` | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Mute / block, lists of them | REST `mutes`, `blocks`, `accounts/:id/mute|block` | read-only `silencing`, `ghosting` on relationships; no mutation | none | Lists over 80 fixed (#219): Bonfire ignores `limit` here too |
| Report | REST `/api/v1/reports` | `flag` | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Circles (Profile → Circles, pinned circle feeds) | REST Lists API (`/api/v1/lists`, `timelines/list/:id`) | `createPost(toCircles:)` reaches circle feeds only: on rc.1 `Acls.prepare_cast` reads `to_circles` from opts, the resolver puts it in post attrs, so it grants no access (bonfire_boundaries 60fc2e7, bonfire_social d64795d) | in schema, not access | Roadmap 2: `boundary: "private"` + `permissions` naming the circle, after a live check |
| Hashtags: follow, followed list, tag timeline | REST `tags/:name/follow`, `followed_tags`, `timelines/tag/:tag` | `feedActivities(filter:{tags})` reads; no follow operation | partial | — |
| Search (people, posts, hashtags) | REST `/api/v2/search`, `accounts/search` | `searchUsers`, `searchActivities` | in schema | Stay on REST: works, and GraphQL adds nothing here |
| Polls: read, vote | REST `/api/v1/polls/:id`, `votes` | none | none | — |
| Media upload, alt text | REST `/api/v2/media` | `uploadMedia`, `updateMedia`, `deleteMedia`, `addMediaByUri` (`bonfire_files`) | in schema | REST for posts; roadmap 1 for profile images |
| Messages (direct conversations) | REST `/api/v1/conversations` (read); sent as `direct` posts | **none** in `bonfire_messages` | none | — |
| Push notifications | REST `/api/v1/push/subscription`, through Atlas's relay | none | none | **blocked** on the VAPID private key (Settings → Notifications) |
| Live updates | Mastodon streaming (WebSocket), else Bonfire SSE | `feedActivity` subscription (transport unverified on Fedizen) | in schema | — |
| Translation | Atlas (device / DeepL / AI); Bonfire's own isn't exposed to apps | none | none | — |
| Collections (Mastodon 4.6) | Atlas tables + Mastodon servers; Bonfire has none | none | none | Move to Fedizen when Bonfire ships FEP-7aa9 |
| Instance blocks | Opens Fedizen's page | none | none | — |
| Events | — | removed in v1.1.0 | none | — |

### Which API: GraphQL or REST (owner decision, 2026-11-22)

Fedizen serves both, over the same Bonfire data: GraphQL (`/api/graphql`) and the Mastodon-compatible REST API. Atlas uses **whichever can do more on Fedizen's version**, and changes a working path only when the change gains something the person can use. Using GraphQL is not a goal in itself.

- **GraphQL** where REST can't do it, or does less:
  - Bonfire's own concepts: groups, boundaries, quotes and quote policy.
  - Profile fields and images (`updateUser`).
  - Native Home order and cursors.
  - Possibly fuller threads (`threadContext`).
- **REST** where it works and GraphQL is missing or weaker on rc.1 / 1.1.0:
  - Undo boost, mutes and blocks (changing them), polls, messages, followed hashtags and push.
  - Every working action, kept as is: like, bookmark, follow, report, search, edit and delete.
- **Both**, when neither is complete alone. Native Home reads GraphQL for the page and REST for each post's details (#213).
- **Every row needs a reason.** Its "Next" column says why it stays where it is, or what moving it would gain.

### Roadmap (where GraphQL adds something)

1. **Profile picture and banner**: `updateUser(images: {icon, image})` as an Absinthe multipart upload (`query`, `variables` naming a file part, the file part). Built; one upload is sent once and never retried. Needs one live check on Fedizen.
2. **Who can see and reply to a post**: Bonfire boundaries and circles. REST offers only public, unlisted, followers and direct. Fedizen only (`boundary: "local"`) is built and passed live (2026-11-22: 404 signed out on REST and ActivityPub, not in the public outbox). Circle posts (`boundary: "private"` + `permissions`) are built; Fedizen accepts them, but rc.1 can't confirm the grant to the poster: `post.permissionGrants` answers [] because `Bonfire.Posts.read` doesn't preload the ACL. Only a circle member reading the post confirms it.
3. **Conversations**: stay on REST (decided 2026-11-22, from bonfire_social `d64795d`). REST `/context` sends the oldest 80 replies under the post from any branch, each a full status (counts, your like/boost/save state). GraphQL `threadContext` takes only an `id` (no paging), returns bare activities, and in threads over 50 replies keeps only the first 15 top-level branches (`Threads.list_replies`, `thread_default_root_reply_limit`), so later branches go missing; filling each in would cost a REST read per post. Atlas now says when Fedizen's 80-reply limit was reached and links to the whole conversation on fedizen.net (`src/lib/thread-limits.ts`).
4. **Second-account isolation test** for native Home and notifications (needs a second consenting Fedizen account).
5. **Rate limit**: learn how Fedizen keys its limiter and its limits; keep each page's request count low (`fedizen-rate-limit.ts`).

### Before publishing

1. **Fedizen's rate limit**: Fedizen answered 429 to Atlas on Railway (2026-11-22). Atlas now waits out `Retry-After`, never retries a 429, backs off for every account when several are limited (one server address), and reuses single-post reads for 30 s per account (`fedizen-rate-limit.ts`). Still to learn: how Fedizen's limiter is keyed (per address or per token) and its limits.
2. **Push notifications**: replace both VAPID keys in Lovable Secrets (the private key is rejected as invalid).
3. **Signed-in GraphQL acceptance** for Home, notifications, posts and profiles (the consented disposable-account workflow below), then decide on `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS`.
4. **Edit your Fedizen profile**: name, bio, website and location from Atlas through `updateUser`. Avatar and banner uploads are still to do.
5. **Fedizen's version**: it reports rc.1. v1.1.0 changes no GraphQL operation above, but fixes and adds behaviour Atlas relies on through the Mastodon API (notifications, groups, keyword filters, follow and like delivery); upgrading is the operator's choice.
6. **Schema snapshot**: still no full effective schema export of Fedizen (see the capture record below).

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

### Delegated access and authenticated REST fallback: implementation evidence, NOT live auth acceptance

- [PR #85](https://github.com/outlaw-dame/aura-social-atlas/pull/85): the existing server-only `Connect Fedizen` OAuth code now validates a returned read grant and uses the fixed-origin `verify_credentials` endpoint to confirm a Fedizen account before writing its token. Invalid scope/identity, unauthorized responses, malformed/oversized bodies and connection-database failures have regression tests. **No consenting test-account OAuth redirect/exchange or native GraphQL authorization was exercised by these mocked tests.**
- [PR #86](https://github.com/outlaw-dame/aura-social-atlas/pull/86): Home and notifications' existing authenticated REST fallback now validates and strips unexpected fields from nested response objects and caps payloads before client normalizers. Malformed responses become explicit errors. This is **not** a claim that Fedizen's logged-in REST fallback or native authenticated GraphQL query passed live acceptance.
- The `me`, authenticated Home, notifications, subject-to-actor mapping, permission-denied, revoke/refresh, pagination and mutations rows remain **candidate-upstream / existing-client-code / blocked** as appropriate until separately verified against the exact installed Fedizen build.

### Additional authenticated-client safeguards (code-tested, not live auth-tested)

- [PR #88](https://github.com/outlaw-dame/aura-social-atlas/pull/88): OAuth callback registration rejects browser-supplied origins that do not match the HTTP request `Origin`. Optional exact canonical HTTPS deployment allowlist; no automatic trust in other hosting tenants.
- [PR #89](https://github.com/outlaw-dame/aura-social-atlas/pull/89): Bonfire-client operations that mutate the linked OAuth state, disconnect, or read private Home require the initiating Atlas user ID to match the server-authenticated account; linked account handle comes from prior `verify_credentials` acceptance, not client input. Account-switch/disconnect clears private cached results.
- [PR #90](https://github.com/outlaw-dame/aura-social-atlas/pull/90): OAuth app registration and one-time token exchange are non-redirecting, no-store, bounded, and validated; no blind token exchange retry. Fedizen account verification, REST feeds, app registration and token exchange reuse a shared streaming response reader.

**Status remains:** repository implementation and mocked regression tests. Private GraphQL `me`, owner-only Home, notifications, scopes, revocation, cache isolation across authenticated native Bonfire API operations, effective schema and mutation contracts are **not verified live**. OIDC discovery and public local/articles acceptance remain the only live-verified API paths.

### Live deployed GraphQL ROOT metadata — 2026-11-09

A bounded anonymous introspection request successfully returned Fedizen's running `RootQueryType` (39 root query fields) and `RootMutationType` (54 root mutation fields) from [GitHub Actions run #42608303102](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42608303102). Its stable normalized root-metadata SHA-256 fingerprint was `91042fff84b53f094f100296e850feda7cf779fc73e061758e40d717362cb57e`. This fingerprint covers the queried root field names and input argument names plus limited types; it **is not** a deployment image digest or a complete effective SDL fingerprint.

**Observed root operations:** `me`, `user`, `users`, `feedActivities`, `post`, `posts`, `activity`, `categories` (queries); `createPost`, `bookmark`, `boost`, `follow`, `unfollow`, `like`, `unlike` (mutations). The live `feedActivities` arguments include `first:Int`, `last:Int`, `after:String`, `before:String`, `filter:FeedFilters`. The live `createPost` arguments include `postContent:PostContentInput!`, `boundary:String`, `contextId:ID`, `permissions:[BoundaryPermissionInput]`, `quoteId:ID`, `replyTo:ID`, `toCircles:[ID]`, and `uploadedMedia:[ID]`.

**Evidence boundary:** Existence and root arguments alone do **not** establish authorization, per-user identity mapping, object return selections, field nullability, pagination accuracy, boundary enforcement, successful mutations, schema extension inventory, or implementation of the UI. These operations are **observed-schema**, not **verified-live authenticated**. Do not invoke any write operation against member data until explicit disposable-account consent and permission testing.

### Deployed GraphQL operation signatures and nested read fields — 2026-11-09

The [live schema acceptance run #42609196886](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42609196886) confirmed the following additional actual Fedizen types, argument names and pagination fields (wrapper-preserving normalized metadata SHA-256 `b06322cd3375ed98f3bcfba453584bad7cb54d47768653ca927cd85c07970ef8`, NOT a container image digest):

- `RootQueryType.me: Me` (no root arguments); `Me.user: User`, `Me.accountId: ID`, `Me.myFeed(first:Int, after:String, before:String, last:Int): ActivityConnection`, `Me.notifications(first:Int, after:String, before:String, last:Int, filter:FeedFilters): ActivityConnection`.
- `User.id: ID`, `User.character: Character`, `User.profile: Profile`, `User.followersCount:Int`, `User.followingCount:Int`; `Character.username:String`, `Character.canonicalUri:String`; `Profile.name:String`, `Profile.icon:String`, `Profile.summary:String`.
- `ActivityConnection.edges:[ActivityEdge]`, `ActivityConnection.pageInfo: PageInfo!`, `ActivityEdge.node:Activity`, `ActivityEdge.cursor:String`; `PageInfo.endCursor:String`, `PageInfo.startCursor:String`, `PageInfo.hasNextPage:Boolean!`, `PageInfo.hasPreviousPage:Boolean!`.
- `FeedFilters` includes `feedName:String`, `feedIds:[ID]`, `tags:[String]`, `subjects:[String]`, `sortBy:SortBy`, and other observed filters. `PostContentInput` has exactly `htmlBody:String`, `name:String`, `summary:String` in this probe.

**Do not infer** the bearer scheme, OIDC identity mapping, authorization boundary, source image pin, native private feed contents, read-after-write behavior or mutation success from this introspection. These are schema-observed read signatures; authenticated acceptance is still required before enabling in the UI.

### Live profile, post and activity detail contracts — 2026-11-09

[Deployed read-only metadata run #42617139471](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42617139471) observed root `user(filter:CharacterFilters):User`, `post(filter:PostFilters):Post`, and `activity(filter:ActivityFilter):Activity`. `CharacterFilters` contains `id:ID`, `username:String`, `autocomplete:String`; `PostFilters` contains `id:ID`; `ActivityFilter` contains `activityId:ID` and `objectId:ID`. Bounded wrapper-preserving root/type metadata fingerprint: `4413a836fb3db365e2299205a4fb306b31d9ec44e1fe82bd082681e4d37a3a57`.

`Post` exposes `id`, `postContent:PostContent`, `creator:AnyCharacter`, `activity:Activity`, `activities:[Activity]`, `media:[Media]`, `context:AnyContext`, and `permissionGrants:[BoundaryPermission]`. `PostContent` exposes `name`, `htmlBody`, `summary`, `rawBody`. `Activity` exposes `id`, `date`, `canonicalUri`, `objectPostContent`, `subject`, `object`, `verb`, `media`, `replied`, `repliesCount`, `likeCount`, `boostCount`, `likedByMe`, `boostedByMe`, `bookmarkedByMe`, and `restricted` among others. This is a **schema** finding, not authorization acceptance; no post contents or member identities were fetched.

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
