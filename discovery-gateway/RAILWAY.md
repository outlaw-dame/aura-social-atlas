# Atlas Discovery Gateway — Railway staging

> **Live staging update (November 2026):** This original provisioning runbook predates the deployed Railway gateway. The gateway is online, signed federation interop passed, and public admin is now bound to a separate private port. **Do not attach/retain a public Railway domain in the final architecture**: an external test demonstrated a forged-Host bypass of Cloudflare WAF on the direct Railway origin. Follow [CLOUDFLARE_TUNNEL.md](./CLOUDFLARE_TUNNEL.md) for the staged tunnel migration, exact security gates, and rollback procedure. The Tunnel connector and DNS cutover are NOT complete as of this update.

Use this runbook only for a **new, isolated staging project/environment**. No step should reuse Fedizen's database, keys, secrets, actor URL, or production subscribers. This repository does not auto-provision Railway resources. Review cost and access before creating services.

Railway supports independent persistent services for web APIs and background workers, internal service networking, and PostgreSQL. The gateway needs **both** roles continuously running; a cron or request-driven function cannot replace its durable queue worker.

## Architecture

```text
Internet / controlled staging relay
        |
  HTTPS ingress
        |
  atlas-discovery-web (GATEWAY_ROLE=web; exposes PORT)
        |  shared persistent PostgreSQL
        +-----------------------------------+
                                            |
  atlas-discovery-worker (GATEWAY_ROLE=worker; NO public domain)
                                            |
  dedicated staging PostgreSQL (private service; port 5432)
```

**Do not expose the worker or PostgreSQL through public domains/TCP proxies.** Both application roles run the same pinned, CI-tested Dockerfile and have exactly the same `GATEWAY_ORIGIN`. The PostgreSQL queue needs an **unpooled session connection** for its LISTEN/NOTIFY behavior. The standard private Railway PostgreSQL `DATABASE_URL` points to the database service; verify that a separate transaction pooler has not been interposed.

## Service configuration

1. Create a staging Railway project, add a dedicated PostgreSQL service, and enable the backup policy appropriate for the experiment.
2. Create two **persistent** services with GitHub source `outlaw-dame/aura-social-atlas`, branch `main`, **root directory `discovery-gateway`**, and its `Dockerfile`. Confirm both use the same tested source revision/image. For staging, begin with one replica per role.
3. Set `GATEWAY_ROLE=web` on `atlas-discovery-web`; set `GATEWAY_ROLE=worker` on the worker service. **For temporary commissioning only**, a Railway-generated web domain may be used with clear expiry and isolated staging. The final exposed hostname must use Cloudflare Tunnel over the Railway private network, with Railway public web domains removed. The worker must never have a public domain.
4. Define `DATABASE_URL` on **both** services as a Railway *reference variable* to the staging Postgres service's `DATABASE_URL`; use Railway's variable picker so the referenced service name matches exactly. This is a private internal connection, not `DATABASE_PUBLIC_URL`.
5. Set `GATEWAY_ORIGIN` on **both** services to the exact web service public HTTPS origin (no trailing slash). Set a unique high-entropy `GATEWAY_ADMIN_TOKEN` in the server-side secret store. Never commit or display it. Restrict `GATEWAY_CORS_ORIGINS` to the exact staging web frontend origin, or leave it empty while testing the gateway alone.
6. Set `NODE_ENV=production`, `PORT=4100`, and `GATEWAY_ADMIN_PORT=4101` (private-network-only, never publicly routed) on the web service. Configure Railway's internal web healthcheck as `/livez` (not `/healthz`, which requires the Cloudflare origin-auth header), a one-minute initialization grace period, and a restart policy appropriate for persistent work. Use the same restart policy on the worker, whose readiness must be inferred from its structured startup log and ongoing queue processing rather than an HTTP healthcheck.
7. For the trial, disable auto-sleep/serverless behavior for **both** services. Sleeping a queue worker delays signed federation, and sleeping web intake may cause delivery timeouts.
8. Enable GitHub auto-deploy only for the staging branch/environment after the first controlled deployment has been reviewed. Promotion to production must require explicit approval of an immutable, CI-tested revision.

Railway's GitHub and Dockerfile documentation: https://docs.railway.com/services and https://docs.railway.com/builds/dockerfiles . Its PostgreSQL documentation: https://docs.railway.com/databases/postgresql .

## Secret and ingress controls

The gateway's bearer token is **not** by itself an adequate production network isolation boundary. `GATEWAY_EDGE_SECRET` must be set only after an authenticated Cloudflare header rewrite is configured and independently tested. Railway's own liveness probe uses `/livez`; this route exposes no database or actor state. Never relax protected `/healthz` to make a Railway healthcheck pass. Require edge/WAF ingress policy restricting `/admin/*` to trusted operator access or a private management path. Test that unauthenticated requests are rejected at the application level and that the internet-facing edge refuses all public attempts to reach `/admin/*`.

Set a service-specific egress firewall or network policy that blocks access to private/reserved IPv4 and IPv6 destinations (except narrowly permitted private PostgreSQL and DNS infrastructure). Validate that protections cover redirect chains, cloud metadata endpoints, and DNS-rebinding attempts. **Fedify's address pinning is defense in depth, not proof of the host's egress firewall.** Railway platform networking controls must be evaluated on the actual deployment before production promotion.

## Staging acceptance procedure

Run the following against a **controlled synthetic relay**, never against arbitrary production Fediverse accounts:

- Confirm `/healthz` succeeds and that the web actor's public `id`, inbox, and signing-key identifiers match the isolated staging origin.
- Confirm worker logs report `gateway.worker_started` and remain alive during external messages.
- Verify signed Follow/Accept/Reject and LitePub reciprocal Follow/Accept with exact ID correlation. Explicitly record rejected actors and reasons without logging credentials or request bodies.
- Verify signed public Create, Announce with canonical source fetch, duplicate deliveries, private-content rejection, author-scoped Delete, unsubscribe/Undo, late Accept/Create/Announce after disable.
- Stop the worker, deliver a message that persists to PostgreSQL's queue, restart the worker, and confirm one eventual ingestion and stable signing keys.
- Repeat with a brief PostgreSQL disconnect and controlled reconnect; inspect backlog and fatal/restart behavior. Record the time required for safe recovery.
- Take a real staging backup and **restore into a separate disposable DB**. Check keypair continuity, subscription state, queue consistency, and the read API. Never restore over a newer production database.
- Measure concurrent inbound POST load, throttling responses, worker backlog, and latency. Do not infer scaling capacity from synthetic unit test success.

Block production promotion on unverified behavior. If any signature, queue-consumption, retry, privacy or deletion check fails, stop the rollout and investigate on staging.

## Rollback and observability

Enable alerts for HTTP 5xx, worker crashes, PostgreSQL errors, backlog growth, delivery retries, and unusually high ingestion rates. Retain logs without tokens, full headers, message bodies, or cryptographic keys. Record the deployed Git SHA and container digest for each release.

Rollback by redeploying the previously approved image/revision while preserving the current database **only if schema compatibility was tested**. Do not blindly roll back the database; restore backups only under a documented incident plan.

## Scope of this runbook

No Railway service or PostgreSQL instance has been created by adding this file. It is a reproducible operator procedure. The container and role isolation must still be validated against a live Railway deployment, including ingress, egress, backups, and signed external federation.

For deployment-neutral release gates and the alternative Fly staging example, see [DEPLOYMENT.md](./DEPLOYMENT.md).

Official resources: https://docs.railway.com/build-deploy , https://docs.railway.com/overview/best-practices , https://docs.railway.com/infrastructure-as-code/reference .
