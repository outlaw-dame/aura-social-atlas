# Atlas Bonfire client — isolated GitHub/Railway staging

**Status:** staging infrastructure partially configured, not live-authorized. This document covers the long-lived `staging/atlas-bonfire-client` branch only. Production Atlas and the separate Fedify discovery gateway are not in scope.

## Owned resources (2026-11-10)
- GitHub canonical source: `outlaw-dame/aura-social-atlas`; staging branch `staging/atlas-bonfire-client`.
- Railway project: `atlas-bonfire-client-staging` (`74c7ecfc-222c-455d-ab23-1c64449c8807`), environment `staging` (`20af7761-b3c0-44e1-8d9b-59fa271589c3`).
- Railway `atlas-web-staging` service (`2e85109c-6fe0-4296-a848-faa74e14bddf`) is now connected to GitHub branch `staging/atlas-bonfire-client` and deployed successfully at commit `c02812105b24677a29306027b023dda75bfd2f3f`, deployment `c7589419-2a84-471b-882a-220b524fa639`. Runtime reports Node server listening on port 3000. **Authenticated operations are not accepted as production-ready:** server-only Supabase key and OIDC configuration remain incomplete.
- Existing independent Fedify gateway Railway project `atlas-discovery-gateway` is unchanged.
- Existing Lovable **isolated** staging preview is still available for browser diagnostics and has its own backend; do not reuse its service keys in Railway or assume they are exportable.
- Supabase project `atlas-fedizen-staging` (`nprmdytcoqiribpwedjc`) is provisioned and healthy, PostgreSQL 17.11; three base Atlas migrations plus staging-only ownership and trigger-privilege hardening are applied with zero users and credentials.

## CI registry
The [staging-only Node build workflow](../.github/workflows/atlas-bonfire-staging.yml) is registered on `main` through PR #126 without deploying staging code. Staging branch pushes now run its targeted authorization tests and Nitro Node build, while the ordinary Atlas and gateway CI also runs on the draft staging PR.

## Host runtime
Atlas is TanStack Start/Vite with Lovable's vite-tanstack-config plugin, whose default Nitro target is not a Railway Node server. For Railway, use `NITRO_PRESET=node-server` at build time and `node .output/server/index.mjs` as the start command (a `start` script is included on staging branch). Set Node.js 22, `NODE_ENV=production`, `HOST=0.0.0.0` and `PORT=3000`. The CI workflow runs the same Node-target build using **dummy publishable values**, without deployment or private credentials.

## Safe configuration order
1. Confirm the free staging Supabase project cost and create it in the chosen organization. **Never use existing user or production databases.**
2. Prepare a migration audit against the existing `drizzle/migrations` before applying schema. Verify the ownership/RLS policies for `fedizen_connections`, `fedizen_oauth_apps`, and `fedizen_oauth_states`, with service-role access server-only. Do not apply quarantined `drizzle/reviewed-not-applied` changes without approval and tests.
3. Configure a custom OIDC provider `custom:app-oidc` using Fedizen issuer `https://fedizen.net`. Register a **new** Fedizen OIDC app with the **exact callback URL shown by the staging Supabase provider settings**; keep its client secret in Supabase Auth's protected provider configuration. Do not reuse existing Atlas OAuth credentials or use delegated `read` tokens for identity sign-in.
4. Configure staging Railway frontend **public build-time** variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Configure server-only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` through Railway's secret store (never commit them). Ensure build-time public keys refer to the **same staging** project. Do not print secrets in job logs.
5. Only then attach the staging branch to the Railway service, build with the Node preset, and create a temporary Railway HTTPS domain. Verify a standalone HTTP 200 health endpoint, correct SSR behavior, browser OAuth origin, and no SSR secret leaks. Define an exact callback origin allowlist `ATLAS_FEDIZEN_CALLBACK_ORIGINS` after the staging hostname exists. Avoid caching authenticated endpoints in Cloudflare.
6. Use a disposable Atlas login and explicit Fedizen delegated `read` consent through the existing application flow. Run the staged `/fedizen-acceptance` diagnostic manually. Expect sanitized identity, profile, feed, notification, and anonymous denial results; a generic GraphQL error with HTTP 200 is **not** conclusive denial.
7. Complete independent A/B private-post API authorization (owner reads, unrelated B and anonymous denied). This is separate from the previously completed UI/manual visibility test. Do not enable `ATLAS_BONFIRE_NATIVE_GRAPHQL_READS=verified` without this evidence. Protect session mapping and RLS from IDOR across account switches and logout.
8. After CI and acceptance, consider a controlled promotion strategy. **Never automatically merge or deploy staging-only routes or secrets into production**. Remove or restrict the acceptance diagnostic before general release.

## Safety/cost controls
Staging is on the existing Railway Hobby workspace; an extra running service incurs use-based charges. The web service is not started without working staging-only credentials. No additional Railway Postgres is needed for the Bonfire client: Supabase Auth/PostgreSQL remains the application account store; Bonfire owns social content. The Fedify gateway keeps its own independent Postgres. Prefer one shared staging web service, no extra cache or queue, bounded read retries, and no periodic expensive probes.

Use the official Railway TanStack guide and Supabase custom OAuth/OIDC guide for runtime and identity details. Keep GitHub CI as a release gate; a successful offline workflow does not prove live Fedizen permissions.

## Provisioning and security verification — 2026-11-10

- Supabase staging project: `atlas-fedizen-staging`, reference `nprmdytcoqiribpwedjc`, US East 1, PostgreSQL 17.11, active/healthy. Quoted project price $0/month and explicitly approved.
- The repository migrations `0000_create_profiles`, `0001_migration`, and `0002_fedizen_connections` were applied to **this empty staging project** and verified in Supabase migration history.
- The CI-reviewed, formerly quarantined `0003_fedizen_oauth_ownership.sql` was applied **only to new zero-user staging** under migration name `staging_only_fedizen_owner_constraints`; the production migration remains quarantined and unapplied.
- Staging-only `staging_only_profile_trigger_privilege_hardening` revoked anon/authenticated `EXECUTE` on the SECURITY DEFINER signup trigger and anon reads on profiles. SQL is recorded in `drizzle/staging/0004_profile_trigger_grants.sql`, not production's migration journal.
- Security verification: three owner constraints exist, no orphaned grants (0 users and 0 OAuth states/connections), anon and authenticated cannot execute the privileged trigger; RLS enabled with no browser policies on all Fedizen token tables. Security advisors have only intentional info-level no-policy findings on these locked-down tables.
- Railway service has Node/Nitro build/start commands and has been deployed successfully from the staging GitHub branch. The staging Supabase URL and **publishable** keys are configured, as is the exact callback allowlist. Generated hostname: `https://atlas-web-staging-staging-3f822964.up.railway.app`. Edge CDN caching is disabled. Live external HTTP response has not been verified, but Railway reports successful runtime startup.
- **Missing server-side credential:** This Supabase connector exposes only publishable keys, not a dedicated service-role key. Securely place `SUPABASE_SERVICE_ROLE_KEY` from the **staging** Supabase dashboard into the **staging Railway service**. Never copy keys from production or put tokens in chat/GitHub.
- **Missing OIDC provider:** Supabase Authentication > Providers > Custom OAuth/OIDC must register an independent `custom:app-oidc` with issuer `https://fedizen.net`. Bonfire client registration must use the exact new staging callback `https://nprmdytcoqiribpwedjc.supabase.co/auth/v1/callback` (verify against Supabase provider form). Scopes `openid profile email`. This is not the separate delegated API `read` consent.
- **Missing Auth redirect configuration:** add the generated Railway staging origin to the new Supabase Auth redirect URLs/site URL, not to production's.
- The Node CI workflow was registered on main; PR #127 adds a staging draft PR trigger. Verify that check before deploying.
- The full integration is still not live-authenticated; the existing Fedizen A/B manual UI observation remains completed, API-level proof remains outstanding.

## First Railway deployment verified (2026-11-10)

- GitHub staging CI: [Node build and security tests](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42932287019) passed; [Atlas and Fedify gateway checks](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42932287048) passed. Neither alone proves authentication.
- Railway deployment `c7589419-2a84-471b-882a-220b524fa639`: `SUCCESS`, Node listening on 3000, from staging commit `c02812105b24677a29306027b023dda75bfd2f3f`. The generated domain is Railway-managed; web search/fetch in this session did not independently verify a GET response, so do not claim end-to-end HTTP acceptance.
- Active blocking variable in service configuration: `SUPABASE_SERVICE_ROLE_KEY` is **absent**. No real Fedizen OAuth read grant can be persisted until a staging-only server key is securely configured. Do not inject production secrets.
- Staging OIDC custom provider is not registered; exact Supabase Auth callback and origin redirects must be configured in the new staging project. No real Fedizen identity authorization or A/B GraphQL API acceptance has run.

## Runtime and regional optimization verification
- The verified staged web release was reconnected to the GitHub staging branch at commit `d1e82882c589a5704a259acf630eb7b551961589`; Railway deployment `96c26008-ebd8-4599-9fe8-0ca3021fc7f1` finished **SUCCESS**, with an HTTP 200 root healthcheck configured.
- Railway's initially chosen US West placement was replaced with exactly one Virginia replica (`us-east4-eqdc4a`) next to Supabase's `us-east-1` project. This reduces typical database round-trip latency and avoids paying for extra replicas. No volumes were attached.
- Public HTTP GET from an independent web fetch remained unavailable; Railway's built-in healthcheck and deployment status were verified. The GitHub HTTP smoke job has been authored but has not yet produced a verified run, so it is not marked passed.
- New staging-only profile RLS initplan optimization `staging_profile_rls_initplan_optimization` was applied and retained in `drizzle/staging/0005_profile_rls_initplan.sql`. Subsequent Supabase advisors: performance 0 findings, health 0 findings, security 0 WARN/ERROR (3 intentional INFO notes on server-only token tables).
- **Still missing**: staging-only secret `SUPABASE_SERVICE_ROLE_KEY` and separate Bonfire OIDC provider/client registration. Do not treat successful deployment as a functioning OAuth or GraphQL acceptance result.
