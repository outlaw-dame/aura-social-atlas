# Atlas → Fedizen: consented API and identity acceptance

**Status (2026-11-09):** live Lovable-managed Atlas Supabase database access is confirmed and read-only schema/identity-provider checks completed; the standalone Supabase plugin still lists no projects. Public OIDC discovery and public GraphQL reads are live-verified. The outstanding blockers are *consented disposable A/B API grants* and *fresh end-to-end OIDC/Atlas session acceptance*, not database existence. Native private GraphQL permissions and end-to-end identity mapping have not been proven.

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

**Current blocker:** Atlas's Lovable-managed Supabase **database** can now be inspected through the matching Aura Browser deployment, but the separate Supabase plugin exposes no projects and the current session has no consented disposable Fedizen bearer nor browser-accessible A/B Atlas sessions. Read-only catalog queries cannot demonstrate CSRF behavior, OAuth callback completeness, delegated token permissions, or IDOR denial. Those checks still require real, consenting test sessions.

## Deployed same-origin CSRF and logging acceptance

The custom TanStack Start request pipeline now includes the framework's `createCsrfMiddleware` for server-function RPCs ([PR #102](https://github.com/outlaw-dame/aura-social-atlas/pull/102)); raw unhandled exception objects are not logged. These are code-reviewed and CI-checked changes, **not yet** an externally observed browser/proxy security result.

On a controlled Atlas staging domain, confirm using a disposable authenticated Atlas test session that (a) ordinary same-origin read/connect/disconnect server functions behave correctly, (b) malicious cross-site or sibling-subdomain POST requests with a mismatched `Origin` are rejected **before** any Fedizen state, token, app registration, or connection mutation occurs, (c) the trusted proxy preserves the actual public request origin and does not trust arbitrary client-supplied forwarded-host headers, (d) unauthorized and malformed requests never return private account data, and (e) error responses are non-cacheable and do not expose token/code/PKCE or upstream content. Do not test against unrelated tenants or real user accounts.

## Separate two-account non-public visibility proof

The [two-account protected workflow](../.github/workflows/fedizen-two-account-privacy.yml) and [acceptance script](../scripts/verify-fedizen-two-account-privacy.ts) prove an **actual** Bonfire private-post access boundary. It runs from `main` on manual `workflow_dispatch` only, uses the same reviewer-protected `fedizen-integration` environment, and runs only offline tests on pull requests. Do **not** assume a green offline job means the live test ran.

1. On Fedizen, create two **distinct, explicitly consenting, disposable** accounts A and B. Grant Atlas API **read** access independently to both. Never provide passwords, OIDC ID tokens, production member access tokens, or Bonfire service signing credentials. B must not be eligible to view A's private test post through membership, follows, circles, role or administrator privileges.
2. On account A, create one deliberately **non-public**, disposable post whose boundary excludes B; record its actual Bonfire `Post.id` server identifier, not a copied public URL or ActivityPub URI. Do not reuse real private user content. Confirm the post remains readable by A and deliberately unreadable by B in the native Fedizen UI.
3. Configure the following protected **environment secrets** under GitHub Settings → Environments → `fedizen-integration`: `FEDIZEN_TEST_READ_TOKEN`, `FEDIZEN_TEST_EXPECTED_HANDLE` (A); `FEDIZEN_TEST_SECOND_READ_TOKEN`, `FEDIZEN_TEST_SECOND_EXPECTED_HANDLE` (B); and `FEDIZEN_TEST_PRIVATE_POST_ID` (A's test object). Require a reviewer and restrict permitted deployment branches to `main`. No values should enter workflow inputs, repository YAML, chat, PRs or logs.
4. Manually dispatch **Fedizen protected two-account privacy acceptance** from `main`. Both bearer grants must independently pass REST credential verification, Bonfire GraphQL `Me`, and same-user profile lookup. Account identities must differ. A must resolve the exact supplied private post ID. B must return **null** or an explicit 403/404 **after** its independent grant succeeds; 401, 429, 5xx, GraphQL errors, timeouts, unknown/malformed response and transport failures are **inconclusive failures**, never counted as proof of denial.
5. Only after an accepted live run, perform the separate Atlas/Supabase **session A→B IDOR** tests under actual cookies/bearers and ensure server functions never expose A's token/cache to B. The Fedizen remote A/B test alone does **not** prove Atlas authorization, OIDC mapping or permission handling. Revoke test tokens and delete disposable fixture/account data after verification.

The script logs only static check names and booleans; it never logs handles, identifiers, post content, tokens or upstream error details. No writes are executed by Atlas. This is a **release gate**, not a feature flag or permissions workaround.

## Live Atlas OAuth credential-store verification and owner-constraint rollout

**Observed 2026-11-09 via the matching Lovable Aura Browser project’s enabled Supabase database** (read-only schema queries, no tokens/identities returned): `fedizen_connections`, `fedizen_oauth_states`, and `fedizen_oauth_apps` have RLS enabled, **no client policies**, and no `anon`/`authenticated` grants; `service_role` has the necessary server privileges. The connection table is keyed by `user_id`, OAuth apps by `redirect_uri`, and one-time OAuth states by `state`. No FK currently ties connection/state ownership to `auth.users`, and pending states do not have a unique `user_id` constraint. A read-only preflight found **zero orphaned connections/states** and one expired, unconsumed state. The migration intentionally **does not** remove it.

The matching deployment also has an `auth.identities` row under `custom:app-oidc`. This confirms the OIDC provider has created an identity record, **not** a successful current browser login, valid resource grant, active two-user session, or completed OIDC callback acceptance.

The additive [`0003_fedizen_oauth_ownership.sql`](../drizzle/migrations/0003_fedizen_oauth_ownership.sql) migration is **prepared, not applied to the live database**. Follow the [backup-gated migration rollout and recovery plan](FEDIZEN_OWNER_MIGRATION_ROLLOUT.md) rather than applying it directly through a general SQL query interface. It fails if any stored credential/state is orphaned or if multiple pending states exist for a user; then it adds `ON DELETE CASCADE` foreign keys from the two user-owned tables to `auth.users`, plus a unique per-user pending OAuth state constraint. The redirect-scoped OAuth application registration is intentionally not deleted with a user. Its companion [disposable PostgreSQL CI](../.github/workflows/fedizen-owner-migration-test.yml) must pass.

Controlled production promotion requires an operator-approved database backup/verified restore, fresh read-only orphan/duplicate checks, review of transaction/lock duration and any concurrent Connect traffic, and execution through the normal migration pipeline. Re-check `pg_constraint`, `pg_policies`, and `information_schema.role_table_grants` after applying. Do not truncate or delete expired states or user credentials as a prerequisite without a separate retention decision. The existing read-only REST fallback and disabled native GraphQL gate remain unchanged.

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
