# Atlas Discovery Gateway

**Status: merged prototype on `main`; not deployed and not production-ready.** This is an independent ActivityPub **subscriber**, not the existing `relay/` relay server and not a native Bonfire extension.

The gateway runs on its own HTTPS origin with a service actor, durable PostgreSQL, Fedify-based signed Follow/Undo delivery and authenticated inbox handling, and a public read-only discovery API. It never uses Fedizen's signing keys or modifies Fedizen's database.

## Run locally

Requires Bun, PostgreSQL, and HTTPS for real remote federation. Copy `.env.example` into your own ignored `.env` and supply a secure `GATEWAY_ADMIN_TOKEN` (do not commit it).

```sh
cd discovery-gateway
bun install
bun run typecheck
# With GATEWAY_TEST_DATABASE_URL unset, PostgreSQL integration cases skip.
bun test src
bun run start
```

### Real PostgreSQL integration tests

The CI workflow starts a disposable PostgreSQL 16 service and runs both the
standalone tests and database/HTTP integration tests (including positive signed Accept, Create, and Announce tests as of
2026-11-06). To reproduce locally, use a **disposable test database**:

```sh
GATEWAY_TEST_DATABASE_URL=postgres://test:test@127.0.0.1:5432/gateway_test bun test src
```

The integration tests **TRUNCATE their gateway-owned tables** to ensure
isolation. Never supply the production gateway database, Fedizen's database,
or a database containing unrelated application tables. The tests verify real
actor response/key persistence, deduplication under concurrency, subscriptions,
Follow retry correlation, source filters, and read/admin HTTP responses.
The suite now exercises signed synthetic Accept, Create, and Announce through a real Fedify inbox, including independent origin fetching and original-author attribution. These fixtures prove internal signed processing only; they do not establish interoperability with external relay servers.

The browser frontend needs **only** `VITE_DISCOVERY_GATEWAY_URL=https://your-gateway-host`. Configure `GATEWAY_CORS_ORIGINS` on the gateway for the exact Atlas deployment origin. Keep the admin token on the gateway's server only, never in `VITE_*` variables.

## API

- `GET /healthz` returns database health.
- `GET /api/v1/items?limit=15&cursor=&tag=&domain=&q=` returns `{items,nextCursor}` from verified stored content. No demo records.
- `GET /api/v1/facets` returns observed tags and domains.
- `GET /admin/subscriptions`, `POST /admin/subscriptions`, `DELETE /admin/subscriptions/:id`, `POST /admin/subscriptions/:id/retry`: all require `Authorization: Bearer <admin token>`. The admin API has no cross-origin browser access and should be restricted to a private network or operator-only gateway.

## Inbound federation admission control

Federation POST requests have a separate **per-process** admission bucket (`GATEWAY_FEDERATION_RATE_LIMIT`, default `600` requests/minute), enforced before buffering the body or invoking Fedify signature verification. Requests over the limit receive HTTP 429 and `Retry-After: 60`. The bucket is deliberately shared rather than trusting user-controlled forwarding headers; bursts from one sender can affect other senders. This is a resource-exhaustion safeguard only, **not** a distributed rate limit, fair per-sender quota, or a replacement for edge/WAF controls. Configure and load-test for your deployment before exposure.

## Security and production blockers

The service uses Fedify's verified inbox processing and HTTPS document loaders that reject private network addresses. For Announce activities the original object must be independently fetched from origin, and matching an accepted **actor ID**, not merely its hostname, is required. Stored content is text-only with original-author provenance.

**This is not yet production ready.** External-server signed interoperability, database migration/restart tests, publication provenance, server-to-server Delete authorization, key rotation, moderation, redirect/DNS rebinding protection at the egress layer, rate limits across multiple instances, and deployment backup/restore have not been verified. Mastodon-style relay delivery of originals needs separate verification (original-author LD signatures / source route); original Create activities not made by the subscribed relay are currently rejected rather than trusted. FediBuzz selective-actor and LitePub-style Announce are the initial supported design targets.

The gateway cannot cause remote posts to enter Bonfire's native timelines. Phase 2 requires a supported Bonfire ingestion hook that checks original-author authenticity and instance moderation before writing content. See `../bonfire_relay_client/`. No direct writes to `fedizen.net`.
