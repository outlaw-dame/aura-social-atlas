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
- The upstream patches apply with zero fuzz to the **RC.1 app-lockfile
  dependency revisions** (2026-11-06); all four patched Elixir files parse.
  Older HEAD checks are historical. Full Community compilation, Surface
  integration and runtime federation remain **unverified**.
- The migrations were run up, down and up again on PostgreSQL 16 with no
  warnings. Database constraints, insert races, compare-and-set, claims,
  leases, the volume counter and rule round-trips are covered by the
  `:pg` suite.
- Co-op Cloud documentation recheck (2026-11-06): compilation with
  warnings-as-errors and format check pass on Elixir 1.18.5 / OTP 27;
  all **86 tests pass twice**, seeds `0` and `314159`, including all nine
  PostgreSQL 16.15 cases on a throwaway loopback database. A leaked fake
  actor-resolver setting between test modules was fixed with teardown/reset;
  federation and production code were unchanged. Full host integration
  remains unverified.

### Remaining integration steps (in order)

For Fedizen's provider-confirmed **Co-op Cloud (Abra), Community** deployment,
start with [deployment/COOP_CLOUD.md](deployment/COOP_CLOUD.md). Its reported
**`v1.1.0-rc.1` is the new reported baseline**; former `1.1.0-beta25` and
canonical `v1.1.0-beta.25` evidence are archival only, not the current image.
The RC annotated tag resolves to app commit
`7815b3394031e384f00415f44fac1596070c8157`. The guide records the verified
Community registry tag/digests and RC-pinned patch checks. Matching Fedizen
still requires the host's **live image digest and installed recipe revision**,
source/flavour/dependency provenance and platform. A reported version or
public registry digest is not proof of the running build.

RC targeting regression check (2026-11-06): warnings-as-errors compilation
and formatting pass; all **86 tests pass again**, seeds `0` and `314159`,
including nine isolated PostgreSQL tests. No deployment, live migration or
subscription was performed; full patched RC Community build is not verified.

1. Match the host build first, then rebase and apply `upstream_patches/*.patch` to activity_pub, bonfire_federate_activitypub
   and bonfire_ui_me. Then compile and run Bonfire's own suites, including
   `bonfire_federate_activitypub/lib/testing/` and the Fedify tester.
2. Add this package as a Bonfire extension, copy both migrations and run them.
3. Configure as in **Configuration**, keeping `enabled: false`. Check that
   `/settings/instance/relays` renders for an admin and is refused for
   non-admins.
4. Test against a staging relay, for example the Fedify server in `../relay/`
   or a private buzzrelay. Check the Follow, Accept, Announce and ingest flow,
   and that no user follows or boosts appear.
5. Only then, an operator sets `enabled: true` and adds real relays from
   the admin screen.

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

These are source integration steps, not an Abra deployment command. Do not
edit a running container: compile the extension into a custom Community
image and pin its digest as described in the Co-op Cloud guide.

1. Add the dependency in the matched Community flavour's dependency manifest
   (confirm its layout at that revision) / app `mix.exs`:
   `{:bonfire_relay_client, path: "extensions/bonfire_relay_client"}`.
2. Copy `priv/repo/migrations/*` into Bonfire's migrations and run them.
3. Apply the three patches in `upstream_patches/` to activity_pub,
   bonfire_federate_activitypub and bonfire_ui_me.
4. Configure as in **Configuration** below. The context is built by
   `Bonfire.RelayClient.Context.build/1`. Follows always use Bonfire's
   service actor (`ActivityPub.Utils.service_actor/0`).

### Upstream touchpoints

See `upstream_patches/README.md`. The five hooks are implemented there as
patches checked against explicitly recorded sources.

See the RC.1 lockfile compatibility table in the deployment guide and patch
README. Textual/API checks against those exact pins do not establish the
dependencies inside Fedizen's installed image or a full host build.

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
