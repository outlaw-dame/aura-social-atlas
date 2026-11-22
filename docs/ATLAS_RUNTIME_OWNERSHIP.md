# Atlas runtime and backend ownership contract

**Verified against connected infrastructure: November 22, 2026 (America/New_York).** This is the repository's operational source-of-truth map for agents and developers. It describes **current state**, not a claim that an incomplete migration is finished. Always recheck live account status, deployed commit, CI and actual secrets **by name only** before changing infrastructure.

## 1. What owns what?

| Concern | Authority / component | Rules |
| --- | --- | --- |
| Social identity, follows, posts, audiences, moderation, groups and fediverse federation | **Bonfire on Fedizen**, `https://fedizen.net`, externally hosted on Co-op Cloud | Do **not** reproduce Bonfire social state in Supabase, change the Fedizen host/database, or treat a public discovery event as an authenticated Home post. |
| Atlas application backend: SSR/server functions, OAuth PKCE coordination, authenticated API gateway, push relay | **Atlas TanStack Start server**, same GitHub repository as the UI. Deployed on **Lovable Workers** for the existing Lovable application, **Railway Node/Nitro** for independent staging. | The application backend is **not** inherently Lovable; it is server code in `src/**/*.server.ts`, `src/**/*.functions.ts`, and server routes. Runtime compatibility differs (Cloudflare Workers vs Node). |
| Atlas session, user profiles, settings, delegated Bonfire OAuth grants, push devices/relays, AI settings/filters | **Supabase PostgreSQL and Auth**. **Two independent projects**, not one globally shared database. | Use user-scoped auth/RLS where appropriate and server-only secret keys for privileged handlers. No copying accounts, tokens, encryption keys or private data between environments. |
| Independent Atlas web staging | **Railway project** `74c7ecfc-222c-455d-ab23-1c64449c8807`, environment `20af7761-b3c0-44e1-8d9b-59fa271589c3`, `atlas-web-staging` service | GitHub source is **`main`** (owner decision, November 22, 2026: Railway is the primary backend, Lovable the legacy preview), deployed after its checks pass. Earlier deployments came from `staging/atlas-bonfire-client-v3` (last `594dae4`). Exact-head staging CI passed. The isolated stage now has its Supabase server key by *variable name* and a successful Fedizen OIDC sign-in and delegated grant recorded by the acceptance tester. The sign-out replay fix is deployed, but its **live replay** and independent A/B private API isolation are still unverified; neither is a production release approval. |
| Independent staging Atlas database | Supabase project **`atlas-fedizen-staging`**, ID `nprmdytcoqiribpwedjc`, `us-east-1` | Independent staging account domain, with at least one staging tester signed in on November 22; not the existing Lovable project's data. Migrations must be reconciled between `drizzle/migrations` and `supabase/migrations` rather than blindly replayed. |
| Lovable preview/existing application environment | Lovable project **`d3fdefe8-1c72-40dc-8fa6-0b966befbe5b`**, preview `https://id-preview--d3fdefe8-1c72-40dc-8fa6-0b966befbe5b.lovable.app`, with **its own Lovable-managed Supabase/Auth backend** | This environment is **currently real and connected**, not a mock. It has actual Atlas users and Fedizen OAuth grants; treat it as production-like. Some generated Lovable SDK, identity bootstrap and preview auth behavior remain in use. Never delete them merely to remove branding. |
| Network ingress/CDN/WAF/AI crawler policy | **Cloudflare** | Independent staging web hostname `https://atlas-staging.damonoutlaw.xyz` uses a private Cloudflare Tunnel to Railway (`atlas-web-staging.railway.internal:3000`). No public Railway origin domains. Authenticated pages, OAuth callbacks and GraphQL responses bypass CDN caching. |
| Product domain | **`atlas-social.space`** | Cloudflare full DNS zone was *prepared* with branded `staging.atlas-social.space` pointing to the tunnel, but registrar authoritative delegation was **not activated at last verification**. Do not assume this branded staging hostname works or redirect the apex without a verified DNS/mx/DNSSEC cutover. |
| Optional public relay discovery | Separate **Fedify discovery gateway** under `discovery-gateway/`, with its **own Railway services and private PostgreSQL** | Gateway staging hostname `staging-gateway.damonoutlaw.xyz`. Not the Atlas application backend, not the canonical Bonfire feed, and not a path to authenticate a user. |

**Keep the three boundaries distinct:** `Fedizen/Bonfire` (social authority), `Atlas server + its environment-specific Supabase` (client/application backend), and `Fedify gateway` (optional public discovery). The GitHub repository owns source code; hosting and database consoles own runtime resources.

## 2. Why agents keep using Lovable

- The repository originated in Lovable; `README.md` previously said only "Built with Lovable". It does **not** mean Lovable is the sole backend.
- `vite.config.ts` depends on `@lovable.dev/vite-tanstack-config`, which generates the TanStack Start build and defaults to a Cloudflare-targeted Nitro build. Keep it while the Lovable preview uses it; independent staging sets `NITRO_PRESET=node-server`.
- `src/integrations/lovable/index.ts` and `@lovable.dev/cloud-auth-js` implement the current Lovable-specific identity bridge. **Existing users depend on this flow**. A generic OIDC/identity replacement is a distinct migration project, not a find-and-replace.
- The tracked root `.env` references the existing Lovable-connected Supabase project's **public** URL and publishable key. This is historical local/default configuration, **not the declared production backend for every deployment**. Do not assume it is the correct target for Railway, nor commit or overwrite secret values. Railway staging uses its own build-time `VITE_SUPABASE_*` and server-only `SUPABASE_*` settings, which must identify the *same* staging Supabase project.
- The generated Supabase clients `src/integrations/supabase/client.ts` and `client.server.ts` contain Lovable-specific error wording. They are not a backend inventory: their Supabase URLs come from the **runtime environment**. Keep server key handling server-only.
- `drizzle.config.ts` presently reads `LOVABLE_DB_MIGRATION_URL`: a **legacy migration variable**, not a requirement to host Atlas in Lovable. Do not invoke migrations against a target chosen merely because that variable exists; explicitly identify and verify the intended environment, schema state, backup/recovery gate and applied migration ledger.

## 3. Default workflow for any coding agent

1. **Source control:** Start with `outlaw-dame/aura-social-atlas`, branch `main`, check open PRs, CI, recent migrations and this file. Read `AGENTS.md`. Do not use Lovable chat as the source of truth or ask Lovable to regenerate existing GitHub code.
2. **Identify environment:** State whether the requested task targets (a) GitHub source only, (b) **existing Lovable preview and its existing Supabase**, (c) **independent Railway staging and its separate Supabase**, (d) gateway, or (e) future production on `atlas-social.space`. No implicit cross-environment promotion.
3. **Implement in GitHub:** Prefer a narrow PR on `main`, real tests and CI, review feedback, merge only verified changes. Railway builds `main` once its checks pass; confirm the active deployment's commit before acceptance. Staging diagnostics stay behind `ATLAS_FEDIZEN_ACCEPTANCE_PROBES`.
4. **Runtime configuration:** Check actual deployment settings and key **presence**, never retrieve or print privileged values. `SUPABASE_SERVICE_ROLE_KEY`, VAPID private key, Fedizen client secret and relay signing credentials are server-only. Do not expose to Vite `VITE_*` variables, commit, support logs or model/tool responses.
5. **Database changes:** Determine whether a migration applies to isolated staging or existing Lovable-managed users; reconcile the repository's multiple migration tracks. Verify RLS, grants, owner constraints, idempotency and postflight counts. Never assume a migration applied to one Supabase project applies to the other.
6. **Acceptance:** Separate public Fedizen API connectivity from an authenticated Atlas session, the distinct user-consented `Connect Fedizen` delegated OAuth grant, private API visibility, cross-account denial and actual posting/push delivery. Test each gate in its **own** runtime. No automatic user grants, no token export from an existing user.
7. **Deploy:** For independent staging, use Railway's connected GitHub source, Nitro Node preset, explicit staging commit and private Cloudflare Tunnel; validate browser-facing Cloudflare ingress and that no direct Railway public domain bypasses WAF. For Lovable-specific fixes, use Lovable only when that runtime or its managed database/secrets genuinely need action.
8. **Track:** Record exact PR, commit, CI, deployment, environment and verified/unverified capabilities in [issue #123](https://github.com/outlaw-dame/aura-social-atlas/issues/123). Do not claim completed production migration based on isolated staging success.

## 4. What remains separate or incomplete

- **Existing Lovable Auth accounts and Atlas app data** are not in `atlas-fedizen-staging`. No cutover/import is authorized or completed.
- **Railway staging privileged Supabase client:** `SUPABASE_SERVICE_ROLE_KEY` is **present by name** in the connected staging service's November 22 inventory. Its value was not read. This does not imply equivalent secrets or migrations exist in the Lovable or future independent production environments.
- **Railway staging custom Fedizen OIDC identity provider:** The November 22 operator acceptance confirmed `custom:app-oidc` sign-in and a separate Fedizen `read write follow` delegated API grant. These are independent mechanisms. Do not copy this staging registration, grant or user to production.
- **Existing Lovable web-app backend** still runs server functions on Lovable's Workers and uses Lovable-managed Supabase/identity integration; its VAPID configuration is independent of Railway environment variables. Server-only keys are **environment-specific**: a value configured in Lovable is not available in Railway, and vice versa.
- **Atlas production domain/production SSR**: no validated full production cutover of `atlas-social.space` to Railway/Cloudflare/independent Supabase was completed.
- **Production data migration or live-user OAuth handoff:** design separately with explicit consent, rollback and verified owner/data isolation. Do not treat a separate staging project with test users as a replacement for an active production database.
- **Native Bonfire GraphQL read flag** `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS` stays off until owner/anonymous/A-B acceptance is verified on the exact deployment.

## 5. Current operational references

- [Staging v3 implementation review (PR #198)](https://github.com/outlaw-dame/aura-social-atlas/pull/198) — the staging diagnostic work stays unmerged; older v2 runbooks are historical
- [Fedizen API capability matrix](BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md)
- [Atlas implementation plan](ATLAS_IMPLEMENTATION_PLAN.md)
- [Gateway deployment contract](../discovery-gateway/README.md)
- [Release acceptance issue #123](https://github.com/outlaw-dame/aura-social-atlas/issues/123)

**Never remove an active Lovable integration just to make GitHub look independent.** Independence requires a tested application build, runtime secrets, equivalent authentication, data migration or explicitly separate accounts, verified end-to-end user behavior, and a controlled domain cutover.

## 6. Explicit auth UX runtime selection (code migration gate)

- `VITE_ATLAS_AUTH_RUNTIME` may be `lovable` (existing preview; default for backward compatibility) or `supabase` (independent deployment). This is a **public build-time capability choice**, not a secret and not an authorization boundary. The server still validates sessions and ownership.
- Lovable mode preserves the current Google and Lovable-branded identity buttons, which use the existing Lovable Cloud Auth bridge, alongside Bonfire's Supabase custom OIDC flow.
- In Supabase mode the Lovable-branded sign-in path is **not offered**. Google sign-in uses `supabase.auth.signInWithOAuth({ provider: 'google' })` **only** when `VITE_ATLAS_GOOGLE_OAUTH_ENABLED=enabled` and the selected Supabase project's Google provider is configured. Otherwise hide it to avoid dead sign-in buttons. Email/password and Bonfire login still require their actual project-side setup; do not assume they work because buttons render.
- Explicitly set `VITE_ATLAS_AUTH_RUNTIME=supabase` on Railway **only when deploying a branch with this implementation**. Do not set it on the Lovable preview or expect the existing Lovable users' sessions to transfer. On a staged code change, verify both modes in CI and browser, and re-check PKCE OAuth callback and private API permissions against the environment's actual OIDC provider configuration.
- This **does not migrate or replace** the existing Lovable preview identity bridge, private user storage, OAuth clients or sessions. It removes a *UI-level assumption* that Lovable login is always available. The rest of auth parity remains an explicitly gated deployment task.

## 7. Historical independent staging checkpoint — November 21, 2026 (EST)

> **Historical record, superseded by Section 8.** The missing-key, empty-user, and unconfigured-OIDC statements below describe the November 21 checkpoint, **not today's state**. Do not treat their manual configuration instructions as current blockers.

**Exact-head evidence, not a production release:**

- Historical GitHub staging v3 head: `d95776c6ddcd601d563a83ffa8103f99c4a9630a`, after [PR #203](https://github.com/outlaw-dame/aura-social-atlas/pull/203) synchronized the three-file password authentication recovery from [mainline PR #201](https://github.com/outlaw-dame/aura-social-atlas/pull/201). Its exact-head [staging Node/Nitro checks (44978352368)](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/44978352368) and [PR #203 full Atlas/discovery checks (44978195063)](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/44978195063) passed. Predecessor CI also passed: [staging checks (44977740449)](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/44977740449) and [Atlas/discovery checks (44977740419)](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/44977740419).
- Railway `atlas-bonfire-client-staging / staging / atlas-web-staging` is explicitly pinned to that new SHA. Deployment `be9a4029-58af-45c4-a33b-5ab4e980380e` reported `SUCCESS`; its runtime logs report listening on port 3000. This establishes a server build/deployment and configured healthcheck, **not** a successful user session or externally verified Cloudflare browser response. Railway's source pin must be rechecked before acceptance; push-to-branch alone does not prove a deployment changed. Service has no public Railway-domain ingress.
- Dedicated Supabase project `nprmdytcoqiribpwedjc` is `ACTIVE_HEALTHY`. A read-only database permission audit confirmed **all 10 public `atlas_*` / `fedizen_*` tables have RLS enabled and no direct SELECT grant to either `anon` or `authenticated`**. The resulting `rls_enabled_no_policy` advisor notices are informational and expected for deliberately server-only tables; do not "fix" them by adding broad browser policies. The three reported unused indexes are not a reason to delete indexes in an empty staging database.
- Direct count query confirmed **0 `auth.users`**, **0 `fedizen_connections`**, **0 `fedizen_oauth_states`**. No end-to-end OIDC, API grant, owner isolation, private GraphQL A/B, logout or revocation exercise has run on this database.

**Remaining external configuration and acceptance gate:**

1. Railway staging web service still lacks `SUPABASE_SERVICE_ROLE_KEY`, verified by variable-name inventory. Set the **dedicated staging project's** secret key directly in Railway's secure variable UI; never into a `VITE_*` variable, chat, GitHub, CI logs or a different environment.
2. Configure a **dedicated Supabase Auth Custom OAuth/OIDC Provider** with identifier `custom:app-oidc`, issuer `https://fedizen.net`, scopes `openid profile email`, and a **dedicated Fedizen confidential OIDC client** with exact callback `https://nprmdytcoqiribpwedjc.supabase.co/auth/v1/callback`. This is under Supabase **Authentication → Sign In / Providers → Custom OAuth Providers**, **not** Third-Party Auth's external-JWT trust configuration. The Fedizen client ID/secret must enter only the secure provider form; verify the supported registration against the Fedizen operator before claiming the client exists. Official guide: https://supabase.com/docs/guides/auth/custom-oauth-providers .
3. Verify the staging Supabase Auth redirect allowlist contains `https://atlas-staging.damonoutlaw.xyz` and the exact callback/return URLs used by Atlas. Run real isolated account sign-in, a separate user-consented Fedizen API resource grant, and the six gated read-only diagnostics. Then perform authenticated A/B private visibility, anonymous denial, logout/revocation, account-switch and callback-origin/CSRF checks with disposable subjects. Record sanitized results in [issue #123](https://github.com/outlaw-dame/aura-social-atlas/issues/123).
4. Keep `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS` disabled, do not copy Lovable users/tokens into staging, and do not promote `#198` (staging-only diagnostic UI) or production DNS while the acceptance criteria remain unproven.

The **existing Lovable deployment remains a separate runtime with its own users and Supabase**, not a fallback authority for independent Atlas. A successful staging deployment is no authorization to migrate those users.

## 8. November 22, 2026 — live authentication and revocation deployment

### Independently verified source/infrastructure

- [#205](https://github.com/outlaw-dame/aura-social-atlas/pull/205) merged the **live Supabase session check** into `main`; [#206](https://github.com/outlaw-dame/aura-social-atlas/pull/206) backported **exactly four files** (same Git blob SHA as main) to the **actual** staging v3 branch. The old note claiming v2 was Railway's deployed branch was inaccurate.
- The session check uses `getClaims` for signed JWT validation and `auth.getUser(jwt)` for session liveness; Auth errors and mismatched users fail closed. Parallel calls coalesce and positive checks are cached for at most 15 seconds, bounded by JWT expiration. This is **bounded revocation latency, not instantaneous invalidation**.
- PR head [full Atlas/gateway CI #45036301330](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/45036301330) and exact merge-head [staging CI #45036522972](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/45036522972) both **SUCCESS**.
- Railway staging `atlas-web-staging` is now pinned to `1973bde8c064d107886c398e0d88abffb281384e`; deployment `f96a2e02-c1f5-4408-a580-d014f4713f9d` **SUCCESS**, Node server listening on port 3000. This supersedes the earlier valid session-fix deployment `750601dd-8444-4383-b398-1b5de24abf6e`. The service may auto-sleep when idle, which is not a crash. No public Railway origin domain.
- Connected Railway variable-name inventory includes `SUPABASE_SERVICE_ROLE_KEY`; no privileged secret values were inspected. Public Cloudflare ingress `https://atlas-staging.damonoutlaw.xyz/auth` rendered the Fedizen sign-in option in an independent Browser Rendering smoke test.

### Live observations and remaining acceptance

The [November 22 operator acceptance record](https://github.com/outlaw-dame/aura-social-atlas/issues/123#issuecomment-7078294581) observed:
- Successful staging Fedizen `custom:app-oidc` sign-in and separately consented delegated resource grant.
- Following/activity and owner post reads working.
- All eight tested private functions refusing no-token anonymous requests.
- **A real security defect:** after sign-out, an old signed access JWT still reached private handlers even though Supabase Auth `/user` rejected it. PR #205/#206 fixes the code and the deployment; this *specific live replay has not yet been rerun on the fixed build*.

The [November 22 engineering release checkpoint](https://github.com/outlaw-dame/aura-social-atlas/issues/123#issuecomment-7081091438) records the exact CI, SHA, deployment and remaining tests. Do not close issue #123 or enable `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS` until authenticated post-fix replay plus **two independently consented A/B private API principals** pass with sanitized evidence. Manual Fedizen UI A/B testing from earlier remains acknowledged, but does not substitute for API isolation.

Staging-only [PR #207](https://github.com/outlaw-dame/aura-social-atlas/pull/207) was merged after [full Atlas/gateway CI #45038433471](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/45038433471) **SUCCESS**; exact staging merge-head [CI #45038680908](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/45038680908) **SUCCESS**. It adds a deliberate one-click 18-second post-sign-out test of eight representative private server functions, holding the former JWT only in an ephemeral browser callback; it renders only sanitized denial/acceptance/inconclusive outcomes. The public [staging diagnostic route](https://atlas-staging.damonoutlaw.xyz/fedizen-acceptance) rendered correctly while signed out through Cloudflare Browser Rendering. **The actual signed-in post-logout replay is still unperformed; implementation, CI and anonymous route smoke test are not live revocation proof.**

No live Lovable account/tokens/data were migrated, no production release domain was cut over, and staging-only [PR #198](https://github.com/outlaw-dame/aura-social-atlas/pull/198) stays open.
