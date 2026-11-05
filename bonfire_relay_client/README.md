# bonfire_relay_client (optional, not installed)

An opt-in Elixir extension that gives a **Bonfire** instance admin-managed
relay subscriptions, like Mastodon's *Admin → Relays*. It adds
FediBuzz/buzzrelay-style **hashtag** and **instance** relays, plus local
hashtag/instance rules. It lives in the Atlas repo because no writable
`bonfire-networks` checkout is connected.

**Status — read this first**

- Not installed on Fedizen. Fedizen has not been modified, and nothing was
  deployed or subscribed.
- Off by default (`enabled: false`, `outbound_enabled: false`). Connections
  are created **idle**, and only an admin pressing *Enable* sends a Follow.
- 86 ExUnit tests pass with Elixir 1.18.5 / OTP 27.
  - 77 are pure or offline.
  - 9 run the real Ecto store and both migrations against a local
    PostgreSQL 16, when `RELAY_CLIENT_PG_URL` is set.
  - `mix compile --warnings-as-errors` and `mix format --check-formatted`
    pass. The admin LiveComponent is compiled and render-tested with
    Phoenix LiveView 1.x.
- `Federation.Bonfire` is **fail-closed and capability-gated**. Until
  `ActivityPub.RelayHooks.version() == 1` and `Incoming.receive_relayed/2`
  exist (see `upstream_patches/`), every call returns
  `{:error, {:upstream_hook_required, _}}`.
- The upstream patches apply cleanly to current upstream HEADs and parse,
  but have **not** been compiled or run inside a Bonfire app.

## Three entities

| Entity | What it is | Where |
|---|---|---|
| A. Relay connection | URL/actor, kind (`mastodon`, `litepub`, `fedibuzz_tag`, `fedibuzz_instance`), state (`idle → pending → accepted / rejected / failed`), last error and error count, per-minute volume limit, inbound policy (`all_public` or `rules_only`), per-connection outbound, created-by | `Subscription`, table `bonfire_relay_client_subscriptions` |
| B. Hashtag rule | normalised tags, `any`/`all`, scope (all relays or listed connections) | `Rules.TagRule`, table `bonfire_relay_client_rules` |
| C. Instance rule | domain, `observed` (only posts relays happen to deliver) or `whole_instance` (needs an accepted FediBuzz instance relay for it), optional tags | `Rules.DomainRule`, same table |

### Selective upstream source vs local filter (never conflated)

- A **FediBuzz connection** is a *selective upstream source*: buzzrelay
  only sends posts it saw with that tag or from that instance. It is a
  server-level Follow by the instance **service actor** of the resolved
  topic actor. It is not a user hashtag follow, and it is not a Mastodon
  public-collection subscription.
- **Rules** are *local filters* on what connected relays actually deliver.
  `Rules.coverage/2` and the UI badge say *no source* until an accepted
  connection in scope exists. Nothing claims every remote post will appear.
- Topic integrity: content from a `fedibuzz_tag` connection must carry that
  tag as a real AS2 `Hashtag`. Content from `fedibuzz_instance` must be
  authored on that instance. Anything else is dropped as `off_topic`.

### FediBuzz specifics (from astro/buzzrelay source)

- Routes: `GET/POST /tag/{tag}` and `/instance/{host}`. The same URL is the
  topic actor and its inbox.
- Tag key: `deunicode → lowercase → drop whitespace and '-'`. We approximate
  this exactly for Latin diacritics, build a candidate URL, then **resolve**
  it. The resolved actor must be on the same host and topic path, or the
  connection is refused.
- Accept comes from the topic actor and embeds our Follow. Content arrives as
  `Announce{object: uri, to: Public}`. We use only the object id, re-fetch it
  from its origin and verify it there.
- FediBuzz is inbound-only. Outbound to it is refused at configuration time
  and reported as skipped at send time.

### No user-visible side effects

- Follows are sent by the instance service actor. `RelayHooks.follow/3`
  never calls the adapter, so no follow edges are created.
- Ingested content goes in with `relayed_by` (provenance only),
  `trusted_relay: false` and `no_follow_graph: true`. The relay is never the
  author or booster.

## Admin UI

`Bonfire.RelayClient.Web.RelaysLive` is a stateful LiveComponent, mounted as
`/settings/instance/relays` by `upstream_patches/bonfire_ui_me-relays-tab.patch`.
That route sits in Bonfire's instance settings LiveView (session-bound and
CSRF-protected LiveView socket).

- Every event re-checks admin rights on the server (`Admin.authorize/1` via
  `Authorizer.Bonfire`, which mirrors `Bonfire.Me.Accounts.is_admin?/1` /
  `Boundaries.can?(ctx, :configure, :instance)`). It fails closed.
- *Delete connection* requires the connection to be disabled first, and the
  relay URL typed as confirmation, checked on the server. *Delete rule* also
  requires a confirmation that is checked on the server.
- *Enable*, *Disable* and *Retry* run compare-and-set on the stored state,
  so concurrent clicks send at most one Follow.

## Inbound flow

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
3. Apply the three patches in `upstream_patches/` to activity_pub,
   bonfire_federate_activitypub and bonfire_ui_me.
4. Configure as in **Configuration** below. The context is built by
   `Bonfire.RelayClient.Context.build/1`. Follows always use Bonfire's
   service actor (`ActivityPub.Utils.service_actor/0`).

### Upstream touchpoints

See `upstream_patches/README.md`. The five hooks are implemented there as
patches against the current upstream sources.

## Configuration

```elixir
config :bonfire_relay_client,
  enabled: false,                 # flip only when ready
  outbound_enabled: false,
  allowed_relay_hosts: ["relay.fedi.buzz"],
  store: {Bonfire.RelayClient.Store.Ecto, Bonfire.Common.Repo},
  federation: Bonfire.RelayClient.Federation.Bonfire,
  authorizer: Bonfire.RelayClient.Authorizer.Bonfire

config :activity_pub, relay_inbox_hook: Bonfire.RelayClient.InboxHook
```

Copy both files from `priv/repo/migrations` into the host app. The second
migration is additive.

## Development

```sh
mix deps.get   # dev/test-only: ecto_sql, postgrex, phoenix_live_view, jason
mix compile --warnings-as-errors && mix test && mix format --check-formatted
RELAY_CLIENT_PG_URL=ecto://postgres@127.0.0.1:5432/relay_client_test mix test --only pg
```

The tests are offline and use `test/support/fake_federation.ex`. The `:pg`
suite uses loopback PostgreSQL only.

Not yet tested:
- Compiling or running inside Bonfire with the patches applied.
- Live interop with `../relay/`, FediBuzz or any public relay.
- LD-signature verification, which is delegated to Bonfire's `ActivityPub.Safety`.
