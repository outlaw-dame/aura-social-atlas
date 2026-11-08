# Atlas social discovery

> **Active client implementation and release checklist:** [Atlas Bonfire Client Implementation Plan](docs/ATLAS_IMPLEMENTATION_PLAN.md) · [Fedizen GraphQL Capability Matrix](docs/BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md). The historical tasks below are not authoritative proof of user-facing Bonfire API support. Atlas is a Bonfire client; Fedify relay discovery is optional and independently deployed.

- [x] Document provider-confirmed absence of staging, RC.1 published-artifact versus live-image distinction, isolated synthetic local/CI acceptance gates and approved maintenance-window installation with feature off. Documentation only; full patched Community build/security blockers remain unresolved, no live actions or test rerun.
- [x] Audit official Bonfire recipe image-variable revisions, environment/entrypoint/backup constraints; document historical APP_DOCKER_IMAGE versus published CONTAINER_REGISTRY composition and host-revision-dependent digest override, preserve DOMAIN/identity/volumes/staging. No live actions; host revision and operational backup/override validation remain provider gates.
- [x] Retarget Co-op Cloud integration to reported RC.1; preserve beta archival provenance, resolve canonical annotated tag/source and Community registry metadata, apply three patches to RC-lockfile pins with zero fuzz and parse Elixir; 86 tests pass twice including local PostgreSQL. No live changes; host digest/recipe provenance and full RC Community build remain integration gates.
- [x] Adapt relay-client integration documentation to provider-confirmed Co-op Cloud Community; verify upstream beta.25/version/recipe evidence, document immutable custom-image and staged operator procedure, fix test-state isolation; all 86 tests pass twice including PostgreSQL. No deployment. Host digest/provenance and full matched Bonfire integration remain provider-run gates.
- [x] Audit current Bonfire authorization, recent callback/session evidence, embedded and direct browser behavior, and auth regressions; fix and retest session initialization. Fresh credentialed Fedizen callback remains a user-run check, not an automated success.
- [x] Add more sample posts and reusable Mastodon-style creator attribution with profile, follow, and creator-tag feeds; verify phone and desktop flows.
- [x] Match phone Profile to the centered reference with Posts, Media, Saved, Feeds, Collections, and Lists; verify signed-in tabs and Settings separation.
- [x] Replace browser chrome with social search, creator discovery, Following, and Saved views.
- [x] Preserve Liquid Glass styling and the existing assistant.
- [x] Update public page descriptions and verify discovery interactions.
- [x] Apply required package security update.
- [x] Separate mobile Compose from opt-in AI and hide its floating icon while scrolling.
- [x] Add Settings with Intelligence and Appearance pages; move theme controls to Appearance.
- [x] Verify Compose and settings navigation on mobile and desktop.
- [x] Add real accounts: sign-in icon, /auth sign-in/sign-up with avatar picker, profiles in the backend, signed-in avatar menu.
- [x] Framework7 phone app at /app + home-screen install
- [x] Phone app top bar: menu icon far left, section name centred, actions far right on iOS and Android.
- [x] Phone app side panel marks the section you're viewing.
- [x] Phone Profile: Followers stat, settings gear, editable bio with linkified hashtags, Mastodon-style featured hashtags.

- [x] Memoji avatars and filled-out profiles for creators; Apple Music red (#FA243C) accent incl. hashtags; profile gear top-right without Done.
- [x] Emulate Mastodon author tag: full @user@domain handle, verified rel="me" fields, featured tag counts, joined date, Follows you badge, bot flag, pinned stories.
- [x] Branded network badges: Bluesky logo + Bluesky Blue #0085FF, Mastodon logo + Mastodon Purple #6364FF, on profiles and lists; posts tagged with full @user@domain creator handles.
- [x] Linkified bio hashtags open an in-app feed of that creator's posts with the tag; icon next to the Creators header; Podcasting 2.0 network with Podcast Index red #F90000 badge, feature chips (chapters, transcripts, value4value, persons), and feed metadata.
- [x] Bonfire/Fedizen sign-in: verified Fedizen OIDC discovery, registered Atlas client on fedizen.net, sign-in code already in place; user completes setup in Auth settings.
- [x] Fedizen Recent Articles on Discover (public Bonfire GraphQL "articles" feed) with in-app reader
- [x] Phone app (/app): show Recent Articles
- [x] Personal Fedizen feed + activity via read-only "Connect Fedizen" (needs a real user connect to verify)
- [x] Optional allowlist-only Fedify relay (relay/): Mastodon + LitePub modes, SSRF/redirect/size limits, durable Postgres stores, README and .env.example. Inactive until separately deployed and subscribed by the Fedizen admin.
- [x] Relay security: forward only public posts from currently subscribed servers, verified after signature checks; control-plane handshakes kept separate; signed end-to-end tests.
- [x] Relay: atomic cross-process duplicate check, exact @fedify 2.4.5 pin with startup guard, offline-only tests.
- [x] Optional Bonfire relay client extension (bonfire_relay_client/): Mastodon + LitePub subscriptions, public-only, origin re-fetch, atomic dedup; off by default, needs 5 upstream Bonfire hooks before install (adapter fails closed until then); persist-before-send subscribe, retryable claims, LitePub Announce out.
- [x] Relay admin (Bonfire instance settings → Relays): Mastodon/LitePub/FediBuzz tag + instance connections, hashtag and instance rules with honest coverage, server-side admin checks, 5 upstream hook patches (apply cleanly, not built in Bonfire).
- [ ] Phase 1: discovery-gateway/ Bun+Fedify subscriber service (Service actor, FediBuzz tag/instance + Mastodon/LitePub follows, public-only ingest, Postgres provenance, admin CRUD, read-only JSON API), Atlas Discovery gateway feed, Phase 2 bridge contract doc. No deploys, no writes to fedizen.net.


## Architecture correction and client-first acceptance (2026-11-08)

**Primary product:** Atlas is a Bonfire client; Fedizen (Bonfire Community/Co-op Cloud) is its current test provider and planned custom flavor. **Optional addon:** Fedify-based ActivityPub relay discovery. These are not interchangeable backends.

### Audited status (do not turn earlier checkbox descriptions into proof)

- [x] Audited current source topology and restored the root README's Bonfire-client identity, rather than its stale “Aura Browser” boilerplate. Gateway staging has an independent actor, DB and read API, preserving Bonfire isolation.
- [x] Confirmed that the app *has code paths* for Fedizen OIDC, public Bonfire GraphQL, read-only connected account feed, and optional public gateway discovery. These code paths do **not** alone verify an actual logged-in Fedizen user session or live real-user frontend deployment.
- [x] Confirmed demo catalogue and client-local follows/saves/draft composer remain in primary frontend; they are not native Bonfire actions and must remain clearly identified as mock/local.
- [x] Confirmed `relay/` (standalone relay), `discovery-gateway/` (current subscriber/discovery staging), and `bonfire_relay_client/` (disabled extension) are distinct. Avoid building a duplicate service or routing Atlas native actions into the gateway.
- [ ] **Next first-class acceptance:** exercise Fedizen OIDC end-to-end with a real authorized account, then inspect session/user mapping; verify authenticated personal Bonfire Home, profile and notifications from supported read API, including expiry/reconnect and failure behavior. A public `/healthz` check or synthetic signed relay interaction cannot close these gates.
- [ ] Establish an explicit Bonfire capability matrix for supported read/write APIs in the *deployed* Fedizen Community revision (REST/GraphQL; permissions; canonical identities; error semantics). Separate Bonfire-native capabilities from Atlas enhancements and planned Fedizen-flavor changes.
- [ ] Replace prototype/local-only client actions incrementally with real authenticated Bonfire operations and state reconciliation: compose/post, reply, react, follow/unfollow, edit/delete, bookmark/save **where supported**. Include end-to-end tests against an authorized disposable user, idempotency/retry behavior, error UX and no accidental duplicate posting.
- [ ] Connect public relay discovery to Atlas only as optional, read-only provenance-aware content. Never show it as native Fedizen Home or imply the relay's service actor is the original author.
- [ ] Gate any eventual Bonfire native relay ingestion behind `PHASE2_BONFIRE_BRIDGE.md`, explicit scope approval and provider/Bonfire version-compatible tests; keep the extension off by default.
- [ ] Validate newly deployed gateway revision's key continuity, real signed traffic, durable work after termination and rollback *without modifying Fedizen's live data*. Keep network egress enforcement and alerting as independent gateway production blockers.

**Decision rule for future changes:** Every proposed feature must name the responsible layer (Atlas client, Bonfire/Fedizen, optional Fedify discovery, or optional integration adapter), a supported API and validation path, and its user-facing benefit. Refuse unnecessary layers, duplicate implementations, speculative authentication schemes, new persistence/infra or Bonfire patches when supported client APIs suffice. The gateway's production-readiness work must not prevent parallel client development, nor make gateway staging deployment equivalent to Atlas production readiness.

## Canonical active implementation roadmap

The authoritative **current execution order and definition of done** is [`docs/ATLAS_IMPLEMENTATION_PLAN.md`](docs/ATLAS_IMPLEMENTATION_PLAN.md), with a separate [versioned Bonfire GraphQL capability matrix](docs/BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md). This historical roadmap retains completed past efforts; it does not imply those earlier implementation checkboxes establish successful live Fedizen account/client acceptance. Prioritize Phases A–D (contract/auth/typed GraphQL/native reads and writes) before optional relay extensions or new infrastructure.
