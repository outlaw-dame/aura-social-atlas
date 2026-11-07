# Atlas Discovery Gateway

**Status: merged prototype on `main`; not deployed and not production-ready.** This is an independent ActivityPub **subscriber**, not the existing `relay/` relay server and not a native Bonfire extension.

The gateway runs on its own HTTPS origin with a service actor, durable PostgreSQL, Fedify-based signed Follow/Undo delivery and authenticated inbox handling, and a public read-only discovery API. It never uses Fedizen's signing keys or modifies Fedizen's database.

## Run locally

Requires **Bun 1.4.3 or newer**, PostgreSQL, and HTTPS for real remote federation. Earlier Bun runtimes are rejected at startup because they can bypass Fedify's pinned-address SSRF protection when proxy environment variables are set. Copy `.env.example` into your own ignored `.env` and supply a secure `GATEWAY_ADMIN_TOKEN` (do not commit it).

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

## Process roles and durable workers

The gateway now starts Fedify's PostgreSQL queue consumer explicitly and supervises its lifetime. Set `GATEWAY_ROLE` to `web`, `worker`, or `combined` (default). Invalid values fail at startup. The HTTP node accepts and enqueues signed activities, while the worker consumes inbound/outbound jobs. **Only the `web` service should be publicly routed; do not expose `worker` via a load balancer.** Both services must use the same `GATEWAY_ORIGIN` and dedicated durable PostgreSQL database, but neither should reuse Fedizen credentials.

For staging, `combined` is suitable for validating behavior on a single instance. For production, run separate `web` and `worker` processes under a restart-capable supervisor. The worker has no HTTP listener. Queue rejection or unexpected termination results in nonzero process exit for supervisor recovery. SIGTERM/SIGINT abort queue consumption and close PostgreSQL on graceful shutdown. Configure termination grace periods to cover in-flight work. **Do not run `web` without an independently healthy `worker`: the HTTP acknowledgement alone does not guarantee a message has been consumed.**

## API

- `GET /healthz` returns database health.
- `GET /api/v1/items?limit=15&cursor=&tag=&domain=&q=` returns `{items,nextCursor}` from verified stored content. No demo records.
- `GET /api/v1/facets` returns observed tags and domains.
- `GET /admin/subscriptions`, `POST /admin/subscriptions`, `DELETE /admin/subscriptions/:id`, `POST /admin/subscriptions/:id/retry`: all require `Authorization: Bearer <admin token>`. The admin API has no cross-origin browser access and should be restricted to a private network or operator-only gateway.

## Inbound federation admission control

Federation POST requests have a separate **per-process** admission bucket (`GATEWAY_FEDERATION_RATE_LIMIT`, default `600` requests/minute), enforced before buffering the body or invoking Fedify signature verification. Requests over the limit receive HTTP 429 and `Retry-After: 60`. The bucket is deliberately shared rather than trusting user-controlled forwarding headers; bursts from one sender can affect other senders. This is a resource-exhaustion safeguard only, **not** a distributed rate limit, fair per-sender quota, or a replacement for edge/WAF controls. Configure and load-test for your deployment before exposure.

## Outbound transport safety

Fedify **2.4.5** pins Node/Bun outbound connections to DNS addresses that passed its public-address validation, including every redirect hop. Atlas explicitly keeps `allowPrivateAddress: false` for the federation and for authenticated/unauthenticated document loaders, with configured redirect/time limits. The gateway refuses to start on Bun older than **1.4.3**, whose earlier proxy handling can defeat direct-connect controls. Do not replace Fedify-managed outbound paths with plain `fetch()` for remotely supplied URLs.

**Operator deployment requirements:** isolate the gateway on a dedicated network identity; apply host/VPC/container egress rules denying private, loopback, link-local, multicast and cloud metadata ranges on outbound application traffic while permitting required PostgreSQL and DNS infrastructure through separate narrowly scoped rules; default-deny unwanted ports; restrict administrator endpoints to a private network; do not provide unrestricted outbound proxies. Validate IPv4 **and** IPv6. Firewall enforcement, DNS-pinning behavior under real network conditions, and an audited gateway deployment are environment-specific and not proven by these unit tests.

## Controlled external actor preflight (explicit operator action)

After installing dependencies with **Bun 1.4.3+**, run one read-only actor discovery check:

```sh
bun run interop:probe tag knitting
bun run interop:probe instance fluffy.family
bun run interop:probe litepub https://your-controlled-relay.example/actor
```

This uses actual remote HTTPS lookups through the Fedify 2.4.5 protected loader, without creating a database, starting an inbox, signing, sending Follow or modifying any relay. It checks the resolved actor's canonical ID and same-origin inbox. Exit status 0 means *actor preflight passed*, **not** that federation delivery interoperates. The output deliberately contains no fetched document or authentication material.

**The full active interoperability gate remains:** deploy a disposable HTTPS gateway origin with its own database and keys, connect it only to a controlled staging relay, check Follow → Accept/Reject and LitePub reciprocal Follow → Accept, send signed public Create/Announce/Delete fixtures from that relay, verify audience, attribution, deduplication, unsubscribe/Undo and retries, then tear both systems down. Do not point this at Fedizen production. A non-public gateway cannot receive external asynchronous delivery, so the standalone probe cannot establish the full gate.

## Security and production blockers

The service uses Fedify's verified inbox processing and HTTPS document loaders that reject private network addresses. For Announce activities the original object must be independently fetched from origin, and matching an accepted **actor ID**, not merely its hostname, is required. Stored content is text-only with original-author provenance.

**This is not yet production ready.** External-server signed interoperability, database migration/restart tests, publication provenance, server-to-server Delete authorization, key rotation, moderation, environment-enforced egress network deny rules and DNS-rebinding tests, rate limits across multiple instances, and deployment backup/restore have not been verified. Mastodon-style relay delivery of originals needs separate verification (original-author LD signatures / source route); original Create activities not made by the subscribed relay are currently rejected rather than trusted. FediBuzz selective-actor and LitePub-style Announce are the initial supported design targets.

The gateway cannot cause remote posts to enter Bonfire's native timelines. Phase 2 requires a supported Bonfire ingestion hook that checks original-author authenticity and instance moderation before writing content. See `../bonfire_relay_client/`. No direct writes to `fedizen.net`.
