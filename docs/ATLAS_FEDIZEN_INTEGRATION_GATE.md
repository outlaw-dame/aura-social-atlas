# Atlas ↔ Fedizen acceptance gate (2026-11-16)

## Authorities and environments
- Atlas is a **Bonfire client**. Fedizen (`https://fedizen.net`) is the reference Bonfire instance, ultimately its own Bonfire flavor. Keep the separate Fedify gateway and relay discovery independent.
- Current source of truth: `outlaw-dame/aura-social-atlas` `main`. PR #147 (Fedizen outbound diagnostics) merged as `ece61b18821a0e40e299f532d9f5e4ee5d083aa6`.
- GitHub-only staging candidate: `staging/atlas-bonfire-client-v2`, PR #148 **draft, not for merge into production**. Restores a *staging-only* `/fedizen-acceptance` read-only, opt-in diagnostic UI on top of current main. Legacy PR #125 used an obsolete November snapshot and must not be deployed in lieu of v2.
- Railway Atlas staging: project `74c7ecfc-222c-455d-ab23-1c64449c8807`, environment `20af7761-b3c0-44e1-8d9b-59fa271589c3`, web service `2e85109c-6fe0-4296-a848-faa74e14bddf`.
- Production-facing *staging* hostname: `https://atlas-staging.damonoutlaw.xyz` via Cloudflare Tunnel `cda3d920-3ee5-480a-9895-7fea1c08027c` into `atlas-web-staging.railway.internal:3000`. No Railway public domains. Separate custom `staging.atlas-social.space` is only prepared; Cloudflare zone is pending delegation.
- Staging Supabase project: `nprmdytcoqiribpwedjc` (US East). Different database from Lovable project's existing Supabase backend. **Never copy credentials, connected accounts, private posts, or production data between them.**

## Verified API reachability — November 16, 2026
- An ephemeral `curlimages/curl:8.16.0` service deployed **inside the same Railway staging project/region**, made public unauthenticated requests to `fedizen.net` at `208.113.210.203`. TLS verification succeeded.
- `/.well-known/openid-configuration` → HTTP 200. `/api/graphql` (POST) → HTTP 200. `/api/v1/timelines/public?limit=1` → HTTP 401. The latter is **not proof of connectivity failure**; requires separate diagnosis of public REST access policy or runtime/request differences.
- The one-shot Railway egress diagnostic service was **deleted** after tests; it had no secrets and no volumes. GitHub-hosted probes also confirm public GraphQL reachable. The Lovable Workers runtime differs and **does not inherit Railway network reachability**.
- PR #147's assertion that missing User-Agent definitively caused failure was unsupported: GitHub runners saw HTTP 200 with and without UA. It now supplies one stable Atlas UA and **sanitized** classifications (DNS, TLS, timeout, reset, refused, blocked, network), never raw transport messages/headers/tokens/GraphQL errors; tests and CI passed. Lovable synchronized to the merged commit.
- **No evidence yet that the Lovable Workers-side failure is resolved**; only a new authenticated preview attempt and its host logs can prove that.

## Database migrations and hardening
- Isolated staging project has repository migrations `0000`–`0004`, including Collections and `fedizen_oauth_apps.scopes`; staging-only owner-FK/unique constraints and trigger grants.
- Lovable production-backed project ID `d3fdefe8-1c72-40dc-8fa6-0b966befbe5b` originally had 3 `auth.users`, 1 registered `fedizen_oauth_apps` row, **0 connections**, no Collections tables, and no `scopes` column. Applied **exact repository migrations `drizzle/migrations/0003_collections.sql` and `0004_fedizen_app_scopes.sql`** inside one transaction, plus `REVOKE EXECUTE` from public/browser roles and `SET search_path = pg_catalog, public` on the two collection trigger functions.
- Verified afterward: **3 users and 1 OAuth app preserved**, 0 connections, 0 Collections items, both new tables RLS enabled, browser roles without SELECT, no anon trigger EXECUTE, scopes column present.
- Isolated staging database security advisor: 0 WARN/ERROR, info-level RLS-no-policy notes are intentional for server-only tables. Newly created indexes unused on zero-row tables are not cause for deletion.

## Bonfire identity versus resource authorization
- Bonfire sign-in / Supabase identity: `custom:app-oidc`, issuer `https://fedizen.net`, scopes `openid profile email`. The exact new staging Supabase callback must match its dedicated Bonfire app registration, normally `https://nprmdytcoqiribpwedjc.supabase.co/auth/v1/callback` (confirm in Supabase form).
- **Different permission grant:** `Connect Fedizen` registers `POST /api/v1/apps`, then `/oauth/authorize`, `/oauth/token`, verifies `/api/v1/accounts/verify_credentials`, and persists a user-scoped token. As of `main` on Nov 16, the requested delegated scopes are **`read write follow`**, not just `read`. The staged *diagnostic* does not post or write, but consent itself allows other Atlas features to do so. Any merged UI must describe that accurately.
- Bonfire API docs: https://github.com/bonfire-networks/bonfire-app/blob/main/docs/api/authentication.md
- Bonfire OpenID docs: https://bonfirenetworks.org/extension/bonfire_open_id/
- Supabase Custom Providers: https://supabase.com/docs/guides/auth/custom-oauth-providers

## Incomplete release blockers (do not claim passed)
1. Railway staging service variable inventory still **does not contain** server-only `SUPABASE_SERVICE_ROLE_KEY`. The connected Supabase MCP tool has no API-key-admin capability. A dedicated **staging-only** `sb_secret_` key must be placed in Railway's secure Variables UI, never GitHub/chat/client code.
2. Staging Supabase Auth `custom:app-oidc` custom provider is not configured; register a distinct Fedizen OIDC app for exact callback and configure its client ID and secret in Supabase Auth's admin UI. Set Auth Site URL/redirects to `https://atlas-staging.damonoutlaw.xyz`.
3. Staging database has **zero authenticated users and zero Fedizen connections**. Sign in intentionally and explicitly approve the separate delegated resource grant. No unsafe copying from the Lovable backend.
4. Run the staged six-check owner read-only diagnostic; separately verify independent user B and anonymous **cannot** read owner-only API data. Do not treat a generic HTTP 200 GraphQL error envelope as conclusive permission denial.
5. Keep `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS=disabled` on staging and production until API acceptance, exact-deployment CI, privacy and session isolation checks genuinely pass.
6. Observe actual Lovable preview logs on a fresh failed/successful connect after #147; no current live Workers-side proof that network issue resolved. Fix measured issue instead of inventing a proxy or opening a direct Fedizen origin.
7. `atlas-social.space` Cloudflare DNS remains **pending**. Audit complete existing Name.com DNS (especially email/DNSSEC) before nameserver delegation. This is **not** a prerequisite for testing existing staging hostname.

## Development expectations
- Do not drift into changing Bonfire server, Fedify relay path, or live production credentials to mask a client fault.
- Prefer exact scoped session/owner checks, no raw token logs, bounded timeouts, no automatic retry of OAuth code redemption or writes, bounded idempotent query retries only.
- Maintain a CI green candidate and pinned Railway deployment SHA; use one Virginia replica with private Cloudflare tunnel, no public origin and no private-data edge cache.
- Document observed results and blockers in https://github.com/outlaw-dame/aura-social-atlas/issues/123. Preserve CI and review evidence and never equate offline tests to live Fedizen user approval.

## Cloudflare Workers fetch redirect compatibility — 2026-11-16

- **Root cause of the Lovable runtime failures identified:** Cloudflare Workers rejects `fetch(url, {redirect: 'error'})` at Request construction before any HTTP request is sent. Node/Bun CI accepts this standard mode, so host-independent CI could not reproduce it. [Cloudflare Workers Request documentation](https://developers.cloudflare.com/workers/runtime-apis/request/) explicitly instructs using `redirect: 'manual'` and checking the HTTP status.
- [PR #149](https://github.com/outlaw-dame/aura-social-atlas/pull/149) merged to `main` (commit `b5bac2dfa9fa304de270207a4c39b8497ca3e15b`); same source changes merged to isolated staging via [PR #152](https://github.com/outlaw-dame/aura-social-atlas/pull/152). Client fetches now request `manual` and their response handlers reject unsuccessful 3xx rather than following redirected URLs carrying a token or authorization data.
- PR #149's Fedizen REST, public GraphQL/OIDC and Atlas/gateway GitHub CI all passed. The Codex review automation could not run because of account usage limits; this is **not** a passed Codex security review.
- Cloudflare Workers supports `cache: 'no-store'` if compatibility date is November 11, 2024 or newer, or `cache_option_enabled` is configured. A separate compatibility failure remains possible on older Workers deployments. Do not remove privacy-related `no-store` without checking the hosting runtime.
- The fix is strongly supported by Cloudflare upstream source and docs; a logged-in **Lovable** browser recheck after the synchronized revision is still required before marking that environment as independently verified. The Railway Node public-GraphQL route was already reachable, and its staging deployment will be repinned after exact-head CI.
- **Unchanged private acceptance blockers:** staging-specific Supabase secret, enabled custom OIDC provider + dedicated client, and a real consented user grant. Do not reuse Lovable database or extract credentials with SQL. The native GraphQL feature flag stays disabled.

