# Atlas → Fedizen: consented API and identity acceptance

**Status (2026-11-09):** blocked on a consenting disposable Fedizen test identity and the actual Atlas Supabase OIDC client/project. Public OIDC discovery and public GraphQL reads are live-verified. Native private GraphQL permissions and end-to-end identity mapping are not.

Atlas remains a Bonfire client. The Fedify discovery gateway does not participate in this authentication workflow.

## Prerequisites and credentials

Use a dedicated disposable test Fedizen account. Obtain its **separately consented read-only resource OAuth grant** through the existing connection flow; an OIDC identity scope is not a replacement for delegated API read permission.

In GitHub **Settings → Environments**, create **fedizen-integration**. Configure required reviewers and restrict the environment to the **main** branch. Add environment secrets named **FEDIZEN_TEST_READ_TOKEN** and **FEDIZEN_TEST_EXPECTED_HANDLE**. Optionally add **FEDIZEN_TEST_POST_ID** for a post intentionally created on the disposable test account; if absent, post-detail acceptance is explicitly reported as **not configured**, not as a successful test. Never store credentials in PRs, chat, logs, issues, documentation or workflow inputs.

The **Fedizen consented native GraphQL acceptance** workflow runs its secret-bearing live job only on manual dispatch from main; pull requests run offline-only checks. Review/pin third-party workflow actions under the repository supply-chain policy before production promotion.

## Live automated read acceptance

With explicit test-account consent, approve and manually dispatch the workflow on main. It uses fixed-origin, non-redirecting, bounded reads to:

1. Verify the token using Fedizen's verify_credentials REST endpoint and match the expected test handle.
2. With that same consenting delegated token, test **the exact Atlas REST fallback requests** to `GET /api/v1/timelines/home?limit=20` and `GET /api/v1/notifications?limit=20` through the existing bounded, schema-validating `fedizenGet` transport. Both must be HTTP 200; empty valid feeds are acceptable. A 401, malformed JSON, bad nested response, 5xx or timeout fails acceptance.
3. Fetch native GraphQL Me.user and compare the native username with the independently verified REST identity.
   Then resolve the same authenticated account using the deployed GraphQL `user(filter:{id})` and `user(filter:{username})` operations; both projections must match the independently verified account and canonical Bonfire ID. If a disposable post ID is configured, use `post(filter:{id})` to verify that specific known post and reject a mismatch or inaccessible result. Never infer a test fixture from another user's content.
4. Read Me.myFeed and Me.notifications using the deployed-schema projections, verify pagination metadata, and safely normalize response shapes.
5. Probe anonymous native Me: only an explicit HTTP 401/403 authorization denial or a valid null Me identity counts as a pass. Timeouts, 5xx, generic GraphQL errors and invalid data are inconclusive failures, never proof of privacy enforcement.
6. Report only sanitized pass/fail check names—never account IDs, handles, posts, tokens, cursor strings, item counts or upstream error text.

A green offline job, skipped live job, successful schema introspection or HTTP 200 alone does not prove authenticated acceptance.

## Separate Atlas OIDC and cross-user acceptance

On the real Atlas deployment and with authorized Supabase project access, complete a consenting user sign-in via **Continue with Bonfire**. Verify registered client and callback, state/PKCE, issuer, audience, nonce and Atlas session creation. Then separately consent to resource API access.

Confirm correct Atlas account → Fedizen identity mapping across refresh, logout, re-login, account switch, callback replay/expiration and grant revocation. Test a second disposable user trying to access the first user's non-public test content, blocked actors and insufficient permissions. Record accurate privacy outcomes without logging contents or identifiers. Test feed cursor stability, post deletion, media handling, offline recovery and Framework7 mobile behavior.

**Current blocker:** The connected Supabase integration exposes no Atlas project in this conversation, and no disposable Fedizen test bearer has been supplied through a protected runtime. These steps cannot be marked complete without real acceptance results.

## Deployed same-origin CSRF and logging acceptance

The custom TanStack Start request pipeline now includes the framework's `createCsrfMiddleware` for server-function RPCs ([PR #102](https://github.com/outlaw-dame/aura-social-atlas/pull/102)); raw unhandled exception objects are not logged. These are code-reviewed and CI-checked changes, **not yet** an externally observed browser/proxy security result.

On a controlled Atlas staging domain, confirm using a disposable authenticated Atlas test session that (a) ordinary same-origin read/connect/disconnect server functions behave correctly, (b) malicious cross-site or sibling-subdomain POST requests with a mismatched `Origin` are rejected **before** any Fedizen state, token, app registration, or connection mutation occurs, (c) the trusted proxy preserves the actual public request origin and does not trust arbitrary client-supplied forwarded-host headers, (d) unauthorized and malformed requests never return private account data, and (e) error responses are non-cacheable and do not expose token/code/PKCE or upstream content. Do not test against unrelated tenants or real user accounts.

## Promotion rules and mutations

The typed private server function is deliberately disabled unless the operator sets **ATLAS_BONFIRE_NATIVE_GRAPHQL_READS=verified**. Do not set this merely because introspection or mocked tests passed. The existing read-only REST personal feed remains active until real private GraphQL acceptance, identity reconciliation and UI verification succeed.

As of [PR #97](https://github.com/outlaw-dame/aura-social-atlas/pull/97), Atlas can render the native read in the desktop Home **only** when the server returns an authorized `available` snapshot and a linked-handle match. Every denied, disabled, identity-mismatch, unavailable or disconnected result preserves the actual REST feed, with no mock substitution. Before enabling the flag, verify the operator-protected live job and separate OIDC/other-user privacy acceptance described above. Verify that switching Atlas users, disconnecting a Fedizen grant and signing out purge both native and REST private caches. Native cursor paging and broader profile/thread read interactions remain work in progress.

After the read gate, promote native Home, profiles, posts/threads and notifications with type-safe cursor pagination. Only then test deployed createPost, reply, like, boost, follow and bookmark mutations using consenting disposable accounts and server-confirmed canonical IDs. Verify privacy boundaries, permission denial, read-after-write, duplicate prevention and eventual federation. Never blindly retry a mutation with ambiguous completion and never claim a local draft or mock reaction is published.

## Evidence

- [Living implementation plan](ATLAS_IMPLEMENTATION_PLAN.md)
- [Deployed GraphQL capability matrix](BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md)
- [Deployed nested-field evidence, PR #93](https://github.com/outlaw-dame/aura-social-atlas/pull/93)
- [Typed private reads, PR #94](https://github.com/outlaw-dame/aura-social-atlas/pull/94)
- [Protected consented acceptance, PR #95](https://github.com/outlaw-dame/aura-social-atlas/pull/95)
- [Public-client live contract regression, PR #96](https://github.com/outlaw-dame/aura-social-atlas/pull/96)
- [Gated native Home UI integration, PR #97](https://github.com/outlaw-dame/aura-social-atlas/pull/97)
- [Deployed Mastodon REST capability matrix](FEDIZEN_MASTODON_REST_CAPABILITY_MATRIX.md)
