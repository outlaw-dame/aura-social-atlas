# Atlas Bonfire client — isolated GitHub/Railway staging

**Status:** staging infrastructure partially configured, not live-authorized. This document covers the long-lived `staging/atlas-bonfire-client` branch only. Production Atlas and the separate Fedify discovery gateway are not in scope.

## Owned resources (2026-11-10)
- GitHub canonical source: `outlaw-dame/aura-social-atlas`; staging branch `staging/atlas-bonfire-client`.
- Railway project: `atlas-bonfire-client-staging` (`74c7ecfc-222c-455d-ab23-1c64449c8807`), environment `staging` (`20af7761-b3c0-44e1-8d9b-59fa271589c3`).
- Railway empty `atlas-web-staging` service (`2e85109c-6fe0-4296-a848-faa74e14bddf`), not yet connected to a repo or public hostname. No application rollout should occur until the staging Supabase backend and secret configuration exist.
- Existing independent Fedify gateway Railway project `atlas-discovery-gateway` is unchanged.
- Existing Lovable **isolated** staging preview is still available for browser diagnostics and has its own backend; do not reuse its service keys in Railway or assume they are exportable.
- Supabase organization `outlaw-dame's Org` contains zero listed connector-visible projects at inspection. New project `atlas-fedizen-staging` quote was $0/month but Management API requires explicit cost-confirmation ID; **creation not yet completed**.

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
