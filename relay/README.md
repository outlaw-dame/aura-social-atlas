# Atlas Relay (optional, inactive by default)

An allowlist-only ActivityPub relay built on [`@fedify/relay`](https://fedify.dev/manual/relay) 2.4, supporting
**Mastodon-style** and **LitePub-style** relaying ([FEP-ae0c](https://fep.swf.pub/fep/ae0c/fep-ae0c.html)).

## What this is — and is not

- Atlas is a **client** of Fedizen. Fedizen (Bonfire) does the real federation. This relay does nothing for Atlas users
  unless a Fedizen administrator chooses to subscribe Fedizen to it.
- It is **not** part of the Atlas web app build and cannot run on Atlas's hosting (it needs a long-running process and PostgreSQL).
- Nothing here deploys itself or subscribes to anything. There is no outbound subscription code.
- It is never an open relay: startup fails without an explicit `RELAY_ALLOWED_DOMAINS`.

## Security model

| Concern | Protection |
| --- | --- |
| Open relay abuse | Exact-host allowlist on both subscription (Follow) and inbound posts; others get `Reject` / `403`. |
| Forged activities | Fedify verifies HTTP signatures and key ownership. The allowlist is only a pre-filter. |
| Signature integrity | Inbound bodies are forwarded as the **exact original bytes** with original headers; never re-serialized. |
| Oversized bodies | `Content-Length` checked, then the stream is read with a hard byte cap and cancelled on overflow (`413`). Bun's `maxRequestBodySize` also applies. |
| SSRF / redirects | All remote fetches use Fedify's loaders with `allowPrivateAddress: false` (every hop's resolved IPs are checked), `RELAY_MAX_REDIRECTS` (default 3) and a total timeout. |
| DNS rebinding | Mitigated by per-hop validation, but a check-then-connect gap is inherent. **Also block private/link-local/metadata ranges (e.g. 169.254.169.254, 10/8, 172.16/12, 192.168/16, fc00::/7) with an egress firewall.** |
| Config mistakes | Numeric limits must be whole numbers in range; https-only origin; postgres URL required outside dev. |
| Information leaks | `/healthz` returns only `{"ok":true|false}` (DB ping). Logs contain event names and hostnames only — no bodies, headers, signatures or keys. |
| Durability / retries | `PostgresKvStore` (keys, followers) and `PostgresMessageQueue` (delivery queue with Fedify's retry/backoff). Tables are created at startup; connections close on SIGTERM/SIGINT. |

## Two instances, two origins

Mastodon and LitePub relays use different subscription semantics. Run **one process per protocol**, each with its own
origin, database and key pair:

| Instance | `RELAY_PROTOCOL` | Example origin | Fedizen admin subscribes with |
| --- | --- | --- | --- |
| A | `mastodon` | `https://relay-mastodon.example.com` | the **shared inbox** URL printed at startup (`/inbox`) |
| B | `litepub` | `https://relay-litepub.example.com` | the **relay actor** URL printed at startup (`/actor`) |

Never point both at the same origin or database — their actor keys and follower lists must stay separate.

## Setup

Requirements: Bun ≥ 1.1, PostgreSQL ≥ 13, TLS-terminating reverse proxy (Caddy/nginx) or a platform with HTTPS.

```sh
cd relay
bun install
cp .env.example .env    # edit per instance
bun run test            # 28 tests, in-memory stores (from the repo root, run app tests with `bun test ./src` so relay tests are not picked up without their deps)
bun run start           # reads env; refuses to start if unsafe
```

Startup logs a line like `{"event":"relay.started","subscribeWith":"https://relay-mastodon.example.com/inbox"}`.

### Deploy checklist (each instance)

1. Create a dedicated PostgreSQL database and a least-privilege user (owner of that database only).
2. Set env from `.env.example` with a unique `RELAY_ORIGIN` and `DATABASE_URL`.
3. Put it behind HTTPS on that exact origin; forward the original `Host` and do **not** let the proxy rewrite or
   re-encode bodies (signatures cover the `Digest`).
4. Add an egress firewall that denies private and cloud-metadata address ranges.
5. Health check `GET /healthz` (200 = DB reachable, 503 = not).
6. Run under a supervisor (systemd, container restart policy). It handles SIGTERM gracefully.
7. Back up the database: losing it rotates the relay's keys and drops all subscriptions.

## Subscribing Fedizen (manual, admin-only)

This step is performed by the **Fedizen administrator**, not by Atlas:

1. Ensure `fedizen.net` is in `RELAY_ALLOWED_DOMAINS` on that instance.
2. In Fedizen's admin relay settings, add the URL from the table above for the chosen protocol.
3. The relay logs `subscription.approved` (or `subscription.rejected` for non-allowlisted hosts).
4. To leave, remove the relay in Fedizen's admin settings (sends `Undo Follow`).

Atlas's app code is unchanged by any of this: Atlas reads Fedizen through its GraphQL and Mastodon-compatible APIs.

## Known limitations

- Not verified against a live PostgreSQL or a real Fedizen subscription in this repository; tests use in-memory stores.
- Fedify's document loader has no response-size cap; the timeout bounds it, and remote JSON-LD is parsed by Fedify.
- Allowlist is exact host only; add each permitted instance explicitly.
