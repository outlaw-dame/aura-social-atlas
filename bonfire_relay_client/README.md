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
  store) compiles and passes 29 offline ExUnit tests with Elixir 1.18.5 / OTP 27.
- `Federation.Bonfire` and `Store.Ecto` only compile inside a Bonfire host
  and have **not** been compiled against upstream. Three upstream patches
  (below) are still required.

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
| Content out | our public activities to relay inbox | relay pulls via its Follow of us |

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
- Dedup runs atomically per activity id (`ON CONFLICT DO NOTHING` in Postgres),
  so replays and concurrent duplicates are processed once.
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

1. **Inbox hook** — `bonfire_federate_activitypub/lib/adapter/adapter.ex`
   `handle_activity/1` (or the `ActivityPub` inbox controller after
   signature verification): call `Bonfire.RelayClient.handle_incoming/2`
   with `%{signer: verified_key_owner, activity: data, ld_verified_actor: ...}`
   **before** `Incoming.receive_activity/1`. If it returns anything other than
   `:not_handled`, stop there. The verified signer has to be exposed; today it
   isn't passed to the adapter.
2. **Public-object Follow** — `activity_pub/lib/activity_pub.ex` `follow/2`
   always sets `object` to the followed actor. Mastodon relays need
   `object: as:Public`, sent to the relay actor (`object_override` option).
3. **Extra inboxes** — `bonfire_federate_activitypub/lib/adapter/outgoing.ex`
   / the ActivityPub publisher must accept additional recipient inboxes, so
   `Federation.Bonfire.deliver/2` can queue signed delivery through Bonfire's
   own signer. Until then it returns `{:error, :upstream_publisher_hook_required}`.
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
