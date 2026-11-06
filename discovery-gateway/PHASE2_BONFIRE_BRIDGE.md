# Phase 2 — Verified native Bonfire ingestion contract (NOT ACTIVE)

Phase 1 provides a public-read discovery gateway for Atlas, independent of
Fedizen. Phase 1 results are **not native Fedizen timeline entries**.

The optional `bonfire_relay_client/` Elixir extension remains the Phase 2
starting point. Its patches against Bonfire Community v1.1.0-rc.1 must be
compiled and tested in a matching full Bonfire installation. Fedizen's
Co-op Cloud deployment is not modified.

## Proposed trust boundary

Gateway => Bonfire must be a *request to resolve a canonical public object*,
never a promise to insert trusted remote JSON. Neither the gateway's HTTP
signature nor its service actor proves that a third-party author produced
the referenced post. No relay-as-booster or user-follow graph side effects.

A future `resolve_public_object` operation should take:

```json
{
  "canonicalObjectId": "https://original-instance.example/notes/123",
  "discoveredViaActor": "https://relay.fedi.buzz/tag/knitting",
  "gatewayObservedAt": "2026-11-06T21:00:00Z",
  "requestedBy": "server-side authenticated instance administrator or policy"
}
```

These names define a **proposed contract**, not an existing Bonfire API.
The server must treat `discoveredViaActor` and `gatewayObservedAt` as
untrusted provenance metadata. `requestedBy` cannot be taken from a browser
body; it must come from Bonfire's authenticated context.

## Acceptance requirements

1. A real Bonfire extension endpoint or internal job is authorized through
   server-side instance policy, not a browser bearer token or a remote
   gateway's own assertion. Define explicit admission quotas.
2. Bonfire resolves the original object from the author's origin with
   SSRF/redirect/DNS protections, cache controls and verified authorship.
3. Only public objects that pass existing instance/domain/user moderation,
   boundaries, media, and legal restrictions are eligible for ingestion.
4. Existing Bonfire object identity and account mapping are authoritative.
   Deduplicate idempotently by canonical ID and handle origin Updates and
   author-verified Deletes; never use the relay identity as the author.
5. User Home timelines remain follow-based. A separate instance-wide curated
   discovery feed may include the eligible objects, and only if the product
   explicitly opts into that surface. Don't silently populate everyone's Home.
6. Log audit metadata and metrics without storing personal private content.
   Apply reversible source policy, bounded queue, retry-safe durable claims
   and transactional insertion.
7. Verify with Bonfire Community RC.1's actual dependency pins, signing
   behavior, authorization boundaries, migration/rollback procedures, and
   a disposable nonproduction environment. Fedizen has no staging instance.
8. Feature stays disabled in any provider deployment until all checks pass.

## Deployment independence

A gateway outage must not interfere with Bonfire logins, posts, federation,
or identity. Atlas must gracefully show an unavailable or empty public
discovery panel. No client-visible administrative token, remote-author
impersonation, reverse-proxy interception of Fedizen's ActivityPub inbox,
or direct writes to Bonfire tables are permitted.

**Status: contract only. No Phase 2 endpoint, native Bonfire ingestion,
Fedizen migration, or live federation delivery was created.**
