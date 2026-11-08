# Atlas Discovery Gateway — staging operations and production go/no-go

**Last live verification: 2026-11-07. Status: staging accepted; production NOT approved.**
This is the independent, read-only ActivityPub discovery subscriber, not a native Bonfire writer.
It must never reuse Fedizen's database, signing keys or production subscriber identity.
Canonical evidence and sign-off: [release issue #23](https://github.com/outlaw-dame/aura-social-atlas/issues/23).

## Verified deployed topology

```text
Internet / signed ActivityPub HTTPS
  → Cloudflare staging-gateway.damonoutlaw.xyz (edge auth header + WAF)
  → Cloudflare Tunnel (outbound-only Railway connector)
  → gateway-web.railway.internal:4100 (public paths; /admin rejected)
  → dedicated private Postgres (keys, subscriptions, queue, provenance)
  ↔ gateway-worker (private, separately supervised Fedify queue)
Private operator inside Railway network → gateway-web.railway.internal:4101
```

- The web, worker and connector are separate persistent Railway Hobby services.
- `gateway-web` has zero public Railway service/custom domains; **no direct-origin fallback**.
- Gateway web and worker run the same reviewed application revision `ad18ba39f0dfce569cbc1e4f78585d819e8a519c`. Later main commits through `7425f2f` are tests/docs; do not confuse the main SHA with the live container SHA.
- Cloudflare Tunnel reported four healthy QUIC connections; public staging `/healthz` returned 200 after private cutover. Public `/admin/subscriptions` returned 403.
- **Railway staging patch warning:** an unrelated old STAGED patch still marks `interop-relay-fixture` for deletion. The staged web/worker source pins were reconciled to the live SHA, but the deletion was NOT discarded. Railway → staging → **Staged Changes → Details → × beside only the fixture deletion**, then verify the patch is not destructive. **Never apply the current patch in bulk.** The connected Railway actions cannot selectively discard it.

## Completed tests (scope matters)

| Area | Evidence | What it does *not* establish |
| --- | --- | --- |
| Signed external interoperability | Independent [run 42417148118](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42417148118): ten distinct verified Follow/Accept/Create/Announce/Delete/Undo, privacy, replay assertions via Tunnel | All malformed/invalid inputs or large federated traffic |
| Explicit Reject and adversarial signatures | Independent [run 42420318512](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42420318512): twelve assertions, signed Reject, recovery and unsigned/wrong-owner/tampered HTTP 401 with no cached objects | All key-rotation, LD proof, redirect/rebinding attacks |
| Direct-origin isolation | External [run 42416830383](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42416830383): five paths denied HTTP 404 with raw and forged Host; Cloudflare-positive control | Every possible bypass or outbound egress policy |
| Live logical restore | One-shot isolated `pg_dump`/`pg_restore` on staging, matched actor keys and state IDs; scratch verifier, DB and volume removed | Encrypted offsite backup retention, WAL/PITR and measured outage RPO/RTO |
| Worker restart | Railway logs: graceful stop then new `gateway.worker_started` and public health 200 | Active message replay during a real service crash |
| Disposable PostgreSQL outage | [run 42419866924](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42419866924): commit queue message, stop PG, verify outage, restart and consume exactly once via new process | Live Railway PostgreSQL HA/failover, recovery-point objective |
| Bounded external read check | [run 42420428489](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42420428489): 32 requests, four concurrent, p50 113.1 ms and p95 339.1 ms, all 200 | Throughput capacity or a production latency SLA |

The one-shot test relays were deleted; their short-lived PRs were deliberately closed without merging temporary URLs. Do not replay the one-shot fixtures against historical actor IDs.

## Persistent backup and recovery policy — production blocker

1. Staging has **one persistent Postgres volume** holding service actor private keys, accepted-subscription state, deduplication history, content and Fedify KV/queue. Losing the volume without an independent backup loses federation identity.
2. A completed one-off logical restore is **not** a durable backup plan. Select a storage provider outside the Railway failure domain. Recommended: private Cloudflare R2 with S3-compatible uploads **after the Cloudflare account owner enables R2** at Storage & databases → R2 → Overview. The Cloudflare API currently reports `10042: Please enable R2 through the Cloudflare Dashboard`.
3. Before attaching credentials, implement a least-privilege bucket-only write principal, separate read/restore principal, independent encryption of each archive using an **offline-recoverable recipient public key** (e.g., age). Never store the private decryption key in the backup producer, gateway or repository. Verify encrypted bytes, signed/hashed manifest, retention and actual restore to an independently provisioned empty target; log duration and RPO.
4. Propose nightly encrypted logical backups with 30-day retention plus weekly independent restore verification as the **initial** baseline; adjust based on actual storage and legal requirements. This is a proposed policy, **not deployed**. The gateway has no automated external backup today.
5. Never restore an old database over the live volume, silently rotate the gateway actor key, expose a PostgreSQL TCP proxy or send private key material to logs. Keep a break-glass recovery procedure and audited access.

## Outbound SSRF / egress isolation — production blocker

The application uses Fedify 2.4.5 guarded document loaders with `allowPrivateAddress: false`, redirect/time limits, DNS address pinning and a fail-closed Bun >=1.4.3 runtime gate. Both IPv4 and IPv6 reserved, link-local, loopback, private and cloud-metadata destinations must be independently tested. **This is software defense, not a host firewall.**

Railway Hobby does not expose a native outbound CIDR-deny policy in the connected service controls. An external CONNECT proxy such as open-source Smokescreen is an architectural option, but Fedify's pinned direct connections may deliberately ignore ordinary `HTTPS_PROXY` values: **do not deploy a proxy and falsely claim enforcement**. A production solution must prove that *all* federation fetch/delivery paths actually traverse a restrictive egress boundary, with a narrow exemption for required private Postgres/DNS, and fail closed on proxy loss. If Railway cannot supply enforceable egress isolation, move the outbound fetcher/worker to a platform/network that can. Record real IPv4/IPv6, redirects, DNS rebinding and metadata-target denial, using network traces or equivalent independent evidence.

## Retention, privacy, moderation and abuse

**What the implementation currently enforces:** accepted exact relay actor identity; Fedify-verified inbound authentication; public-only content; canonical original-author provenance; sanitized **text-only** storage (no mirrored remote media bytes); origin-scoped Delete; disable/Undo prevents further ingestion; replay deduplication; bounded post **count** (`GATEWAY_MAX_ITEMS`, default 50,000); bounded input sizes; per-process public-read and federation admission buckets. Browser CORS is allowlisted. Public admin is denied by both edge WAF and a private-only app listener.

**What still requires an implemented policy, not only documentation:**
- Age-based expiry of cached posts, source-driven tombstones and removal requests; the row-count limit is **not a retention duration**.
- **Prepared, not yet deployed**: private `POST /admin/moderation/suppress` requires the admin bearer and a canonical HTTPS object ID plus one reason (`abuse`, `privacy`, `legal`, `spam`, `other`). A transactional persistent suppression marker removes any cached row and prevents future signed Create/Announce reingestion of that exact canonical object ID, including concurrent delivery. The API intentionally has **no unsuppress route**; reversals require a separately reviewed recovery workflow. Database markers contain only ID, reason and timestamp; never store harmful payloads in the audit row. CI must demonstrate authorization/IDOR and race behavior before deploying this revision.
- Still required: a reviewed human removal/takedown procedure with source evidence, appeal rights, operator accountability, access reviews and audit retention. The suppression API is not a complete moderation service.
- Incident and support ownership, incident severity/escalation, reviewed content retention periods, subscriber blocking/quarantine, anti-abuse controls, and legal/privacy notice.
- Multi-instance fair/distributed rate limits if adding replicas; existing bucket keys are intentionally conservative and **per process**, not per remote actor and not distributed.

Do not claim these policy points have been automated until an audited code change and tests prove the enforcement.

## Monitoring, budgets and alerting

- Already active: hourly GitHub staging HTTPS/actor/WebFinger/admin-403 monitor; two-hour public smoke, periodic direct-origin checks. Scheduled monitor opens a GitHub issue on repeated failure; review issue duplication and notification delivery.
- Not yet operationally demonstrated: alert delivery for queue lag/depth, worker crash/restart loop, PostgreSQL connection exhaustion/locks, retries exhausted, key fingerprint change, 5xx spike, unexpected ingress or large ingestion.
- Candidate **initial investigation thresholds** (not enabled): public availability failing 3 successive probes, any worker process stopped for >2 minutes, queue oldest age >5 minutes, sustained 5xx >1% over 5 minutes once sufficient traffic exists, stored item growth >2× the observed baseline, any actor key fingerprint change. Tune from normal staging data and actual workload before adopting as an SLA.
- Monitor the service through Cloudflare and app logs: Railway's public-edge HTTP counter is **not** a complete request metric after Tunnel cutover. Keep no raw bearer token, private JWK, signed request body or remote private content in diagnostics.
- Budget: one web, worker, Tunnel connector and private Postgres. No Redis, CDN cache, object-media storage or additional DB service justified by present measured workload. Bounded read test is an acceptance smoke, **not a capacity test**.

## Safe rollback and promotion

- Record the exact deployed Git SHA, OCI image digest, schema version and actor public-key fingerprint before changing any service. Run CI and signed acceptance on immutable image/source; validate old/new schema compatibility against disposable Postgres.
- For regression, roll back **web and worker together** to the last compatible tested image, preserving the current DB and signing keys. Never re-enable an unprotected public Railway origin as a quick Tunnel rollback. Roll back schema only after explicit forward/backward compatibility review, not a blind snapshot restore.
- Before promotion: independently prove live queue recovery under controlled fault; offsite encrypted backup/restore and agreed RPO/RTO; enforceable outbound egress deny controls; implemented moderation/retention rules; operational alert delivery and moderate representative load; reviewed release/rollback + security sign-off.
- **Production approval remains blocked** until each requirement has evidence and a reviewer. The release checklist in issue #23 is authoritative.
