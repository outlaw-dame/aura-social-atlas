# Fedizen Mastodon-compatible REST API — deployment capability matrix

**Last observed:** 2026-11-09 (UTC) · [read-only live probe run #42613913906](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42613913906) · [probe implementation](../scripts/probe-fedizen-mastodon-rest.mjs).

## Scope and evidence labels

Mastodon REST has **no standard equivalent of GraphQL introspection**. An HTTP route with a working status and sampled response is *not* proof of full request/response schema support. Track four separate layers per operation: (1) published Bonfire route, (2) actual Fedizen anonymous response, (3) consented delegated OAuth acceptance including denial, and (4) Atlas production behavior/pagination.

- **Published upstream:** [Bonfire Community v1.1.0-rc.1 API routes](https://docs.bonfirenetworks.org/routes.html) reports 53 implemented / 225 reviewed REST routes (23.6%), 160 not implemented and 12 issues. These numbers describe its documented inventory, not a measured Fedizen percentage or official Mastodon compliance score.
- **Mastodon API reference:** [Mastodon methods](https://docs.joinmastodon.org/api/) are comparison specifications, not a guarantee of Bonfire behavior.
- **Deployed Fedizen:** the anonymous probe uses a fixed HTTPS origin, static read-only GETs, 8s timeout, 128KiB body cap, no redirects, no credentials and no content/error-body logs. HTTP 401/403 is denial or public-read restriction, **never proof a route is absent**; HTTP 404 may also result from visibility rules, and empty lists do not confirm element schema.
- **Authenticated:** only a consenting disposable test identity may verify REST response fields, pagination and negative permission cases. Do not read private content with anonymous probe credentials or store user data as CI artifacts.

## First observed deployed routes

| Priority | GET path | 2026-11-09 live | Evidence / use |
| --- | --- | --- | --- |
| P0 | `/api/v2/instance` | **200, instance response shape observed** | Public instance/discovery metadata only |
| P1 | `/api/v1/instance` | **401 anonymous** | Potential fallback for clients; requires authenticated test |
| P1 | `/api/v1/custom_emojis` | **401 anonymous** | Composer/renderer emoji support, not verified yet |
| P0 | `/api/v1/timelines/public?limit=1` | **401 anonymous** | Public Mastodon-style timeline may be restricted; use live-tested Bonfire GraphQL `local` public feed instead |
| P0 | `/api/v1/accounts/verify_credentials` | **401 anonymous** | Denial observed; server-only delegated read-grant account verification already implemented |
| P0 | `/api/v1/timelines/home?limit=1` | **401 anonymous** | Denial observed; existing authorized REST fallback code needs consented test |
| P0 | `/api/v1/notifications?limit=1` | **401 anonymous** | Denial observed; existing authorized REST fallback code needs consented test |

**The above is a partial anonymous observation, not a passing authenticated REST suite.** No route body, identity, post, error payload or token was logged. All these statuses and structural observations came from the linked CI job, not from an assumed upstream implementation.

## Coverage required for Atlas

| Feature | Preferred source | Mastodon REST surface / verification | Status |
| --- | --- | --- | --- |
| Atlas login and identity | Bonfire OIDC identity + independently consented API grant | `POST /api/v1/apps`, `/oauth/authorize`, `/oauth/token`, `GET /api/v1/accounts/verify_credentials` | Atlas code/tests present; complete live OIDC and grant unverified |
| Home, notifications | Native Bonfire GraphQL `Me.myFeed`, `Me.notifications` | `GET /api/v1/timelines/home`, `/api/v1/notifications` fallback | Typed GraphQL implemented and gated; REST fallback implemented; owner grant not accepted live yet |
| Account details and relationships | Bonfire GraphQL `user`, `Me.user` | `/api/v1/accounts/{id}`, `/api/v1/accounts/relationships`, `/api/v1/accounts/{id}/statuses` | Published upstream; Fedizen authenticated response/field mapping unverified |
| Posts, conversations, threads | Bonfire GraphQL post/activity/context | `/api/v1/statuses/{id}`, `/api/v1/statuses/{id}/context`, `/api/v1/conversations` | Published upstream; no permissioned acceptance |
| Lists, bookmarks, favorites | Bonfire authority | `/api/v1/lists`, `/api/v1/bookmarks`, `/api/v1/favourites` | Published upstream; not enabled as synced Atlas features |
| Publishing/reactions/follows | Bonfire GraphQL mutations, verified permissions | `POST /api/v1/statuses`, status favorite/reblog endpoints, follow/unfollow | NO mutations tested or enabled; require disposable test accounts and no blind retries |
| Media/emoji | Bonfire-authoritative media & rendering | `/api/v1/media/{id}`, `/api/v1/custom_emojis` | Emoji route restricted anonymously; media/upload support not confirmed |
| Search, filters, markers, polls, push | Bonfire extensions when supported | `/api/v2/search`, filters, markers, polls, push endpoints | Upstream documentation lists these as coming soon; do not implement from Mastodon assumptions |
| Groups | Bonfire GraphQL groups/categories first | Proposed `/api/v1-bonfire/groups` extension | [Bonfire groups REST proposal](https://docs.bonfirenetworks.org/masto_groups_api.html) is a draft, NOT evidence of deployed availability; leave existing Groups PR isolated |

## Next contract and safety gates

1. First obtain an operator-approved disposable Fedizen delegated **read** grant and confirm REST `verify_credentials`, Home, notifications and relevant access-denied paths, with no personal details logged. Existing [protected acceptance workflow](../.github/workflows/fedizen-native-auth-acceptance.yml) can be extended for these read-only routes.
2. Track *per-endpoint* response validation and Mastodon version differences from actual Fedizen responses; only then add typed REST adapters or authenticated capability probes. Verify Link headers, cursor/limit behavior, rejected scopes and expired/rotated tokens.
3. Verify Atlas OIDC separately against the actual Supabase client/project and assert stable identity across reconnect, account switch, logout, revoked grant and cross-user access.
4. Keep native GraphQL as first-class source and REST as a feature-specific compatibility fallback. No new parallel store, gateway dependency or Bonfire server modification.
5. Only after read acceptance, test supported writes one at a time on disposable test accounts, verify server-confirmed effects and deny cases; never replay ambiguous mutations automatically.

**Never interpret an upstream documentation list, HTTP status alone, a server schema declaration or mocked test as completed live authenticated feature coverage.**
