# Atlas Discovery Gateway

**Status: prototype on an isolated feature branch. Not deployed.** This is an independent ActivityPub **subscriber**, not the existing `relay/` relay server and not a native Bonfire extension.

The gateway runs on its own HTTPS origin with a service actor, durable PostgreSQL, HTTP-signed Fedify inbox/outbox activity delivery, and a public read-only discovery API. It never uses Fedizen's signing keys or modifies Fedizen's database.

## Run locally

Requires Bun, PostgreSQL, and HTTPS for real remote federation. Copy `.env.example` into your own ignored `.env` and supply a secure `GATEWAY_ADMIN_TOKEN` (do not commit it).

```sh
cd discovery-gateway
bun install
bun run typecheck
bun test src
bun run start
```

The browser frontend needs **only** `VITE_DISCOVERY_GATEWAY_URL=https://your-gateway-host`. Configure `GATEWAY_CORS_ORIGINS` on the gateway for the exact Atlas deployment origin. Keep the admin token on the gateway's server only, never in `VITE_*` variables.

## API

- `GET /healthz` returns database health.
- `GET /api/v1/items?limit=15&cursor=&tag=&domain=&q=` returns `{items,nextCursor}` from verified stored content. No demo records.
- `GET /api/v1/facets` returns observed tags and domains.
- `GET /admin/subscriptions`, `POST /admin/subscriptions`, `DELETE /admin/subscriptions/:id`, `POST /admin/subscriptions/:id/retry`: all require `Authorization: Bearer <admin token>`. The admin API has no cross-origin browser access and should be restricted to a private network or operator-only gateway.

## Security and production blockers

The service uses Fedify's verified inbox processing and HTTPS document loaders that reject private network addresses. For Announce activities the original object must be independently fetched from origin, and matching an accepted **actor ID**, not merely its hostname, is required. Stored content is text-only with original-author provenance.

**This is not yet production ready.** Full signed interop, database migration/restart tests, publication provenance, server-to-server Delete authorization, key rotation, moderation, redirect/DNS rebinding protection at the egress layer, rate limits across multiple instances, and deployment backup/restore have not been verified. Mastodon-style relay delivery of originals needs separate verification (original-author LD signatures / source route); original Create activities not made by the subscribed relay are currently rejected rather than trusted. FediBuzz selective-actor and LitePub-style Announce are the initial supported design targets.

The gateway cannot cause remote posts to enter Bonfire's native timelines. Phase 2 requires a supported Bonfire ingestion hook that checks original-author authenticity and instance moderation before writing content. See `../bonfire_relay_client/`. No direct writes to `fedizen.net`.
