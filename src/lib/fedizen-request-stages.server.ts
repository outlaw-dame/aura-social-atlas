/**
 * Where Atlas's requests to Fedizen are when they time out (server only, diagnostics; no addresses beyond the host,
 * no paths, headers, tokens or bodies).
 *
 * Three times (26 Nov 23:33 UTC, 27 Nov 19:10 and 21:27) every request Atlas's server sent to Fedizen timed out at
 * 10 s, while Fedizen answered a browser straight away. Railway's network logs for 21:27 show no traffic from Atlas to
 * Fedizen at all while those requests waited: they stalled inside Atlas's server before reaching the network. A fresh
 * start cleared it each time. This tells which stage they stall in, from Node's own request events (undici's
 * diagnostics channels, which Node's fetch publishes): waiting for a connection, connecting (the address lookup and
 * the TLS handshake are part of it), or sent and waiting for Fedizen's answer; and whether the server itself was too
 * busy to run anything (event loop delay). Logged once per pause, with each `Fedizen read unreachable`.
 */

type Req = { at: number; sent: boolean; answered: boolean };
type Stage = 'waiting for a connection' | 'sent, waiting for an answer' | 'answered, still reading';

const HOST = 'fedizen.net';
const requests = new Map<object, Req>();
let connecting = 0, connectedTotal = 0, connectErrors = 0, lastConnectAt = 0;
let started = false;
let loop: { percentile(p: number): number; max: number; reset(): void } | null = null;

const isFedizen = (origin: unknown) => {
  try { return new URL(String(origin)).hostname === HOST; } catch { return String(origin) === HOST; }
};

/** Starts listening (Node only; nothing on runtimes without these modules). Safe to call more than once. */
export async function watchFedizenRequests(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const dc = await import('node:diagnostics_channel');
    const on = (name: string, fn: (m: Record<string, unknown>) => void) => dc.subscribe(name, m => { try { fn(m as Record<string, unknown>); } catch { /* never break a request */ } });
    const req = (m: Record<string, unknown>) => m.request as { origin?: unknown } | undefined;
    on('undici:request:create', m => { const r = req(m); if (r && isFedizen(r.origin)) requests.set(r, { at: Date.now(), sent: false, answered: false }); });
    on('undici:client:sendHeaders', m => { const s = requests.get(req(m) as object); if (s) s.sent = true; });
    on('undici:request:headers', m => { const s = requests.get(req(m) as object); if (s) s.answered = true; });
    on('undici:request:trailers', m => { requests.delete(req(m) as object); });
    on('undici:request:error', m => { requests.delete(req(m) as object); });
    const host = (m: Record<string, unknown>) => (m.connectParams as { hostname?: unknown } | undefined)?.hostname;
    on('undici:client:beforeConnect', m => { if (host(m) === HOST) connecting++; });
    on('undici:client:connected', m => { if (host(m) === HOST) { connecting = Math.max(0, connecting - 1); connectedTotal++; lastConnectAt = Date.now(); } });
    on('undici:client:connectError', m => { if (host(m) === HOST) { connecting = Math.max(0, connecting - 1); connectErrors++; } });
    const { monitorEventLoopDelay } = await import('node:perf_hooks');
    const h = monitorEventLoopDelay({ resolution: 20 });
    h.enable();
    loop = h;
  } catch { /* not Node: nothing to watch */ }
}

/** What's pending for Fedizen right now, by stage, with the oldest wait in each; and the event loop's delay. */
export function fedizenRequestStages(now = Date.now()) {
  const stages: Partial<Record<Stage, { count: number; oldestMs: number }>> = {};
  for (const [key, r] of requests) {
    // A request never finished nor failed after 5 minutes is let go (its events were missed).
    if (now - r.at > 5 * 60_000) { requests.delete(key); continue; }
    const stage: Stage = !r.sent ? 'waiting for a connection' : !r.answered ? 'sent, waiting for an answer' : 'answered, still reading';
    const s = stages[stage] ?? { count: 0, oldestMs: 0 };
    s.count++;
    s.oldestMs = Math.max(s.oldestMs, now - r.at);
    stages[stage] = s;
  }
  const ms = (ns: number) => Math.round(ns / 1e6);
  const eventLoop = loop ? { p99Ms: ms(loop.percentile(99)), maxMs: ms(loop.max) } : undefined;
  loop?.reset();
  return {
    pending: stages,
    connecting,
    connected: connectedTotal,
    connectErrors,
    secondsSinceLastConnect: lastConnectAt ? Math.round((now - lastConnectAt) / 1000) : null,
    ...(eventLoop ? { eventLoop } : {}),
  };
}

export function _resetFedizenRequestStages() { requests.clear(); connecting = connectedTotal = connectErrors = lastConnectAt = 0; }
export const _stagesInternals = { requests };
