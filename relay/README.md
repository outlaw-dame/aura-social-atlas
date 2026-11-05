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
| Open relay abuse | Exact-host allowlist on subscription (Follow); content is accepted only from servers with a **currently accepted subscription**. Others get `Reject` / `403`. |
| Private posts leaking | Only **public** content is relayed (see *Forwarding policy*). Followers-only, direct, `bto`/`bcc` and unaddressed activities are never forwarded. |
| Forged activities | Fedify verifies the HTTP signature (or LD signature / object proof) and that the signer owns `actor`; the forwarding policy then runs on that verified activity. Claimed fields alone never authorize anything. |
| Signature integrity | Inbound bodies are forwarded as the **exact original bytes** with original headers; never re-serialized. |
| Oversized bodies | `Content-Length` checked, then the stream is read with a hard byte cap and cancelled on overflow (`413`). Bun's `maxRequestBodySize` also applies. |
| SSRF / redirects | All remote fetches use Fedify's loaders with `allowPrivateAddress: false` (every hop's resolved IPs are checked), `RELAY_MAX_REDIRECTS` (default 3) and a total timeout. |
| DNS rebinding | Fedify 2.4 resolves, validates and then **pins** the IP for each request/hop (requests go to the IP literal with the original `Host`), closing the check-then-connect gap for its own fetches. Defence in depth still applies: **Also block private/link-local/metadata ranges (e.g. 169.254.169.254, 10/8, 172.16/12, 192.168/16, fc00::/7) with an egress firewall.** |
| Config mistakes | Numeric limits must be whole numbers in range; https-only origin; postgres URL required outside dev. |
| Information leaks | `/healthz` returns only `{"ok":true|false}` (DB ping). Logs contain event names and hostnames only — no bodies, headers, signatures or keys. |
| Durability / retries | `PostgresKvStore` (keys, followers) and `PostgresMessageQueue` (delivery queue with Fedify's retry/backoff). Tables are created at startup; connections close on SIGTERM/SIGINT. |

## Two instances, two origins

Mastodon and LitePub relays use different subscription semantics. Run **one process per protocol**, each with its own
origin, database and key pair:

| Instance | `RELAY_PROTOCOL` | Example origin | Fedizen admin subscribes with |
| --- | --- | --- | --- |
| A | `mastodon` | `https://relay-mastodon.example.com` | the **shared inbox** URL printed at startup (`getSharedInboxUri()`, currently `/inbox`) |
| B | `litepub` | `https://relay-litepub.example.com` | the **relay actor** URL printed at startup (`getActorUri()`, currently `/users/relay`) |

Always copy the `subscribeWith` value from the startup log rather than typing a path: it comes from the library's
`getSharedInboxUri()` / `getActorUri()` and will follow any future path change.

Never point both at the same origin or database — their actor keys and follower lists must stay separate.

## Setup

Requirements: Bun ≥ 1.1, PostgreSQL ≥ 13, TLS-terminating reverse proxy (Caddy/nginx) or a platform with HTTPS.

```sh
cd relay
bun install
cp .env.example .env    # edit per instance
bun install --frozen-lockfile   # exact pinned versions from bun.lock
bun run test            # 83 tests; all network access is disabled by test-preload.ts
bun run typecheck (from the repo root, run app tests with `bun test ./src` so relay tests are not picked up without their deps)
bun run start           # reads env; refuses to start if unsafe
```

Startup logs a line like `{"event":"relay.started","subscribeWith":"https://relay-mastodon.example.com/inbox"}`
(LitePub: `.../users/relay`).

## Forwarding policy

`@fedify/relay`'s `subscriptionHandler` only decides who may *subscribe*. The library itself does not require a sender
to be subscribed and does not check visibility, so this relay adds two layers in `src/visibility.ts`:

**Control plane** — `Follow`, `Undo`, `Accept`, `Reject` are handled by the library's handshake and are **not** required
to be addressed to Public. They must come from an allowlisted host. `Undo` must undo the sender's *own* Follow
(embedded `object.actor` equal to `actor`, or a same-origin reference); the library otherwise resolves the undone
Follow with `crossOrigin: "trust"`.

**Content** — `Create`, `Update`, `Delete`, `Announce`:

1. *Pre-filter (raw JSON, before Fedify)*: allowlisted host, sender's server currently subscribed (accepted), activity id
   present, Public in `to`/`cc` (`as:Public`/`Public` aliases accepted), no `bto`/`bcc`, and an embedded
   `Create`/`Update` object must be public too. Cheap rejection only — it trusts nothing.
2. *Authoritative (inside Fedify, after signature verification, via the relay's `deliverActivity` hook)*: the same host,
   subscriber and Public checks on the verified activity, plus
   - `Create`/`Update`: object same origin as the actor, not attributed to anyone else, and public;
   - profile `Update` of the signer itself: allowed (actors carry no addressing);
   - `Announce`: announced object fetched (SSRF-safe loader, cross-origin embeds refetched) and must be public — an
     unreachable or private object is dropped;
   - `Delete`: object must be on the actor's origin;
   - duplicate activity ids within 48 h are dropped (on top of Fedify's own inbox idempotency). The claim is atomic
     across processes: `KvStore.cas(key, undefined, …)`, which `PostgresKvStore` implements as one
     `INSERT … ON CONFLICT (key)` on the table's primary key. A store without `cas()` makes the relay refuse to relay.

`Move` and other types are never relayed. If a library upgrade removes the `deliverActivity` hook, the relay refuses to
start rather than run without the policy.

Mastodon-style mode forwards the original activity verbatim, so receivers can only verify it if it carries its own LD
signature or object proof; HTTP-signed-only posts are not forwarded (Fedify `skipIfUnsigned`). LitePub mode sends an
`Announce` of the object id, and receivers fetch the object from its origin.

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

- **No real server-to-server federation has been verified.** End-to-end tests run Fedify's real signature pipeline with
  generated keys, fake actor documents and a stubbed network; no live Mastodon/Bonfire/Pleroma instance, live PostgreSQL
  or real Fedizen subscription has been exercised.
- Whether Fedizen (Bonfire) sends LD-signed activities to Mastodon-style relays is unverified; if not, use LitePub mode.
- **Not ready for unattended production.** The policy hooks an undocumented internal method of `@fedify/relay`
  (`deliverActivity`). All `@fedify/*` packages are pinned to exactly 2.4.5 in `package.json` and `bun.lock`, startup
  refuses any other installed version, and a test fails if the hook disappears. Before running unattended, get a
  supported pre-forward/authorization hook upstream in `@fedify/relay` (or maintain a fork) instead of relying on this.
- Duplicate-claim race tests run against PGlite (real PostgreSQL SQL, executed one statement at a time) over the wire
  protocol with several independent pools. True parallel execution on a production PostgreSQL server is not tested here.
- Tests never touch the internet: `test-preload.ts` replaces `fetch` for every test file (POSTs captured locally,
  everything else throws). DNS lookups made by Fedify's address validation are not blocked.
- Subscriber membership is per **server host**: any authenticated account on a subscribed, allowlisted server may
  publish its own public posts. Narrower per-account rules would need an extra allowlist.
- Visibility is decided from AS2 addressing. A server that marks unlisted/quiet-public posts with Public in `cc` will
  have them relayed, which matches Mastodon relay behaviour.
- Fedify's document loader has no response-size cap; the timeout bounds it, and remote JSON-LD is parsed by Fedify.
- Allowlist is exact host only; add each permitted instance explicitly.
