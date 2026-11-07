# Atlas staging: Cloudflare Tunnel to private Railway gateway

This is the planned secure public-ingress configuration for the independent Atlas discovery gateway. The tunnel is **prepared but not yet active** until a `cloudflared` connector, DNS cutover, and old-domain removal pass independent live tests. Do not claim Cloudflare-only enforcement while a direct Railway hostname remains reachable.

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

An independent [staging origin-bypass probe](https://github.com/outlaw-dame/aura-social-atlas/actions/runs/42396080014) connected directly to the Railway edge hostname, supplied the Cloudflare gateway hostname in the HTTP `Host` header, and received HTTP **200** from `/healthz` **without any `CF-Ray`** header. This bypassed Cloudflare's WAF/rate limits on public HTTP endpoints, even though the public `/admin/subscriptions` route returned HTTP 404 thanks to the separate admin port. See [PR #47](https://github.com/outlaw-dame/aura-social-atlas/pull/47). Keep production blocked until its external security probe passes.

## Staging Tunnel details

- Cloudflare account: `96c9c5d8bdbf048cc9ccff02900d4e8b`
- DNS zone: `damonoutlaw.xyz`
- Tunnel: `atlas-discovery-gateway-staging` (`e3f766e1-c46a-4921-9799-13f928becaf7`), remotely managed
- Ingress: `staging-gateway.damonoutlaw.xyz` -> `http://gateway-web.railway.internal:4100` with matching host header; fallback `http_status:404`
- Keep Cloudflare's staging-host-only WAF block on `/admin` and `/admin/*`.
- **Do not** route the tunnel to port 4101 (private admin); do not attach a public Railway domain or TCP proxy to the tunnel or worker services.

## Migration procedure (zero forced downtime)

1. **Check Railway plan and pending changes.** The connected Railway workspace returned `Free plan resource provision limit exceeded` on additional service creation. Upgrade/confirm Hobby before provisioning another persistent container, or retire the disposable interop fixture after recording its tests. Do not apply unrelated staged source changes without reconciling their Git commit and CI/review state. Confirm all roles share the correct private Railway network and region.
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
