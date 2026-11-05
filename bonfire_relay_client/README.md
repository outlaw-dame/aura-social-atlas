# bonfire_relay_client (optional, not installed)

An opt-in Elixir extension that lets a **Bonfire** instance subscribe to
ActivityPub relays using either the **Mastodon** or **LitePub** protocol
(FEP-ae0c). It lives in the Atlas repo only because we have no writable
`bonfire-networks` checkout.

**Status — read this first**

- Not installed on Fedizen. Fedizen does **not** support relays today.
- Off by default (`enabled: false`, `outbound_enabled: false`). Nothing
  subscribes, follows or deploys automatically; only an admin calling
  `Bonfire.RelayClient.subscribe/3` starts a subscription.
- The pure core (config, URLs, protocol, policy, state machine, in-memory
  store) compiles and passes 43 offline ExUnit tests with Elixir 1.18.5 / OTP 27.
- `Federation.Bonfire` is **fail-closed**: follow, fetch, ingest, deliver and
  announce return `{:error, {:upstream_hook_required, name}}` until the
  upstream hooks below exist, so subscribing through it fails before
  anything is sent. It and `Store.Ecto` only compile inside a Bonfire host
  and have **not** been compiled against upstream.

Separate from `../relay/` (a Fedify relay *server*) and from the Atlas web app.

## How it works

```text
Remote relay ──HTTP-signed POST──▶ Bonfire inbox (verifies signature)
                                        │  signer = verified actor id
                                        ▼
                      Bonfire.RelayClient.handle_incoming/2
                       │ not a subscribed relay → :not_handled (normal path)
                       ├ control plane: Accept / Reject / Follow / Undo
                       └ data plane: Policy.inbound → fetch from origin → Incoming
```

### Protocols

| | Mastodon | LitePub |
|---|---|---|
| Our Follow `object` | `as:Public` | relay actor |
| Relay reply | Accept/Reject | Accept + reciprocal Follow (we Accept only from the pinned relay actor) |
| Content in | original `Create`/`Update` (LD-signed) | `Announce{object: id}` |
| Content out | original public activity to relay inbox | service actor `Announce`s public `Create`s, only after the relay's reciprocal Follow is accepted; other types are reported as `skipped` |

The protocol is fixed per subscription. A reply shaped like the other
protocol is refused, never silently switched.

### Safety rules (enforced in `Policy` + `Bonfire.RelayClient`)

- Only the **HTTP-signature-verified signer** decides whether this is a relay;
  `actor` fields in the body are never trusted.
- Accept/Reject must come from the pinned relay actor and reference **our**
  Follow id (and, if it's embedded, the right Follow object).
- Inbound content must be addressed to `as:Public` (both activity and object).
  Followers-only, direct and recipient-less content is dropped.
- Embedded objects are **never** ingested on the relay's word. We re-fetch by id
  from the object's own origin and check id, author origin and public
  visibility. The only exception is an original whose LD signature Bonfire
  verified for that **same** actor.
- Cross-origin actor/object/activity ids, spoofed `attributedTo`, relay-authored
  objects, stale/future `published` and unsupported types are dropped.
- The relay is never treated as the author or booster: content is ingested
  with `relayed_by` set and `trusted_relay: false`.
- Subscribe is persist-before-send: the Follow id is minted first, the
  `:pending` row is committed (unique per relay), then the Follow is queued.
  Early Accepts find their state, concurrent requests send one Follow, and a
  queue failure marks the row `:failed` so a clean retry is possible.
- Inbound dedup is a durable claim with status. `claim` returns `:claimed`,
  `:in_flight` (another worker's lease is live) or `:done`. Success or a
  permanent rejection completes the claim; transient fetch/ingest errors
  release it so a redelivery retries. Expired leases can be taken over
  (single atomic `INSERT … ON CONFLICT DO UPDATE … WHERE` in Postgres).
- Outbound: only public `Create/Update/Delete/Announce` authored on the local
  host go out, and only to **accepted** Mastodon relays when `outbound_enabled: true`.
- URLs: https only, port 443, no userinfo or fragments, no IP literals or
  localhost/`.local`/`.internal`. Network-level SSRF protection is left to
  Bonfire's HTTP client.

## Integration into Bonfire

1. Add the dependency in Bonfire's `deps.flavour.path` / `mix.exs`:
   `{:bonfire_relay_client, path: "extensions/bonfire_relay_client"}`.
2. Copy `priv/repo/migrations/*` into Bonfire's migrations and run them.
3. Configure:
   ```elixir
   config :bonfire_relay_client,
     enabled: false,                       # flip only when ready
     outbound_enabled: false,
     allowed_relay_hosts: ["relay.example.org"],
     local_actor_username: "relay"         # Bonfire service actor
   ```
4. Build the context:
   `%{config: cfg, store: {Bonfire.RelayClient.Store.Ecto, Bonfire.Common.Repo}, federation: Bonfire.RelayClient.Federation.Bonfire}`.

### Upstream touchpoints (patches required in bonfire-networks)

Each one maps to a `{:upstream_hook_required, name}` in `Federation.Bonfire`.

1. **Inbox hook** (`bonfire_federate_activitypub/lib/adapter/adapter.ex`
   `handle_activity/1`, or right after signature verification in the
   ActivityPub inbox). Call `Bonfire.RelayClient.handle_incoming/2` with
   `%{signer: verified_key_owner, activity: data, ld_verified_actor: ...}`
   before `Incoming.receive_activity/1`. Stop unless it returns
   `:not_handled`. Today the verified signer is not passed to the adapter, and
   `ld_verified_actor` must be set only when the LD signature verifies for
   the activity's `actor`.
2. **`follow_with_preminted_id`** (`activity_pub/lib/activity_pub.ex`
   `follow/2`). It needs an `id:` option, so the subscription is stored before
   sending, and an `object_override: as:Public` option for Mastodon relays.
3. **`publisher_extra_inboxes`**: the publisher must accept extra recipient
   inboxes, so the original activity can be signed by Bonfire and sent to
   Mastodon relays.
4. **`fetch_without_ingest` / `incoming_relayed_object`**: we need two things.
   - A fetch that returns the data from its origin without inserting it, so
     `Policy.verify_fetched/2` runs first.
   - An `Incoming` entry point that takes the verified data with
     `relayed_by` set and never treats the relay as the author or booster.

   `receive_activity/1` expects an `ActivityPub.Object` from the verified
   pipeline, not a plain map.
5. **`service_actor_announce`**: `ActivityPub.announce/2` from the service
   actor, addressed to as:Public plus the relay inbox (for LitePub).

No raw POSTs are made anywhere in this package.

Upstream has relay-actor corruption tests and a Fedify interop tester
(`lib/testing/tester/fedify_tester/`) but no relay *subscription* support. The
Fedify tester is the right place for real interop tests against `../relay/`
once patches 1–3 land.

## Admin usage

```elixir
Bonfire.RelayClient.subscribe("https://relay.example.org/actor", :mastodon, ctx)
Bonfire.RelayClient.unsubscribe("https://relay.example.org/actor", ctx)
```

## Development

```sh
mix compile --warnings-as-errors && mix test && mix format --check-formatted
```

Tests are offline and use `test/support/fake_federation.ex`. Not yet tested:
real Bonfire compile, Ecto store against Postgres, live interop with
`../relay/` or any public relay, LD-signature verification (delegated to Bonfire).
