# Upstream integration patches

These are unified diffs against the bonfire-networks repositories. They are
NOT applied anywhere: Fedizen is not modified. Check them with `patch -p1
--dry-run` from each repository root.

**Co-op Cloud compatibility:** these are integration candidates, not patches
verified against Fedizen's actual image. The new reported target is
**`v1.1.0-rc.1`**; beta-25 provenance is archival only. Follow
[the Co-op Cloud guide](../deployment/COOP_CLOUD.md) to identify the actual
Community flavour and dependency revisions, rebase each diff, and compile
the full host application. Require the host's live image digest and installed
recipe revision; a reported version does not prove either.

## RC.1 release-pinned compatibility (2026-11-06)

Canonical RC tag object `d3e774208432f89a74896fece39321b2a9d7cba6` resolves to
app commit `7815b3394031e384f00415f44fac1596070c8157`, whose
[`mix.lock`](https://github.com/bonfire-networks/bonfire-app/blob/7815b3394031e384f00415f44fac1596070c8157/mix.lock)
pins Community `a58f2fbc65ba3bf468b319d7f1e9d9a892ffb8a3` and:

| Patch repository | Exact RC lockfile source | Check |
|---|---|---|
| activity_pub | `2931ec3757bce29b8043d84290403007b5b81def` | Existing patch dry-run/applies with zero fuzz; receiver/hooks parse |
| bonfire_federate_activitypub | `e5489e30c8e7869ea695736f7867eb3c3167f137` | Existing patch dry-run/applies with zero fuzz; Incoming parses |
| bonfire_ui_me | `803be49d039d5cdc8d89ce4f985de1519120f67c` | Both hunks apply with zero fuzz; LiveView `.ex` parses, `.sface` compilation unverified |

Checks used temporary source archives at these pins, **not HEAD**; the app
lockfile pins were also read at the resolved source commit. No patch changes
were necessary. Source API comparison retains service-actor lookup, id
minting, fetch without ingest, actor/object lookup, signed publisher queue
arguments, virtual relay/signer fields, proof/signer receiver context,
Object-based Incoming handling and instance-settings template context.
See the deployment guide for source links and precise limitations. No full
RC Community build, host deployment, or live federation is verified.

## Historical HEAD checks (not the release target)

| Patch | Repository | Checked against | What it adds |
|---|---|---|---|
| `activity_pub-relay-hooks.patch` | bonfire-networks/activity_pub | HEAD `9aa7c64` (written on `a6d1f3d`) | `ActivityPub.RelayHooks` (hooks 2, 3, 4, 5) and the verified-signer inbox hook in `ReceiverHelpers.handle_received/2` (hook 1) |
| `bonfire_federate_activitypub-receive-relayed.patch` | bonfire-networks/bonfire_federate_activitypub | HEAD `3317d5f` (written on `8bf8d72`) | `Incoming.receive_relayed/2`: safe ingestion with provenance only (hook 4b) |
| `bonfire_ui_me-relays-tab.patch` | bonfire-networks/bonfire_ui_me | HEAD `803be49` (written on `6a14aa6`) | `/settings/instance/relays` tab that mounts `Bonfire.RelayClient.Web.RelaysLive` |

## Hooks

1. **Verified-signer inbox hook.** It runs in `ReceiverHelpers.handle_received/2`
   after the body proof/LD check. It is offered only deliveries whose HTTP
   signature verified (`signed_by`), plus `ld_verified_actor` when
   `authenticated` is `:ld_signature` or `:integrity_proof`. It is enabled by
   `config :activity_pub, relay_inbox_hook: Bonfire.RelayClient.InboxHook`.
2. **Pre-minted id / object override Follow.** `RelayHooks.mint_activity_id/0`
   and `RelayHooks.follow/3` take `object` as as:Public or the relay actor.
   The Follow is stored and signed-delivered to the relay inbox. It does NOT
   call `Adapter.maybe_handle_activity/2`, so no Bonfire follow edge is
   created.
3. **Signed extra-inbox publishing.** `RelayHooks.deliver/3` and
   `deliver_local/2` go through `Publisher.enqueue_one(APPublisher, actor, …)`
   and pass signing-actor identifiers. RC `APPublisher` can still exhaust
   lookups and fall back to unsigned publishing; an always-signed guarantee
   requires a fail-closed relay-job guard and host tests, not these arguments alone.
4. **Fetch without ingestion, then safe ingest.**
   `RelayHooks.fetch_without_ingest/1` uses
   `Fetcher.fetch_remote_object_from_id/2`, which returns data and does not
   insert the object (it can update instance metadata/observers, and fetch
   signing is optional upstream). `Incoming.receive_relayed/2` stores the
   already-checked object and sets virtual `relayed_by`. Empty insert options
   do not retain fetch/LD authentication metadata; RC Incoming consumes this
   field in mirrored-group / `publish_in` mapping. Provenance-only behavior
   is an intended contract, not established by the candidate patch.
5. **Service-actor Announce.** `RelayHooks.announce/2` sends a public
   Announce of a LOCAL, public object from the service actor to one relay
   inbox.

## Verification status (re-checked 2026-11-05 03:2x UTC)

- All three patches apply cleanly to fresh clones at the HEADs in the table.
- Every patched `.ex` file parses (`Code.string_to_quoted/2`).
- Every upstream function the patches call exists at those HEADs:
  - `Utils.service_actor/0`
  - `Utils.generate_object_id/1`
  - `Fetcher.fetch_remote_object_from_id/2`
  - `Publisher.enqueue_one/3`
  - `Actor.get_cached_or_fetch/2`
  - `Object.get_ap_id/1`
  - the virtual `Object.relayed_by` field
- Fixed in this pass: `RelayHooks.deliver/3` now passes `actor_id`,
  `actor_ap_id` and `actor_username`, the same as upstream's `Forwarder`.
  The publisher worker can then always find the signer. Upstream
  `APPublisher.publish_one/1` falls back to an unsigned POST when no signer is
  found. Do not rely on the recipient rejecting an unsigned POST as a
  production safety guarantee; removing that fallback for relay jobs is
  a host integration blocker, alongside authentication metadata preservation
  and testing relay-derived group mapping.

**Not verified:**
- Compiling or testing inside a full Bonfire app (needs the whole Bonfire
  codebase and its dependencies).
- The `.sface` template change (not parsed).
- Bonfire's own federation and Fedify interop tests with the patches applied.
