# Atlas Discovery Gateway — isolated staging deployment

**State (2026-11-07):** The gateway is live in isolated Railway Hobby staging, accessible only through Cloudflare Tunnel, with separate web/worker and dedicated private PostgreSQL. Independent external signed federation acceptance and strict origin-denial checks have passed. **Production remains blocked** pending encrypted offsite backups, enforceable egress restrictions, fault-recovery/operations sign-off and moderation/retention. This document's Fly.io example is an **alternative deployment template**, not the live topology. For verified staging details and exact remaining gates, read [RAILWAY.md](./RAILWAY.md), [CLOUDFLARE_TUNNEL.md](./CLOUDFLARE_TUNNEL.md), [OPERATIONS.md](./OPERATIONS.md) and [release issue #23](https://github.com/outlaw-dame/aura-social-atlas/issues/23). Do not use Fedizen's database, actor signing keys, relay subscriptions, or production domain.

## 1. Environment and isolation

The gateway is a separate ActivityPub service actor. Provision a unique HTTPS hostname and a **dedicated** PostgreSQL database. Choose a Fly.io staging app and Managed Postgres cluster in the same region, with independent credentials and no shared Fedizen resources. Provisioning Fly Machines or Managed Postgres incurs charges; review the selected plan before any resource creation.

Copy `fly.staging.example.toml` to `fly.staging.toml`, replace the placeholder `app` with the staging app name, and review the region and VM allocation. From the `discovery-gateway/` directory:

```sh
# Requires an authenticated flyctl session and an app you have created.
fly deploy . --config fly.staging.toml
fly scale count web=1 worker=1 --app YOUR_STAGING_APP
```

Do not run these commands until the **direct database URL**, secret token, and exact staging `GATEWAY_ORIGIN` have been configured in Fly's secret store. The image runs as a non-root user. The two process groups run the same versioned image with different `GATEWAY_ROLE` values; only `web` is attached to the public HTTP service. No worker should receive inbound HTTP traffic or a public IP.

### Required secrets (never commit or print values)

- `DATABASE_URL`: dedicated PostgreSQL connection URI using **direct**, not transaction-pooled access.
- `GATEWAY_ORIGIN`: the exact public HTTPS origin of this staging app (e.g. `https://YOUR_STAGING_APP.fly.dev`).
- `GATEWAY_ADMIN_TOKEN`: independently generated random value, at least 32 characters; store only server-side.
- `GATEWAY_CORS_ORIGINS`: exact allowed Atlas staging web origin(s), empty for isolated testing.

**Critical connection detail:** `fly mpg attach` defaults to a PgBouncer-pooled `DATABASE_URL`. Fedify's PostgreSQL message queue uses PostgreSQL `LISTEN/NOTIFY`; transaction pooling cannot reliably support session-bound notifications. Use the **direct** Managed Postgres endpoint supplied by your cluster's Connect panel and confirm the secret points to that endpoint before starting either role. Keep the pool small; this gateway currently opens at most ten connections per process. Test reconnects and notification delivery after a database failover.

Keep the `/admin/` path restricted by a trusted ingress/WAF rule or VPN, in addition to its bearer token. The application alone does **not** enforce a private-network-only admin path. Do not expose privileged tokens in the web app, browser environment or mobile app.

## 2. Initial staging checks

1. Verify both process groups are running; the worker logs `gateway.worker_started`, and the web process logs `gateway.listening`. Confirm only the web role has public ingress.
2. Confirm `GET /healthz` returns HTTP 200 and `{"ok":true}`, and fails with 503 when the database is unavailable.
3. Fetch `/actors/gateway` and `/actor` with `Accept: application/activity+json`; confirm actor identity and inbox URL match the **staging** domain.
4. Confirm requests to `/admin/subscriptions` without a valid bearer token return 401; independently verify the perimeter blocks public access to `/admin/*` entirely.
5. Confirm `/api/v1/items` contains no demo content and no entries from production.
6. Use `bun run interop:probe litepub https://CONTROLLED_STAGING_RELAY/actor` as a read-only actor preflight; only then add the controlled relay using the private admin interface.

Do not send live Follow or Announce to arbitrary public relays during commissioning. The staging relay must be controlled by the team and contain only synthetic public posts.

## 3. Signed federation acceptance gate

Run a real **external** staging relay against the public staging gateway. Record the remote actor and origin URL, activity IDs, request/response status, HTTP signature scheme, queue depth, database records and server logs for every assertion.

- Follow → signed Accept/Reject must correspond to the exact persisted Follow ID and actor identity.
- Reciprocal LitePub Follow → Accept must work without permitting unsolicited actors to cause outbound requests.
- Signed public Create must persist once; private, forged or unsigned Create must not persist.
- Signed Announce must fetch a canonical public Note from its original HTTPS host; preserve original author and hashtags.
- Replay and duplicate delivery must be idempotent.
- Disabled subscriptions must reject late Accept/Create/Announce and must not fetch announced origin URLs.
- Verified original-author Delete removes only that author's matching post.
- Stop the worker, enqueue a signed activity, restart the worker, and verify one eventual ingestion with the same signing identity and no stale retries.
- Restart the web process and verify service actor public keys are unchanged.

Log observations without request bodies, signatures, bearer tokens, full headers or private JWK material. The CI suite covers the synthetic inbox and isolated PostgreSQL recovery paths but **does not** substitute for these real external tests.

## 4. Backups, rollback, and monitoring

Before production, take a backup and perform a **restore into a different disposable database**, then verify gateway keypairs, subscriptions, queue records, schema, and read API correctness. Rotate keys only through an explicitly designed migration; restoring a different actor key will break federation identity.

Verify Managed Postgres point-in-time restore and automated backups in the chosen plan. Establish alerts for worker crashes, PostgreSQL connectivity, queue backlog, delivery retry exhaustion, HTTP 5xx, signature-verification errors, and unexpected content-ingest spikes. Retain structured logs without secrets and define retention limits.

Roll back application code by restoring the previously approved **image digest**, not a mutable tag. Roll back schema only after checking compatibility with the old code; never automatically restore an old database snapshot over newer production data. Keep independent staging and production secrets.

## 5. Production promotion criteria

Production deployment is **blocked** until all of these are documented with evidence: green CI and completed review on the exact image source; tested backup/restore; controlled external signed federation tests; IPv4/IPv6 egress and redirect/DNS-rebinding validation under the chosen host; authenticated-only administration with trusted ingress isolation; known worker health and retry behavior; realistic load/rate-limit testing; moderation and deletion policy coverage; and a monitored, reversible rollout.

This staging template does not configure a host-level egress firewall, perform a real TLS integration test, provision hosting, or claim production readiness. Fly deployment reference: https://fly.io/learn/background-workers/ . Direct Managed Postgres connectivity: https://fly.io/docs/mpg/client-configuration/ .
