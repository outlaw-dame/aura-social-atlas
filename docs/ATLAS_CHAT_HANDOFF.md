# Atlas — New Chat Handoff and Continuation Brief

> **Prepared:** 2026-11-08 (America/New_York)  
> **Repository:** https://github.com/outlaw-dame/aura-social-atlas  
> **Primary product:** **Atlas**, a Bonfire client; **Fedizen** (`https://fedizen.net`) is the Bonfire Community test instance and intended future Fedizen-specific flavor.  
> **Status:** The implementation plan and capability matrix are merged. **Resume Phase A — Fedizen's actual GraphQL and auth contract.**  
> **This file is a point-in-time snapshot, not authorization to deploy, modify Fedizen, or assume later status. Always reread live state and current main.**

## 1. The one-paragraph project contract

Atlas is a high-quality user-facing **Bonfire client**, not a replacement Bonfire server or a generic standalone social backend. The instance at `fedizen.net` runs Bonfire Community (operator-reported `v1.1.0-rc.1`; exact live image/digest **not confirmed**) and is intended eventually to become its own Bonfire flavor. **Bonfire** is authoritative for identity, profiles, feeds, follow relationships, posts, replies, notifications, permissions/boundaries, moderation and native federation. Atlas's main client interface should be Bonfire's **GraphQL API** and use verified complementary Mastodon-compatible REST endpoints only when justified. **Fedify** is for an optional, separately operated **ActivityPub relay/discovery gateway** so Atlas can discover public relay content **without modifying Bonfire unnecessarily**. The gateway must never masquerade as a user's Bonfire Home, own their account graph, use Fedizen's signing keys/database or insert posts into Bonfire timelines without separately reviewed/approved native integration.

## 2. Authoritative living documents — read before changes

1. **[Phased implementation plan](ATLAS_IMPLEMENTATION_PLAN.md)** — canonical priority order, ten phases A–J, definition of done, proposed first ten PRs, sources.
2. **[Fedizen GraphQL capability matrix](BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md)** — status for candidate operations and required deployed-schema/auth evidence. **Upstream source is not proof that an operation is enabled on Fedizen**.
3. [Root README](../README.md) — product identity and architectural ownership.
4. [Contributor rules / AGENTS](../AGENTS.md) — strict Bonfire authority, optional gateway isolation, avoidance of drift/duplication.
5. [Project roadmap](../roadmap.md) — historical work plus links to active plan; past checkboxes are **not** proof of a live Bonfire client.
6. [Gateway README](../discovery-gateway/README.md), [gateway operations](../discovery-gateway/OPERATIONS.md), [disabled Phase 2 Bonfire bridge](../discovery-gateway/PHASE2_BONFIRE_BRIDGE.md), and [release issue #23](https://github.com/outlaw-dame/aura-social-atlas/issues/23) — **separate gateway** readiness.
7. [PR #73](https://github.com/outlaw-dame/aura-social-atlas/pull/73) — completed architecture drift correction.
8. [PR #74](https://github.com/outlaw-dame/aura-social-atlas/pull/74) — completed initial implementation plan and capability matrix.

At handoff verification, **GitHub main SHA**: `b9b6ce6d7c46bcafc7b49827deb803a2c16a114d`. The documents are present on `main`; never presume main hasn't advanced in the next chat.

## 3. Immediate next work — Phase A, not another generic gateway project

**Goal:** establish a verified, reproducible contract for **Fedizen's actual installed GraphQL schema and authenticated client operations**; then use it to implement the smallest vertical slice of a real Bonfire client. Avoid feature guesses, another backend framework or a new persistent database.

### A0 — Safety and fresh-state baseline
- [ ] Re-read the latest main branch, [plan](ATLAS_IMPLEMENTATION_PLAN.md), [matrix](BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md), open PRs, recent CI and any review feedback.
- [ ] Check that the present repo still has the documented source layout; verify the actual deployed frontend URL/owner without treating Railway **gateway** deployment as proof Atlas **client** is deployed.
- [ ] Do not log/exfiltrate OIDC/OAuth secrets, bearer values, database URLs, private age identity, user content or private schema data into repo/issue/chat.
- [ ] Work on an isolated named GitHub branch; add focused tests and review; avoid direct unreviewed commits to main.

### A1 — Fedizen public GraphQL read-only acceptance
- [ ] Verify `https://fedizen.net/api/graphql` with a **bounded, non-sensitive public** query and compare HTTP response, GraphQL `data` and `errors`, pagination and actual returned fields with current client code. If a connector can only fetch code but not execute a live GraphQL POST, document the limitation and use an authorized safe method—do not claim a test ran.
- [ ] Inspect the upstream public Bonfire schema as **candidate reference**, particularly `bonfire_social`, `bonfire_me`, `bonfire_search`, `bonfire_classify`, `bonfire_api_graphql`. Do not assume upstream `main` matches the running Fedizen Community image.
- [ ] Capture the real deployed GraphQL schema using **operator-approved introspection** or a sanitized on-host schema export if introspection is blocked. Track image digest, Co-op Cloud recipe revision, installed extension pins, schema hash and export date. Do not enable public introspection solely for development.
- [ ] Update each relevant matrix row to `observed-fedizen` only after actual evidence; include exact wire spelling, field types, args, selection sets, permission behavior and supported fallbacks. Unsupported/not-exposed stays explicit.

### A2 — Login and delegated resource authorization
- [ ] Audit `src/lib/bonfire-auth.ts`, `src/routes/auth.tsx`, `src/lib/fedizen.server.ts`, `src/lib/fedizen-feed.ts`, `src/components/social/FedizenFeed.tsx` and callback routes. They show *code*, not a confirmed live successful sign-in.
- [ ] Validate an end-to-end **consented** OIDC sign-in from Atlas to Fedizen, issuer/audience/state/PKCE/nonce as applicable, user mapping, session refresh, logout and account switching. Real account interaction requires authorized operator/user action; don't manufacture proof.
- [ ] Distinguish **OIDC identity login** (`openid profile email`) from **delegated OAuth access to Bonfire resource APIs**, including GraphQL; existing separate `read` scope Fedizen connection and server-only token storage may not authorize all GraphQL operations. Verify scopes, audience, expiry and behavior rather than assume.
- [ ] Probe read-only `me` and Home/notifications with an authorized test identity; show actual vs anonymous/denied responses, excluding private content and tokens from evidence. Confirm Atlas account ↔ Fedizen user ↔ ActivityPub actor identity consistency.

### A3 — First implementation PR after evidence
- [ ] Once a verified schema + auth path exists, create the **single typed, server-side GraphQL API boundary** recommended in Phase B (`src/lib/bonfire-graphql.server.ts` or equivalent). No scattered ad hoc fetch/GraphQL strings; no second account database.
- [ ] Implement robust `data` plus `errors` handling, schema/type validation, cancellation, pagination, bounded queries, safe read retry/backoff/jitter and accurate authorization failures. **Do not blindly retry mutations**.
- [ ] Convert one actual authenticated Bonfire read path—prefer `me` + personal Home—to the new adapter; preserve old working behavior until tested. Add mocked tests, privacy/IDOR and stale/race regression tests, and actual Fedizen acceptance evidence if authorized.
- [ ] Document unsupported GraphQL operations; allow a **verified, permission-consistent REST fallback** where necessary, but GraphQL-first overall.
- [ ] Update matrix status, plan checkboxes, PR CI and test evidence; don't check off Phases A/B/C simply because a transport wrapper exists.

**Next planned after A/B:** Phase C real Home, local/public feeds, posts, threads, profiles and notifications → Phase D server-backed publishing/replies, likes, boosts, bookmarks, follows and edit/delete (where actual API supports it) → remaining breadth/quality. Do not let gateway hardening once again displace those client milestones.

## 4. Source-level implementation audit / gaps

| Area | Source | Code seen | Missing verification/work |
| --- | --- | --- | --- |
| OIDC login | `src/lib/bonfire-auth.ts`, `src/routes/auth.tsx` | Bonfire/Fedizen custom OIDC provider via Lovable/Supabase | Real sign-in round-trip, session binding, refresh, logout, account-link policy |
| Public Bonfire content | `src/lib/bonfire.server.ts` | Public `feedActivities` GraphQL queries for `local` and `articles` | Deployed schema/GraphQL error semantics, pagination, stable read adapter |
| Personal read access | `src/lib/fedizen.server.ts`, `fedizen-feed.ts`, `FedizenFeed.tsx` | Separate OAuth PKCE registration/read scope; server-only bearer state; REST read flows | Real authorized consented user, Home/notifications correctness, scope and reconnect |
| Core UI | `src/components/social/Discovery.tsx`, `src/components/f7/AtlasMobileApp.tsx` | React and Framework7 surfaces with local demo catalogue | Convert sample follow/save and drafts into real Bonfire operations, transparently |
| Gateway client | `src/lib/discovery-gateway.ts`, `src/components/social/GatewayDiscovery.tsx` | Optional public relay results panel | Must remain separate from native Bonfire Home, no mandatory dependency |
| Independent gateway | `discovery-gateway/` | Fedify actor, private admin, web/worker, PostgreSQL and signed ingestion | **Gateway** production gates; not a new core Atlas backend |
| Other relay code | `relay/`, `bonfire_relay_client/` | Optional separate relay server and disabled host-specific Elixir integration | Do not deploy duplicate implementations or patch Fedizen without justified separate approval |

At handoff, **no full/near-full Fedizen GraphQL contract has been verified**. The capability matrix is a candidate upstream inventory, not an exact live schema. Major Bonfire client mutations are **not** implemented and validated against real Fedizen in Atlas; existing draft-only/local features must never be represented as publishing/following/saving remotely.

## 5. Infrastructure and recovery — preserve, don't rework casually

**Railway project:** `atlas-discovery-gateway`, project ID `79cd5600-41f5-454a-9024-22e4d0e3d6e3`; isolated **staging** environment ID `8215c5b6-bdca-44ba-8277-edfdfe38bef2`.

| Staging service | ID | Handoff state |
| --- | --- | --- |
| `gateway-web` | `eb0dcc84-f017-44af-8dba-afe1e4a8e330` | SUCCESS, pinned source `988b4673e134e936a1aa9f4312360fb69755a9f5` |
| `gateway-worker` | `7f26e606-79d2-40fd-b172-c77ab09a7ca0` | SUCCESS, same pinned source |
| `atlas-gateway-r2-backup-staging` | `cb2be3c4-0ac9-4f74-8a05-03b50c782203` | SUCCESS, same pinned source; daily cron `0 3 * * *` **UTC**, restart `NEVER` |
| `atlas-cloudflared-staging` | provider service | SUCCESS |
| `Postgres` | provider service | SUCCESS, dedicated private persistent database |

At handoff, Railway reports **all five services SUCCESS, no staged changes**. A gateway health probe had previously returned HTTP 200. Gateway HTTPS origin: `https://staging-gateway.damonoutlaw.xyz`, served via an outbound-only Cloudflare Tunnel, with private admin and worker/DB networking. The staging gateway is **not** a live Bonfire client deployment.

**Backup / recovery evidence from 2026-11-08:**
- Cloudflare account `96c9c5d8bdbf048cc9ccff02900d4e8b`; private R2 bucket `atlas-discovery-staging-backups`, objects under `gateway-staging/`.
- Real source PostgreSQL dump → `age` encryption → R2 uploaded ciphertext and JSON manifest. Object key `gateway-staging/20261108T191233Z-d0868ce29d0dc25f.pgcustom.age` and corresponding `.manifest.json`; encrypted bytes **16,469**.
- Cloudflare independent GET: ciphertext byte count matched manifest, SHA-256 recalculation **matched**. Railway log: `backup.dump_verified`, `backup.ciphertext_verified`, `backup.completed encrypted_bytes=16469`.
- User operated `atlas-restore-local.sh` on their **own Mac**, whose private `age` identity was kept offline; the user reported `PASS: Atlas live R2 backup decrypted and restored to a disposable PostgreSQL 18 database.` This is **operator-reported successful restore**, not direct connector observation. Local Docker credential-helper issue was bypassed via a temporary isolated `DOCKER_CONFIG`.
- **Never request, copy, publish, or upload** the private `~/.atlas-recovery/identity.txt`. Cloud storage and Railway must contain only the **public** age recipient.
- R2 bucket was configured with 30-day minimum object lock and 45-day expiry under prefix, but **future enforcement and recurring runs need periodic verification**. No claim that first automatic cron or independent monitor has fired until logs/object timestamps prove it.
- Created `Atlas R2 Backup Watch` automation ID `Automation_522b681536808191815f49f15aac2c07` scheduled at **05:00 UTC** daily (midnight EST / 1am EDT), following Railway backup cron 03:00 UTC (10pm EST / 11pm EDT). The task intends to confirm new archive+manifest/checksum and Railway *application* logs. **First successful monitoring run not verified at handoff.**
- **Do not interpret Railway deployment `SUCCESS` as backup success**: an earlier job reported `SUCCESS` while script logged `backup.refused_invalid_encryption_recipient`; another run failed R2 `CreateBucket` 403 until `RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true` was set. Require `backup.completed` and R2 object/manifest verification.
- There are **gateway** release blockers: independent outbound network egress controls, DNS rebinding/metadata deny, real in-flight queue recovery and rollback, rate limits, moderation/retention, alert delivery, representative load. Track in issue #23; do not silently treat them as client deliverables.

**Release and source pin nuance:** Github `main` at this handoff is newer than Railway's intentionally pinned gateway SHA. Do not auto-advance the gateway to match documentation-only commits, and do not casually roll back live Postgres, regenerate ActivityPub keys, create public admin ingress, or connect the gateway to Fedizen's DB.

## 6. Architectural invariants / anti-drift guardrails

- **Client-first:** GraphQL and working Bonfire user flows before further infrastructure embellishments.
- **Bonfire source of truth:** native post, feed, graph, profile and moderation state. Optional discovery index must not impersonate original authors.
- **No unauthorized Fedizen modifications:** no live Community patches, database migrations, relay subscriptions or native timeline insertion without operator approval, exact deployed build tests and rollback.
- **Separation of credentials:** OIDC identity, delegated Bonfire OAuth, Atlas own session, gateway admin, gateway actor signing keys and offline age recovery are distinct security domains.
- **GraphQL reality check:** extension-dependent effective schema + versioned capability matrix; first establish exact auth/fields; never fabricate endpoint, mutation, status or coverage.
- **No unnecessary services/libraries, duplicates or schema drift.** Use proven existing React/TanStack, Framework7 and available server-only code; new infra only for demonstrated need.
- **Quality:** validate input and output, enforce per-account isolation, privacy/security, cancellation and stale-state control, correct pagination, bounded backoff/jitter for safe operations, no silent retries of non-idempotent writes, explicit error states, real tests and review, CI stability, benchmark where useful.
- **Accuracy of evidence:** always distinguish intended, implemented, synthetic-tested, connector-deployed, and user-reported live verification. Do not infer success from a GitHub checkbox or deployment badge.

## 7. Specific carry-forward tasks / blockers

### Highest-priority client blockers
1. **Real Fedizen GraphQL effective schema** and exact enabled Community extensions/host digest remain unconfirmed.
2. **Real user sign-in** and separate delegated API GraphQL access have not been confirmed end to end.
3. Existing client is **not** near-complete: real Home, notifications, profiles, threads, publishing, replies, likes, boosts, follows, bookmarks and media workflows are missing or partial/scope-specific.
4. Existing app has demo catalogue/session-only save/follow actions and drafts; do not treat as native state.
5. Need version-pinned GraphQL interface, typed operations, tests, and strong auth/session handling.

### Parallel independent gateway blockers
- Confirm first **automatic** R2 backup and backup-watch execution only *after* scheduled times.
- Strict egress enforcement for untrusted ActivityPub fetches remains unresolved on Railway Hobby. Software DNS/redirect checks are not a complete network boundary.
- Validate real in-flight signed queue recovery, actor-key continuity and controlled rollback; do not jeopardize a live database.
- Moderation policy, retention scheduling, multi-replica rate limits and actionable alerts have release gates in issue #23.

**Avoid conflating the two workstreams.** The gateway can remain in staging while Atlas Bonfire client work proceeds.

## 8. Source references

- [Main repo](https://github.com/outlaw-dame/aura-social-atlas)
- [Bonfire maintainers: client API options](https://github.com/bonfire-networks/bonfire-app/issues/1260) — GraphQL is described upstream as primary/actively maintained; source is a recommendation, not runtime proof.
- [Bonfire GraphQL package](https://github.com/bonfire-networks/bonfire_api_graphql)
- [Bonfire social GraphQL source](https://github.com/bonfire-networks/bonfire_social/blob/main/lib/api/social_api_graphql.ex) — upstream candidates: feeds, posts, thread context, create/edit, follow, like, boost, bookmark, reports/subscriptions.
- [Bonfire me/account GraphQL source](https://github.com/bonfire-networks/bonfire_me/blob/main/lib/api/me_api_graphql.ex)
- [Bonfire search GraphQL source](https://github.com/bonfire-networks/bonfire_search/blob/main/lib/api/search_api_graphql.ex)
- [Bonfire group/classification GraphQL source](https://github.com/bonfire-networks/bonfire_classify/blob/main/lib/graphql/schema.ex)
- [Bonfire GraphQL documentation](https://docs.bonfirenetworks.org/Bonfire.API.Graphql.html)
- [Gateway release gate issue #23](https://github.com/outlaw-dame/aura-social-atlas/issues/23)

## 9. Ready-to-paste kickoff for the next ChatGPT conversation

> **Continue Atlas using the handoff in `docs/ATLAS_CHAT_HANDOFF.md`, the canonical `docs/ATLAS_IMPLEMENTATION_PLAN.md` and `docs/BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md` from `outlaw-dame/aura-social-atlas`. Atlas is a Bonfire client tested against Fedizen, intended to become a Fedizen flavor; Fedify is only the optional public relay discovery extension. First verify current main, open PRs/CI and effective API capabilities. Proceed directly with Phase A (Fedizen runtime schema and delegated-auth contract) using read-only, safe verification; update the matrix and implement the next small, tested client change when supported. Keep Fedizen/Bonfire authoritative, avoid redundant infrastructure, keep live gateway/backup intact, and never claim a test or runtime behavior not actually verified. Work to high security, performance, error-handling, testing and non-drift standards. Give me completed deliverables, evidence and remaining blockers rather than generic plans.**

---

**Maintenance:** This is a **handoff**, not the sole evolving roadmap. The next chat should update this file's date, repo SHA and new evidence only if they materially change. Keep the authoritative checklist in the implementation plan and capability matrix; do not create competing plans.

## 10. Post-handoff Codex review audit (2026-11-08; after original snapshot)

The operator noticed historical Codex review findings after this handoff was prepared. An audit covered PRs #47–#76 and distinguished resolved reviews from genuine outstanding issues. **[PR #76](https://github.com/outlaw-dame/aura-social-atlas/pull/76)** was merged to `main` at `05441239fb503e10f44c15aefa57a1afcb9d6c1c` and fixes the following:

- **#65**: unsafe retention DSN substring validation → explicit private Railway authority and reject libpq host/hostaddr/service overrides.
- **#66**: fingerprint-only updates skipped the staging workflows → both PR paths now include the pinned fingerprint file.
- **#67**: recovery could accept an effective public host or nonempty targets with only functions/types/etc. → strict URI validation and PostgreSQL catalog-based empty-target checks.
- **#71**: original P1 Bash function-expression error was fixed in its original PR; #76 further closes remaining DSN query-override exposure.
- **#76**: Codex caught an additional schema-name bug in the initial fix (`LIKE 'pg_%'` excluded `pgdata`); fixed by excluding only known PostgreSQL system namespaces, with an actual PG18 regression test for a `pgdata` user schema and a function-only database. Codex review thread acknowledged and resolved.

On #76's final test commit `23186532efc69ea0f138e8b48ee30c6533d5b642`, GitHub Actions runs **42535956417** (encrypted backup and independent restore), **42535956444** (retention), **42535956443** (gateway/Atlas checks), **42535956401** (availability monitor) and **42535956461** (public HTTPS smoke) all passed. The four older review threads in #65–#67 and the #76 thread were replied to and marked resolved. Previous #47, #51, #54 and #55 review threads were already resolved; #55's affected `src/lib/groups.server.ts` is no longer present on main.

**Operational constraint:** #76 is code and CI only; the running Railway backup, web and worker remain intentionally pinned to `988b4673e134e936a1aa9f4312360fb69755a9f5` at verification. **Do not silently redeploy** the gateway or backup job to the new main; the stricter DB URI grammar rejects query/fragment parameters, so first confirm the configured Railway DSNs are compatible using a safe preflight without displaying secrets and ensure the next cron/archive integrity proof still passes. The current task to resume remains **Atlas client Phase A (Fedizen GraphQL/auth)**, not more gateway changes.
