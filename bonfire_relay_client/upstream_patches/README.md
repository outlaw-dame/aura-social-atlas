# Upstream integration patches

These are unified diffs against the bonfire-networks repositories. They are
NOT applied anywhere: Fedizen is not modified. Check them with `patch -p1
--dry-run` from each repository root.

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
   and always pass the signing actor. The unsigned `publish_one(%{json: …})`
   path is never reachable from here.
4. **Fetch without ingestion, then safe ingest.**
   `RelayHooks.fetch_without_ingest/1` uses
   `Fetcher.fetch_remote_object_from_id/2`, which returns data and does not
   insert it. `Incoming.receive_relayed/2` stores the already-checked object
   as its author's and sets the virtual `relayed_by` field.
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
  found; relays reject unsigned POSTs, so this fails safe. Removing that
  fallback for relay jobs would be a worthwhile upstream follow-up.

**Not verified:**
- Compiling or testing inside a full Bonfire app (needs the whole Bonfire
  codebase and its dependencies).
- The `.sface` template change (not parsed).
- Bonfire's own federation and Fedify interop tests with the patches applied.
