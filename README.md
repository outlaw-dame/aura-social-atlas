# Atlas — Bonfire client with optional federated discovery

Atlas is a user-facing **Bonfire client**. [Fedizen](https://fedizen.net) is the current Bonfire Community integration/test instance and is intended to evolve into its own Bonfire flavor. **Bonfire owns social identity, permissions, accounts, publication, follow graph, native Home, and moderation policy.** Atlas provides the user experience across web/PWA devices and uses supported Bonfire APIs.

The [Fedify-based discovery gateway](discovery-gateway/) is a separately deployed, optional **ActivityPub relay subscriber and discovery index**, designed to give Atlas access to public relay content without modifying Bonfire's database, inbox, signing keys, or user timelines. The gateway is **not** Atlas's primary social backend, a Bonfire replacement, or a mandate to integrate every discovered object into Fedizen.

## Current functionality (distinguish verified from planned)

- **Bonfire client:** Fedizen OpenID Connect sign-in integration; public Bonfire GraphQL articles/local feeds; separate read-only connected Fedizen account/feed integration. A completed live end-to-end sign-in and personal-feed acceptance test still requires a real authorized session.
- **Atlas UI:** browser and Framework7-based PWA surfaces. Existing sample creator catalogue, sample stories, local follow/save selections and draft-only composer are *prototypes*, not durable Bonfire social actions. Do not label them as synchronized with Fedizen.
- **Relay discovery (optional):** `discovery-gateway/` is the active staging path, with its own Fedify service actor, durable queue/PostgreSQL, Cloudflare Tunnel, read-only API and private administration. Public results appear in a distinct discovery panel, **not** Home.
- **Other relay experiments:** `relay/` is an independent optional relay-server experiment; `bonfire_relay_client/` is an inactive Bonfire Community Elixir adapter requiring host-specific upstream integration. Neither is required for Atlas's client MVP, deployed to Fedizen, or authorized to write native content.
- **Fedizen hosting:** Fedizen runs Bonfire Community under Co-op Cloud. No direct Bonfire database changes, forced instance relay subscription or live host patches are authorized by this repo.

## Living implementation checklist

- [Phased Atlas implementation plan](docs/ATLAS_IMPLEMENTATION_PLAN.md) — priorities, dependency graph, acceptance gates, ten initial PRs, client vs gateway ownership.
- [Bonfire GraphQL capability matrix](docs/BONFIRE_GRAPHQL_CAPABILITY_MATRIX.md) — candidate fields, live Fedizen verification status, permission contracts and version coverage.

## Implementation priority

1. **Verify actual user sign-in with Fedizen** (OIDC and session stability), then authenticated account profile, personal Home/notifications and token lifecycle. Keep auth tokens server-only; follow Bonfire's supported interfaces.
2. **Build honest native Bonfire client actions** (publish/edit/delete, reply, react, follow/unfollow, save where supported), one feature at a time, with real API capability checks, authorization, idempotency, error handling, user-visible state and integration tests. Do not turn fake local selections into claimed remote state.
3. **Integrate optional read-only Fedify discovery** via public gateway API, with unavailability isolated from sign-in, native feeds or posting. Preserve original author, origin, moderation, audience and subscription provenance.
4. **Only if needed and explicitly approved:** consider native relay-to-Bonfire ingest via a verified Bonfire extension and instance policy, requiring same-version Community tests and a provider-coordinated deployment. Never silently add gateway posts to native Home.
5. Complete production security, observability, backup/recovery and acceptance gates *for each deployed component* without expanding the gateway into a second general social platform.

See [architecture rules](AGENTS.md), [project roadmap](roadmap.md), [discovery gateway scope](discovery-gateway/README.md) and [disabled Phase 2 ingestion contract](discovery-gateway/PHASE2_BONFIRE_BRIDGE.md).

## Backend, hosting and source of truth

**GitHub owns Atlas's application code; Lovable is one existing hosting environment, not Atlas's sole backend.** Read the [runtime/backend ownership contract](docs/ATLAS_RUNTIME_OWNERSHIP.md) before configuring deployment, running migrations, or asking an agent to work on Atlas.

| Layer | Current owner |
| --- | --- |
| Bonfire social data, identity, permissions, posts, moderation and native federation | [Fedizen](https://fedizen.net) / Bonfire; Atlas is its client |
| Atlas server-side application logic | TanStack Start SSR/functions in **this repo** |
| Current Lovable preview and existing Atlas users | Lovable-hosted Workers app + **its own** managed Supabase/Auth |
| Independent Atlas staging | Railway Node/Nitro + **separate** Supabase project `nprmdytcoqiribpwedjc`; exposed through private Cloudflare Tunnel at [atlas-staging.damonoutlaw.xyz](https://atlas-staging.damonoutlaw.xyz) |
| Optional public relay discovery | `discovery-gateway/`: separate Fedify gateway, Railway and PostgreSQL, not a replacement for Bonfire |
| Intended product domain | `atlas-social.space`; **not yet a verified independent production cutover** |

**Important:** Staging currently uses a **pinned staging GitHub revision** and lacks the complete production-equivalent Supabase admin credential and Fedizen custom OIDC setup. The Lovable-backed application's user records and grants have **not** been migrated to the independent staging database. A successful GitHub merge does not automatically deploy to Railway; independently verify deployed SHA, secret presence, migrations and private API acceptance. Do not assume `.env`, `LOVABLE_DB_MIGRATION_URL`, or Lovable-generated clients identify the target for every environment.

## Local development

The existing Lovable preview was built with [Lovable](https://lovable.dev/projects/d3fdefe8-1c72-40dc-8fa6-0b966befbe5b); the **repository** contains the React/TanStack Start, TypeScript and Framework7 application, server handlers, schemas, tests and gateway. Lovable-specific build/auth integrations remain necessary **for that preview** until a separate migration is verified.

```sh
git clone https://github.com/outlaw-dame/aura-social-atlas.git
cd aura-social-atlas
npm install
npm run dev
```

The isolated `discovery-gateway/` has its own Bun/PostgreSQL toolchain and deploy runbook; running the Atlas frontend does not require running or installing the gateway.
