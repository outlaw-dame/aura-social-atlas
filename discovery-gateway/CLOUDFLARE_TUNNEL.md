# Atlas staging: Cloudflare Tunnel to private Railway gateway

**Staging cutover verified 2026-11-07.** Cloudflare Tunnel `atlas-discovery-gateway-staging` is healthy with four QUIC connections from the private Railway `atlas-cloudflared-staging` service (`cloudflare/cloudflared:2026.10.0`). The proxied `staging-gateway.damonoutlaw.xyz` CNAME points to the Tunnel, the `gateway-web` service has **no Railway public or custom domains**, and POST `/healthz` via the Tunnel returned HTTP 200 after removing the Railway custom-domain mapping. `gateway-web` and `gateway-worker` both deployed reviewed `main` commit `ad18ba39f0dfce569cbc1e4f78585d819e8a519c`; the Cloudflare staging-only `x-atlas-edge-auth` overwrite remains enabled. The canary DNS/ingress and its temporary authorization-rule match were removed. See [issue #23's acceptance record](https://github.com/outlaw-dame/aura-social-atlas/issues/23#issuecomment-6712845558).

**Not production release approval:** staging still requires independent signed federation reacceptance after ingress migration, real live PostgreSQL backup and isolated restore, failure/retry drills, egress policy tests, and monitoring sign-off. Railway has a pending, **uncommitted deletion of `interop-relay-fixture`**, so no environment-wide staged deploy must be applied until that deletion is discarded using Railway's Staged Changes Details interface. The two staged web/worker source references have been reconciled to the live reviewed SHA, but staging the same SHA does not remove the deletion.

The steps below document the secure cutover and remain applicable to future redeployments. Do not recreate public Railway ingress to repair a Tunnel failure without an explicit security review.

## Trust boundaries

```text
External Fediverse servers
        | HTTPS: signed GET/POST /actor, /inbox, WebFinger
        v
Cloudflare hostname (WAF, TLS, DNS; no cache of inbox/admin)
        |
Cloudflare Tunnel edge
        | encrypted outbound tunnel
        v
cloudflared connector (separate private Railway service, no public domain)
        | internal HTTP only
        v
gateway-web.railway.internal:4100  (PUBLIC ROUTES ONLY)
        |
        +--> private PostgreSQL: direct session, NOT public
        +--> gateway-worker: queue only, NOT public
        |
Private, authenticated operator -> gateway-web.railway.internal:4101
                               (admin-only listener, NEVER Cloudflare ingress)
```

No HTTP Host header, `CF-Connecting-IP`, `X-Forwarded-For`, or other spoofable request header is an acceptable proof that a request passed through Cloudflare. The only reliable network boundary is **no public Railway domain/TCP proxy for the web service**; ingress comes through an outbound-only tunnel connector. The internal admin port is separate and requires an independent bearer credential.

## Previously confirmed vulnerability

An independent [staging origin-bypass probe](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42396080014) connected directly to the Railway edge hostname, supplied the Cloudflare gateway hostname in the HTTP `Host` header, and received HTTP **200** from `/healthz` **without any `CF-Ray`** header. This bypassed Cloudflare's WAF/rate limits on public HTTP endpoints, even though the public `/admin/subscriptions` route returned HTTP 404 thanks to the separate admin port. See [PR #47](https://github.com/outlaw-dame/aura-social-atlas/pull/47). The follow-up [external origin-bypass acceptance](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42397668736) subsequently passed on staging after the former generated Railway origin became unreachable. This confirms denial of the tested routes, but does not by itself prove Tunnel connector deployment, private-network cutover, or origin-secret configuration. Keep those independent deployment gates explicit.

Railway's internal service liveness check must use `GET /livez`, which intentionally avoids the edge-secret gate and performs no database or actor access. External readiness and security probes must continue using the Cloudflare-fronted, database-backed `GET /healthz`; do not expose `/livez` as a substitute for protected readiness.

## Staging Tunnel details

- Cloudflare account: `96c9c5d8bdbf048cc9ccff02900d4e8b`
- DNS zone: `damonoutlaw.xyz`
- Tunnel: `atlas-discovery-gateway-staging` (`e3f766e1-c46a-4921-9799-13f928becaf7`), remotely managed
- Ingress: `staging-gateway.damonoutlaw.xyz` -> `http://gateway-web.railway.internal:4100` with matching host header; fallback `http_status:404`
- Keep Cloudflare's staging-host-only WAF block on `/admin` and `/admin/*`.
- **Do not** route the tunnel to port 4101 (private admin); do not attach a public Railway domain or TCP proxy to the tunnel or worker services.

## Migration procedure (zero forced downtime)

1. **Check Railway plan and pending changes.** Railway Hobby is enabled for the staging workspace. Verify capacity before provisioning additional persistent containers; preserve the existing interop fixture until release tests no longer need it. Do not apply unrelated staged source changes without reconciling their Git commit and CI/review state. Confirm all roles share the correct private Railway network and region.
2. **Provision an outbound-only `cloudflare/cloudflared` service.** Pin an explicit verified image version/digest; use one small persistent replica initially. Do not give it a public domain, TCP proxy, database credential, or admin token. Get the remotely managed tunnel token using a scoped Cloudflare API credential; save it **only** as the Railway service secret `TUNNEL_TOKEN`. Do not print, commit, or put it in a command-line argument. Cloudflare's [Kubernetes connector documentation](https://developers.cloudflare.com/tunnel/guides/kubernetes/) confirms `cloudflared tunnel --no-autoupdate --loglevel info run` consumes `TUNNEL_TOKEN` from its environment. Use a private localhost metrics listener and bound memory/CPU where supported.
3. **Verify the connector is healthy and resolves the private web service** before any DNS change. Cloudflare must report an active tunnel connection. Validate public `/healthz`, actor, WebFinger and signed POST through a temporary, disposable hostname first if possible. Keep the old domain active during the trial. Confirm the origin's `Host` handling, lack of redirect loops, and that signed ActivityPub requests arrive with intact body and HTTP signatures.
4. **Cut over only after success.** Change *just* the staging hostname's proxied Cloudflare CNAME from the old Railway edge to `e3f766e1-c46a-4921-9799-13f928becaf7.cfargotunnel.com`, after checking DNS for conflicting records. Keep the custom TXT record only while Railway verification requires it. Re-run the GitHub live smoke and WebFinger signed actor checks immediately.
5. **Remove the Railway public custom domain/target that allows direct-origin bypass.** Do **not** delete `gateway-web`, its signing keys, database or private network endpoint. Also remove any remaining Railway generated public domain or TCP proxy targeting that same service. The independent GitHub direct-origin check must deny requests with both normal and forged Host. Public `/admin/*` stays Cloudflare 403; public `/healthz` and inbox continue working through the tunnel.
6. **Retest signed delivery and resilience:** queue worker running independently; no duplicate ingestion on retries; signed Follow/Accept, Create/Announce, Delete, Undo; TLS and WAF; Cloudflare tunnel connector restart; verify recovery without changing actor key fingerprints. Check DNS, certificate status, and Tunnel metrics; configure alerts for connector down, edge 5xx, queue lag, database error and unexpected key changes.
7. **Rollback:** if the connector fails *before* deleting the Railway public domain, revert only the staging DNS CNAME, then investigate. *After* removing public ingress, prefer fixing/restarting the connector rather than reopening an unprotected Railway endpoint; restoring public Railway routing must be an explicit, audited emergency decision. Do not confuse application code rollback with DB restore.

## Operational gates

- Connector credential storage: Railway secret variable only; rotate promptly if exposed.
- Never enable Cloudflare caching on `/inbox`, `/admin`, or content-dependent discovery endpoints. Preserve `Cache-Control: no-store`.
- Preserve origin identity and service actor key from the dedicated PostgreSQL volume; verify continuity before and after tunnel cutover.
- Test DNS rebinding and denied private IPv4/IPv6 destinations separately at the worker outbound layer: Tunnel controls **inbound** origin reachability, not Fedify outbound SSRF risk.
- The gateway must not share Fedizen production resources. Staging public identities stay isolated.
- Record actual measured acceptance evidence in [release gate #23](https://github.com/outlaw-dame/aura-social-atlas/issues/23). A written runbook or tunnel configuration alone does not complete this gate.

References: [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/) · [Connector deployment](https://developers.cloudflare.com/tunnel/guides/kubernetes/) · [Tunnel token handling](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/) · [Railway private networking](https://docs.railway.com/guides/private-networking).
