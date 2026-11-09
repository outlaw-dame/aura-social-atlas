# Atlas — Bonfire Client Implementation Plan

> **Living implementation / acceptance document** · v1.0 · 2026-11-08 · Status: **planned / partially implemented** · Primary test instance: **https://fedizen.net** · Bonfire Community (operator-reported v1.1.0-rc.1; confirm runtime image/digest with host before treating it as authoritative).
>
> **North star:** Ship Atlas as an excellent, trustworthy, full-featured **Bonfire client**. Fedizen is our current Bonfire instance and will ultimately have its own Bonfire flavor. Use the installed **Bonfire GraphQL API as primary application interface**. Fedify is **optional, independently isolated ActivityPub relay discovery** and must not substitute for Bonfire's accounts, federation, timelines, permissions or moderation.

## 0. Rules of engagement and evidence

- This is the **single execution-order and acceptance checklist** for Atlas client work. `roadmap.md` records history; `discovery-gateway/` and release issue #23 track the separately deployed discovery service. Keep these aligned without duplicating every checklist.
- **No invented API support:** an upstream branch, documentation page, GraphiQL example or repository file **does not prove** a field exists on Fedizen. Bonfire dynamically assembles GraphQL from enabled extensions and deployed revisions. Establish a permissioned, sanitized schema/operation inventory for the **actual Fedizen image**; record each operation's type, args, return shape, authorization, permission/boundary behavior, data owner, version, test and fallback.
- **Coverage definition:** "full/near-full GraphQL" means practically complete coverage of the **installed, user-facing Bonfire Community API**, within the authenticated user's permission set. It **does not mean blindly implementing all upstream extension internals, unsafe administrative operations, or every GraphQL field**. Keep `not exposed`, `unsupported`, `unverified`, `implemented`, and `live-tested` separate.
- **Capability evidence precedence:** (1) read-only introspection/explicit provider-confirmed schema and measured behavior on Fedizen's running deployment; (2) exact immutable installed image/extension source; (3) tagged upstream documentation; (4) upstream `main` as candidate only. Avoid schema introspection if blocked/disabled; request a sanitized server-side schema export from operator instead. Do not brute-force private fields.
- Identity/authentication is **not a generic OAuth API token**. OIDC `openid profile email` logs the user into Atlas; separate **delegated OAuth2** API scopes/consent grant access to Bonfire resources. Establish explicit audience, expiry, revocation and user-to-instance mapping; never assume an OIDC ID token can call GraphQL.
- **Bonfire remains authoritative** for accounts, follow graph, post/reply/reaction state, Home feeds, permissions/boundaries, moderation, groups and messaging. Never create parallel Atlas-owned versions of those records or bypass server-side policy.
- No direct Fedizen database access, credential reuse with gateway, backend patch to a live Co-op Cloud host, automatic relay subscription, private-content export or invisible ingestion into Bonfire. Optional Bonfire extension work is phase-gated and provider-coordinated.
- **Quality gates for every phase:** precise functional specification; tested interfaces; input and response validation; cancellation, race and stale-state controls; bounded retry/backoff with jitter only for safe/transient operations; security/privacy checks; real failure tests; perf/accessibility; review; CI; explicit live evidence. No checkbox may be marked merely because code exists.
- **No unnecessary services**: reuse React/TanStack Start, Framework7 v9 UI and established auth/network layers. Favor a small typed Bonfire API boundary over introducing a second GraphQL service, database, cache or client framework. Keep persistent state in Bonfire except local drafts/device settings and strictly scoped Atlas account/session metadata.
- **User-visible truth:** demo posts, local follows/saves and draft composer must always look like demonstrations until replaced with remote-authoritative state. Connected Fedizen Home and external relay discovery must remain distinguishable.

### Architecture ownership

| Responsibility | Authority / mechanism | Atlas behavior | Explicit non-goal |
| --- | --- | --- | --- |
| Identity, membership, account and profiles | Fedizen Bonfire via OIDC + scoped user API | Login, profile, session mapping; delegated operations | New parallel social user store |
| Social graph / content / feeds | Bonfire GraphQL first; verified REST fallback only | Real reads and mutations with state reconciliation | App-side substitute for Bonfire Home |
| Permission/boundaries/moderation | Bonfire instance + extension policies | Discover and enforce exposed choices; show denied states | Client bypass of boundaries |
| UI and local preferences | Atlas web/PWA | Native-feeling, accessible, responsive user experience | Claim local selections are synced |
| Optional public relay discovery | Independent Fedify `discovery-gateway/` | Public-only, provenance-aware, opt-in panel | Direct Fedizen inbox/database/timeline writes |
| Future Fedizen flavor | Bonfire-compatible versioned extensions | Explicit capability negotiation and tests | Unreviewed host patch or hard fork |
| Production operations | Deployment/edge/provider | Observability, rollback, backup, risk gates | Deploying more services for their own sake |

## 1. Audited current baseline — what exists vs. what is proven

**Seen in repo at time of plan:** `src/lib/bonfire-auth.ts` and `src/routes/auth.tsx` implement Fedizen OIDC sign-in path via Supabase/Lovable custom provider; `src/lib/bonfire.server.ts` queries public Bonfire `feedActivities` (articles/local) via `/api/graphql`; `src/lib/fedizen.server.ts` has a separate read-scope OAuth PKCE connection and server-only bearer storage, with `FedizenFeed` presenting read-only Home/notifications through a Mastodon-compatible API. `GatewayDiscovery` consumes a **separate public gateway**. Desktop `Discovery` and Framework7 `AtlasMobileApp` still read `social-catalogue` mock data and use session-local follows/saves; composer is draft-only. The root README/AGENTS were corrected in PR #73.

**Not proven by code review:** actual OIDC success and correct durable user mapping on present Fedizen; per-user GraphQL authorization; the full exposed schema; real API mutation support, scope behavior and compatibility across upgrades; real UI action persistence or live CI against a consented Fedizen test account. Production-ready Atlas client remains **open**.

**Gateway is a separate workstream:** isolated Railway staging, encrypted R2 backup, restored archive, scheduled job, independent monitor and signed synthetic federation checks are valuable **gateway** evidence, not proof Atlas is an operational Bonfire client. No new gateway feature is a client milestone unless it directly unlocks an explicitly chosen Atlas discovery use case.

## Implementation evidence update — 2026-11-09

The following are verified **repository implementation and test** milestones, not evidence of a completed authenticated Fedizen session or all GraphQL capabilities.

| PR | Tested change | Evidence boundary |
| --- | --- | --- |
| [#78](https://github.com/outlaw-dame/aura-social-atlas/pull/78), [#82](https://github.com/outlaw-dame/aura-social-atlas/pull/82) | Safe public GraphQL contract probes; actual Atlas `local` and `articles` queries accepted live against Fedizen, 20 normalized items each | Anonymous public reads only, not authorized Home or mutation capability |
| [#83](https://github.com/outlaw-dame/aura-social-atlas/pull/83) | Public OIDC discovery validated live: issuer, endpoints, PKCE advertisement, authorization code and signing algorithms | Does not prove registered Atlas client, login, exchange, ID token or per-user mapping |
| [#81](https://github.com/outlaw-dame/aura-social-atlas/pull/81), [#84](https://github.com/outlaw-dame/aura-social-atlas/pull/84) | Shared server-only GraphQL boundary, bounded query retries, safe mutation non-replay, response streaming and error hardening, real public reads | No authenticated operation schema or scope verification yet |
| [#85](https://github.com/outlaw-dame/aura-social-atlas/pull/85) | Delegated read grant and Fedizen account verification required before persisting a connection; database lookup failures fail closed; scoped regression tests | Live consented OAuth flow, actual scope and subject consistency remain unverified |
| [#86](https://github.com/outlaw-dame/aura-social-atlas/pull/86) | Validated/size-bounded private REST Home and notification fallback; malformed entries and unsafe response structures rejected in tests | Existing REST fallback only; user-authorized acceptance and equivalent GraphQL queries remain pending |

**Immediate remaining gate:** use a consented disposable Fedizen test identity to confirm Atlas OIDC sign-in, separate delegated API authorization, the exact installed GraphQL `me` and Home contract, account ↔ subject ↔ actor mapping, denial/expiry/refresh and account-switch isolation. Obtain the exact installed Bonfire version/extension pins or sanitized schema export before shipping inferred mutations. Phases A–C are **not** complete. Fedify gateway deployment and release gates remain separate.

### Authentication and user-bound client progress — November 9, 2026

| Merge | Completed, tested change | What it does **not** prove |
| --- | --- | --- |
| [PR #88](https://github.com/outlaw-dame/aura-social-atlas/pull/88) | Fedizen delegated OAuth callback is bound to the request `Origin`, and optional `ATLAS_FEDIZEN_CALLBACK_ORIGINS` permits an exact HTTPS deployment allowlist; cross-tenant origins rejected before app registration | No live end-to-end Fedizen OAuth callback was exercised |
| [PR #89](https://github.com/outlaw-dame/aura-social-atlas/pull/89) | Home/connect/callback/disconnect validate expected Atlas user identity against server-authenticated Supabase identity; account-linked handle shown, private feed cache cleared on disconnect/session switch, duplicate action taps guarded | No identity mapping between a consented Bonfire OIDC subject and delegated OAuth account has been proven live |
| [PR #90](https://github.com/outlaw-dame/aura-social-atlas/pull/90) | Server-side OAuth registration/code exchange now refuse redirects, read bounded credential responses and avoid retrying one-time codes; shared response reader replaces duplicates across Fedizen REST/OAuth code | Actual deployed OAuth grants, callback configuration, token lifecycle and authenticated GraphQL schema still need evidence |

**Deployment configuration:** Set `ATLAS_FEDIZEN_CALLBACK_ORIGINS` to a comma-separated list of canonical HTTPS Atlas deployment origins when a custom domain is used or an exact production tenant list is required. When unset, the browser request `Origin` must exactly match the submitted callback origin on an existing Lovable-hosted Atlas origin; localhost HTTP remains development-only. A custom domain without explicit configuration fails closed. Never configure an untrusted hostname or wildcard.

**Next P0 integration acceptance:** Obtain a consented, disposable Fedizen test account and an operator-confirmed sanitized effective GraphQL schema for the **running** Bonfire Community version. Verify Atlas OIDC login/redirect → Supabase session → explicitly delegated OAuth grant → account mapping → authenticated `me` and personal Home operations, then test owner/other-user/denied/expired/cross-account cases. Record which operations are actually supported and require no invented mutation fields. The optional Fedify relay remains independent and is not an authentication or API fallback.

## 2. Delivery priorities and dependency sequence

| Rank | Phase | Result | May advance when |
| --- | --- | --- | --- |
| **P0** | **A — Contract & auth verification** | Verified Fedizen GraphQL capabilities and authenticated identity | Captured versioned matrix; OIDC and delegated API checks proven |
| **P0** | **B — Typed GraphQL infrastructure** | One secure, observable, tested API boundary | Queries, auth, errors, pagination and compatibility gates covered |
| **P0** | **C — Complete core read client** | Real Home/local/public feeds, posts, threads, profiles and notifications | No sample data misrepresented; authorized user E2E |
| **P0** | **D — Core social mutations** | Post/reply, edit/delete, like/boost, follow and bookmark where supported | Each mutation verified on test accounts; retries cannot duplicate |
| **P1** | **E — Privacy, media, moderation & discovery** | Usable composer visibility/media, safe searches and state | Permission, upload and harmful-content handling proven |
| **P1** | **F — Complete installed Community modules** | Groups/topics, lists/circles, messaging and other *available* capabilities | Module-by-module documented permissioned matrix |
| **P1** | **G — Polished cross-device Atlas** | Consistent Bonfire functionality on web + Framework7 PWA | UX, accessibility, offline, state and performance gates |
| **P2** | **H — Optional Fedify relay discovery** | Public relay data visible in separate discovery surface | Feature-off fallback, provenance/security tests |
| **P2** | **I — Fedizen flavor and advanced integration** | Explicit versioned capability extensions when needed | Provider approval; source-matched RC/flavor acceptance |
| **Release** | **J — Security, operations and promotion** | Monitored, rollback-ready Atlas client release | All client production gates independently verified |

Phases are **dependencies**, not a command to wait on unrelated gateway operations. A–D form the first end-to-end user value slice. Build a thin vertical slice (identity → feed → post → response reconciliation) early while expanding breadth deliberately.

## Phase A — Fedizen GraphQL contract and identity truth [P0]

**A1. Runtime provenance and source inventory**
- [ ] Record actual Fedizen Bonfire application/Community image digest, host recipe revision, exact enabled extensions, schema build/version timestamp, and *operator confirmed* GraphQL endpoint; compare with declared RC.1. Preserve a historical schema snapshot per deployed version.
- [ ] Confirm public `POST /api/graphql` works for known safe public `feedActivities` query without any user secret; measure 200 vs GraphQL `errors`, access controls, response shape and HTTP caching. Never mistake successful HTTP for successful GraphQL.
- [ ] With authorized operator access, export **sanitized** GraphQL SDL/introspection of `Query`, `Mutation`, `Subscription`, input types, interfaces/unions, directives, deprecated fields and extension coverage. If introspection disabled, obtain server-side schema export; don't switch on public introspection merely for convenience.
- [ ] Cross-reference exact enabled extension pins with upstream `bonfire_api_graphql`, `bonfire_social`, `bonfire_me`, `bonfire_classify`, `bonfire_search` and optional modules. Never use current upstream main as an assertion about Fedizen.
- [ ] Create the living [capability matrix](BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md): schema field, parent type/operation, args, scopes, Bonfire boundary, UI surface, code adapter, status, source commit and live evidence. Mark unsupported/not exposed explicitly.

**A2. Identity and consent**
- [ ] Verify Fedizen OIDC discovery, client registration, redirect allowlist, auth code + PKCE (as applicable), ID token validation (issuer/audience/nonce), state/CSRF and same-site cookie/embedded browser behavior. Record an actual consenting user sign-in/out test without publishing credentials.
- [ ] Verify Atlas account ↔ Fedizen subject mapping is stable; distinguish Atlas account, Fedizen user and remote ActivityPub actor URIs. Multi-account/multi-instance future should not collapse two subjects into one profile.
- [ ] Verify the separately registered **delegated Bonfire resource OAuth client** and the minimal scopes needed for GraphQL per operation. Don't assume `read`/ `write` scopes or Mastodon API auth convey identical GraphQL permissions: prove actual server behavior.
- [ ] Make token lifecycle explicit: expiry/rotation/revocation, reconnect, failed refresh, clock skew, scope upgrade with fresh consent, logout clearing server-side tokens and session mismatch protection; never expose bearer or client secret in bundle/URL/error.
- [ ] Run private and public request tests: anonymous, owner, other-user, expired token, malformed token, denied scope, denied content, blocked user; verify no cross-user/cache bleed.

**Acceptance A:** Runtime provenance + sanitized graph schema inventory are versioned; OIDC user session and delegated GraphQL identity both proven on Fedizen; no raw secrets/test user private content committed. **If missing:** no unsafe mutation is shipped.

## Phase B — Single typed GraphQL integration layer [P0]

- [ ] Implement server-only `src/lib/bonfire-graphql.server.ts` (or consistent local equivalent) with injected transport and per-request authorization. Do **not** scatter inline GraphQL strings or ad hoc `fetch` across components.
- [ ] Keep documents in operation modules `src/lib/bonfire/graphql/{account,feed,post,graph,moderation,...}`; type-generate from a **pinned sanitized deployed schema** if allowed, otherwise manually map only verified fields. CI fails on unreviewed schema changes/type drift.
- [ ] Define explicit operation registry with feature capability flags: available, forbidden-by-scope, unavailable, transient error, schema mismatch. Never silently fall back to fake data or different instance when an operation fails.
- [ ] Enforce known Fedizen HTTPS origin (or explicit allowlist of validated Bonfire instances later); no user-controlled GraphQL endpoint, credentials in browser, unsafe redirects or SSRF. GraphQL variables must be parameterized; validate user-supplied input and truncate returned strings/arrays.
- [ ] Handle `data` + `errors` **together**; classify GraphQL/auth/network/timeouts/rate-limit/unsupported and partial data; preserve safe error IDs and path metadata but never log tokens/contents. Respect HTTP `Retry-After`.
- [ ] Bound timeouts, concurrency, page size, total result size and depth/complexity; abort on route changes. Queries: capped exponential backoff with full jitter on network/429/502/503, respecting retry budget; **mutations: no blind retry** unless proven idempotent/reconciled by canonical object/operation identity.
- [ ] Authenticated per-user caching only where safe, short TTL and explicit invalidation; never CDN-cache private GraphQL; support no-store on sensitive calls. Use existing React Query where appropriate; avoid redundant cache/database infrastructure.
- [ ] Cursor pagination, stable ID normalization, optimistic UI rollback, duplicate suppression, refresh invalidation, stale-response generation guards, disconnected/offline distinction, bounded memory and accessible status.
- [ ] Tests: scripted GraphQL mocked transport, schema fixture integration, auth scope/partial errors, stale-page races, 429/timeouts, 401 refresh/reconnect, retry budgets, query cost/size. Implement observable operation latency/error telemetry without sensitive data.

**Acceptance B:** shared client tested and wired to at least one real authenticated Fedizen read operation; all other client modules consume it by contract.

## Phase C — Bonfire-native reads and information architecture [P0]

- [ ] **Home:** authenticated `feedActivities` or verified equivalent, server-authoritative follow feed, pagination and refresh; show actual source/action/actor rather than just a flat status string.
- [ ] **Public:** local, federated, articles, profile and discovery/trending feed *only where present*; include source labels and clear difference between Fedizen's native federation and Fedify relay discovery.
- [ ] **Posts and threads:** canonical post/activity reads, replies, ancestors/descendants, quoted/boosted attribution, reactions/counts and current-user state; preserve `subject → verb → object` and typed union fragments rather than forcing one status shape.
- [ ] **Profiles:** `me`, `user`/users, character/profile, avatar/header, remote actor identifiers, follower/following counts and relationships; profile edits belong to later mutation phase.
- [ ] **Notifications/activity:** follows/requests, mentions, replies, boosts, likes and moderation notices as exposed; separate from generic feeds; read/unread and streaming only when schema supports it.
- [ ] **State and search:** bookmarks/favourites, following/notifications, search of users/posts/tags, saved/history where Bonfire supports them; do not confuse Atlas local saved cards with Bonfire bookmarks.
- [ ] Replace the top-level fake feed and sample creator fallback **progressively**, with clear demo section or removal; all real views have empty, loading, stale, offline, permission-denied and retry states.
- [ ] Real account and API tests for anonymous/own/other/private/blocked, pagination, deleted/revised posts, HTML sanitization, external URL safety, image privacy, author/boost provenance and responsive UI.

**Acceptance C:** A Fedizen user can log in, read their actual Home, profiles, posts/threads and relevant notifications on desktop and mobile without silently substituting demo content.

## Phase D — Bonfire-native mutations / core usable client [P0]

Implement in **thin vertical slices**, each validated against a consenting *disposable test user*. Never test destructive actions on an unrelated Fedizen member.

- [ ] **Composer and publication:** discover actual `createPost` or version-verified equivalent, supported formats (short posts, articles), rich text/markdown, tags/mentions, drafts/local autosave, audience/boundary selectors; refuse unsupported visibility choices; preserve canonical ID.
- [ ] **Reply / thread:** reply-to canonical object, edit where supported, delete (verify deletion vs hide semantics), quotes/boosts with correct origin and interaction policy.
- [ ] **Reactions:** like/unlike, boost/unboost (verify inverse operation or supported equivalent), bookmark/unbookmark, counts and viewer flags. If a mutation is absent, disable the action—not substitute a local-only success.
- [ ] **Follow graph:** follow/unfollow, pending requests/Accept/Reject, block/mute where supported; reconcile asynchronous federation states rather than marking pending follows as accepted.
- [ ] **Profile:** updateUser or exact exposed profile mutation; avatar/header upload only once verified; maintain consistent account identity.
- [ ] Persist an operation result by its server identity, update query cache, confirm re-fetch and eventual consistency; handle cross-device reload and instance denial gracefully.
- [ ] Prevent duplicate write operations on repeated taps, retry/timeouts or reconnect; use server-supported idempotency when available, otherwise reconcile before retry and show ambiguous completion honestly.
- [ ] Negative tests: permission denial, blocked actor, wrong visibility, expired OAuth scope, file-too-large, network partition, request races, bounced federation, retry storms and user switch.

**Acceptance D:** User publishes/replies/reacts/follows in Atlas; the same result is visible and authorized within Fedizen's native UI and survives refresh/relogin. No duplicate or unauthorized write.

### Phase D dependency detail
1. Verify read-after-write identity and backend consent → 2. simple post/reply → 3. like/bookmark → 4. follow/request lifecycle → 5. edit/delete → 6. boost/quote and profile mutation → 7. richer post types. Vary by actual exposed API, not assumptions.

## Phase E — Safety/privacy, media, search and moderation [P1]

- [ ] Expose Bonfire's boundary/visibility choices as **server-supplied policies** (public, instance, followers, circles/group, custom grants where installed), not a hard-coded Mastodon enum; enforce reply/boost/quote policy returned by server.
- [ ] Verify upload endpoints, presigned transfers if present, type/size limits, scan policy, image descriptions/alt-text, attachments and failure recovery; never ship arbitrary direct-to-R2 media unless explicitly designed.
- [ ] Search by relevant GraphQL queries (`searchActivities`, `searchUsers` are **upstream candidates**, not guaranteed on Fedizen), filters, pagination, remote actor resolution, safe links and privacy.
- [ ] Reports/flags, mute/block, filters, moderation appeal and feedback where available; server remains source of truth and can revoke access independently of UI.
- [ ] Content warnings/spoilers, sensitive content, media labels, rate limiting, anti-spam and safe preview. Sanitize and isolate remote HTML; apply CSP and external media/privacy limits.
- [ ] Privacy acceptance matrix: public, followers-only, group-scoped, custom boundary, deleted, blocked and muted content, including cache invalidation on grant revocation.

**Acceptance E:** No known client path reveals denied content or bypasses instance moderation; accessible media and policy controls behave like Fedizen's effective permissions.

## Phase F — Near-full installed Community GraphQL coverage [P1]

Work from the **versioned capability matrix**, not feature imagination. Categorize each enabled extension's query, mutation and subscription operations; mark “exposed”, “required”, “shipped”, “tested”, “deferred”, “not available”.

- [ ] **Me/identity:** complete exposed profile and account management; relationship/graph, follow request state, secure account/preferences.
- [ ] **Social:** feed/activity/status/post/thread context, like/boost/bookmark flows, replies, counts, actor attribution, reporting and subscription where available.
- [ ] **Groups/topics/classification:** `Category`/member model, discovery, membership vs following vs request vs administration, group context, roles, moderation, creation/editing and boundaries. Bonfire upstream documents `categories`/`category`, `joinGroup` and more, but **confirm installed extension/schema**. Not a mandate to build a separate groups server.
- [ ] **Messaging:** consented private conversations and messages when a supported authorized GraphQL interface exists; distinguish from public activities; never use public discovery gateway for private messages.
- [ ] **Search/tags:** full available users, activities, tags, and filter settings.
- [ ] **Alerts/realtime:** choose GraphQL subscriptions only after verifying transport (Bonfire docs mention `graphql-transport-ws` and Phoenix socket variants), auth, refresh, keepalive, backpressure, cursor replay and privacy; otherwise efficient foreground polling.
- [ ] **Optional modules:** events, locations, media, polls, labels, lists, calendar, collaborative features, valueflows or Fedizen-flavor extras only if installed and user-valued; no assumption that all are present.
- [ ] Compile a **coverage report** for each tested deployment: supported operations used / eligible user-facing operations; blockers by missing extension, denied scope, schema mismatch, API bug and intentionally deferred. Report number and percent with denominator defined; don't claim 100% on an undefined API.
- [ ] Document upstream Bonfire gaps, propose narrow upstream issue/PR first; a Fedizen-specific extension is a last resort with reusable contract and provider sign-off.

**Acceptance F:** Every eligible operation has a verified implementation, documented safe fallback, or explicitly accepted deferment with product rationale; no undocumented API guessing.

## Phase G — UX quality, performance and multiple clients [P1]

- [ ] One normalized Bonfire domain model and API/cache layer shared by desktop React and Framework7 PWA, without duplicating handlers and business logic in view components.
- [ ] Consistent feed identities and actions across devices; adaptive iOS/Material HIG; keyboard, screen readers, reduced motion, text sizing, safe areas, responsive fold; progress/error announcements.
- [ ] Pagination and new-items queue that never shifts reading position unexpectedly; optimistic updates reconciled with canonical Bonfire state; cross-tab/device refresh.
- [ ] Offline: read-only cached eligible public content, explicit stale markers, local **drafts** and retry on explicit user action; do not queue posts silently without consent and idempotent semantics. Never cache private data in shared service worker.
- [ ] Profile customization, app settings, bookmarks, search and notifications must use real backend where promised; sample editions remain clearly separate or removed.
- [ ] Measure first contentful paint, time to first meaningful feed, feed p95 request latency, GraphQL payload size/query count, client memory, pagination stability and API error rate on modest devices/poor networks. Define thresholds from baselines before declaring pass.

**Acceptance G:** Web and PWA provide the same core Bonfire social capabilities; no regressions in auth, UI state, privacy, accessibility or performance.

## Phase H — Optional public ActivityPub relay discovery [P2]

- [ ] Keep `discovery-gateway/` separately deployed, independently recoverable and read-only from Atlas's viewpoint. The app works if the gateway is absent or unhealthy.
- [ ] Verify intended relay implementations (Mastodon/LitePub/FediBuzz and approved relays) and signed actor identity with real controlled external scenarios; public-only, canonical author, origin/relay provenance, dedup and Delete/Undo.
- [ ] Provide explicit user-visible separation and filtering between **Fedizen Home** and **Across the open web**. No automatic Home injection or false follow relationship.
- [ ] Admin selection/approval, subscription state, moderation, retention and relay coverage metrics remain outside ordinary client bearer scope. Default no subscription until operator configures.
- [ ] Close gateway-specific egress and runtime alert/replay/rollback gates in issue #23 without moving their storage into Bonfire.
- [ ] Only if a clear product requirement emerges, request *separate* Phase 2 Bonfire native ingestion design review per `discovery-gateway/PHASE2_BONFIRE_BRIDGE.md`; extension version and moderation must be verified on disposable Bonfire before Fedizen host rollout.

**Acceptance H:** Optional discovery is safe and genuinely additive, and its failure doesn't affect account, Home, compose or notification behavior.

## Phase I — Fedizen-specific flavor and compatibility [P2]

- [ ] Define a **versioned feature capability contract** (base Community, instance-enabled extensions, Fedizen-flavor extras). Detection should be explicit and fail closed, not hidden hard-coded checks for hostname.
- [ ] Prefer reusable upstream Bonfire extensions or GraphQL schema contributions over a permanent fork. Maintain Community compatibility for existing protocol/federation semantics.
- [ ] Obtain host operator approval for exact Co-op Cloud recipe/image digest, backups, rollback, migration behavior and staging strategy; Fedizen has no independent staging environment.
- [ ] Test new flavor against a **fully matching disposable Bonfire installation**, including internal permission boundaries, native UI compatibility, federation and upgrade path, then coordinate maintenance window.
- [ ] Add custom Fedizen features only with concrete approved product requirements, threat model, tests and clear separation from generic Atlas client.

**Acceptance I:** Versioned and reversible enhancement; stock Community client functions remain intact and no unreviewed host change.

## Phase J — Production readiness, testing, security and operations [release gate]

- [ ] **API schema compatibility:** pinned evidence and revalidation on Bonfire upgrade; golden tests and migration/rollback handling. CI checks schema, documents and generated types.
- [ ] **Authenticated end-to-end flows:** real user A/B consented accounts, read/write/delete, request/follow, visibility, moderation, deny/expiry/revoke, multi-tab and cross-device; isolate cleanup.
- [ ] **Reliability:** real network partitions, 429/5xx, transient GraphQL errors, websocket drops, slow media and pagination races; no lost acknowledgement or duplicate mutation; bounded jittered backoff.
- [ ] **Privacy/security:** OAuth PKCE/state/nonce/audience, session fixation, token rotation/revocation, IDOR, CSRF, XSS, content sanitization, SSRF through backend fetch, CORS, CSP, browser caching, storage RLS, secrets handling, dependency scanning, abuse/rate limits.
- [ ] **Accessibility/UX:** device matrix, HIG, keyboard, VoiceOver/TalkBack, touch targets, meaningful errors, color contrast, offline and degraded modes.
- [ ] **Performance:** measure at realistic feed sizes, concurrency and device classes; optimize query fragments/payloads and caching, then load test without harming Fedizen.
- [ ] **Operations:** health/alerts for actual **Atlas client API and auth path**, provider incident contacts, token-rotation runbook, on-call notification delivery, error and audit retention, signed release provenance, rollback plan and periodic restore drill for **systems Atlas owns**.
- [ ] **Governance:** verify permissions and host changes with Fedizen operator, release checklist, reviewer sign-off, issue tracking, known limitation disclosure; gateway production readiness is independent and does not imply client release ready.

**Acceptance J:** Two successful real-account client test cycles, all P0 gates closed with logs/CI, documented P1 deferrals, no known critical security defects, observable rollback and sign-off. Do not call production ready sooner.

## 3. Implementation increments — first ten reviewable PRs

Each PR is a small vertical increment, linked to this document and issue tracking; maintain no duplicated API clients.

| Order | Proposed PR | Scope | Validation / release gate |
| --- | --- | --- | --- |
| 01 | Fedizen schema/provenance audit | Sanitized deployed contract, version, OAuth/GraphQL credential acceptance report (read-only) | Actual Fedizen evidence and matrix baseline |
| 02 | Typed GraphQL transport | Auth/session boundary, `data+errors`, timeouts, safe retries, field/union normalizers | Unit, mocked integration, no private key exposure |
| 03 | Authenticated account identity | OIDC callback/session binding, resource OAuth, scope/revoke/reconnect | End-to-end account A/B and denied scope |
| 04 | Native Home and public feeds | Real feed activities, pagination, author/object provenance | Fedizen user feed equals native UI within expected eventual consistency |
| 05 | Posts, threads and profiles | Read status/thread/user with union normalization and safe rendering | Privacy and response fixture tests |
| 06 | Composer: publish + reply | Server-authoritative create, audience selection, read-after-write | No duplicates; visible in Fedizen UI |
| 07 | Reactions/bookmarks/follows | Like/unlike, bookmark/unbookmark, follow/request lifecycle | Cross-device reload and denials |
| 08 | Edit/delete + notifications | Authorized modification, deletion semantics, notification state | Account A/B negative and stale-state tests |
| 09 | Search, moderation, media | Actual supported operations, uploads, boundary enforcement | Permission and size/type tests |
| 10 | Community breadth & polish | Groups/realtime/optional modules as enabled, QA on web/PWA | Coverage report; accessibility/performance acceptance |

Subsequent approved work: optional Fedify enhancement, Fedizen flavor, and production promotion gates.

## 4. Definition of done (apply to every checkbox)

A feature is **done** only when:
1. A real supported endpoint/field is identified in the **deployed** schema or proven supported REST route; scope and boundary rules documented.
2. Implementation is owned by the correct layer, typed, validated, safe, maintainable, non-duplicative and covered by error cases.
3. Real or disposable integration test shows expected response **and** persistence/reconciliation with Bonfire UI where possible.
4. All success/failure/denied/empty/offline/partial-result states behave honestly; no hidden mock fallback.
5. Focused tests and whole repo CI pass; no unresolved critical review, auth or privacy issues.
6. No secrets/user payloads in test artifacts, logs, comments or docs; release/staging change is explicitly scoped.
7. Capability matrix, docs and PR evidence link updated (commit, test run, version, date). Mark **not verified** when live proof is absent.

### Status labels for the capability matrix
`candidate-upstream` → `observed-fedizen` → `implemented-test` → `verified-live` → `released`. Separately: `not-exposed`, `forbidden`, `deferred`, `blocked`. Never jump labels using only upstream examples.

## 5. Source register (primary references; re-verify on Bonfire upgrades)

- Bonfire maintainers' API options / GraphQL-first architecture: https://github.com/bonfire-networks/bonfire-app/issues/1260
- Bonfire GraphQL extension: https://github.com/bonfire-networks/bonfire_api_graphql
- Bonfire main social GraphQL source: https://github.com/bonfire-networks/bonfire_social/blob/main/lib/api/social_api_graphql.ex
- Bonfire user/profile GraphQL source: https://github.com/bonfire-networks/bonfire_me/blob/main/lib/api/me_api_graphql.ex
- Bonfire groups/classification GraphQL source: https://github.com/bonfire-networks/bonfire_classify/blob/main/lib/graphql/schema.ex
- Bonfire search GraphQL source: https://github.com/bonfire-networks/bonfire_search/blob/main/lib/api/search_api_graphql.ex
- Bonfire GraphQL guide / GraphiQL: https://docs.bonfirenetworks.org/Bonfire.API.Graphql.html
- Bonfire GraphQL groups API: https://docs.bonfirenetworks.org/graphql_groups_api.html
- Bonfire Community release docs: https://docs.bonfirenetworks.org/changelog.html
- Bonfire OAuth2 authentication: https://docs.bonfirenetworks.org/authentication.html
- Bonfire REST coverage (incomplete, version-bound): https://docs.bonfirenetworks.org/routes.html
- Bonfire federation guide: https://docs.bonfirenetworks.org/federation.html
- Existing repo: `AGENTS.md`, `roadmap.md`, `discovery-gateway/PHASE2_BONFIRE_BRIDGE.md`, release issue #23.

**Update cadence:** After each implementation PR, deployed Bonfire change, auth finding, or prototype/user test. Date-stamp matrix verification and evidence; prioritize next unblocked P0 gate. Do not silently recast a proposal as an implemented feature.
