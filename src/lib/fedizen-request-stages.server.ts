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
/** Requests that failed (timed out, aborted, refused) lately: the stage each was in and how long it had waited. */
const failed: { at: number; stage: Stage; waitedMs: number }[] = [];
const FAILED_KEEP_MS = 60_000, FAILED_MAX = 50;
const stageOf = (r: Req): Stage => !r.sent ? 'waiting for a connection' : !r.answered ? 'sent, waiting for an answer' : 'answered, still reading';
let connecting = 0, connectedTotal = 0, connectErrors = 0, lastConnectAt = 0;
let started: Promise<void> | null = null;
const channels: unknown[] = [];
let loop: { percentile(p: number): number; max: number; reset(): void } | null = null;

const isFedizen = (origin: unknown) => {
  try { return new URL(String(origin)).hostname === HOST; } catch { return String(origin) === HOST; }
};

/** Starts listening (Node only; nothing on runtimes without these modules). Safe to call more than once. */
export function watchFedizenRequests(): Promise<void> {
  // The same promise to every caller, so none goes on before the listeners are in place.
  return started ??= listen();
}

async function listen(): Promise<void> {
  try {
    const dc = await import('node:diagnostics_channel');
    // Each channel held here: a channel nobody holds can be collected with its subscribers (Bun does).
    const on = (name: string, fn: (m: Record<string, unknown>) => void) => {
      const ch = dc.channel(name);
      ch.subscribe(m => { try { fn(m as Record<string, unknown>); } catch { /* never break a request */ } });
      channels.push(ch);
    };
    const req = (m: Record<string, unknown>) => m.request as { origin?: unknown } | undefined;
    on('undici:request:create', m => { const r = req(m); if (r && isFedizen(r.origin)) requests.set(r, { at: Date.now(), sent: false, answered: false }); });
    on('undici:client:sendHeaders', m => { const s = requests.get(req(m) as object); if (s) s.sent = true; });
    on('undici:request:headers', m => { const s = requests.get(req(m) as object); if (s) s.answered = true; });
    on('undici:request:trailers', m => { requests.delete(req(m) as object); });
    // undici reports the error before fetch rejects, so before the pause is logged: keep where it failed.
    on('undici:request:error', m => {
      const key = req(m) as object, r = requests.get(key);
      if (!r) return;
      requests.delete(key);
      const now = Date.now();
      failed.push({ at: now, stage: stageOf(r), waitedMs: now - r.at });
      if (failed.length > FAILED_MAX) failed.shift();
    });
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

/**
 * What's pending for Fedizen right now, by stage, with the oldest wait in each; what failed in the last minute, by the
 * stage it failed in (the timeouts that paused reads are already failed when this is logged); and the event loop's delay.
 */
export function fedizenRequestStages(now = Date.now()) {
  const stages: Partial<Record<Stage, { count: number; oldestMs: number }>> = {};
  for (const [key, r] of requests) {
    // A request never finished nor failed after 5 minutes is let go (its events were missed).
    if (now - r.at > 5 * 60_000) { requests.delete(key); continue; }
    const stage = stageOf(r);
    const s = stages[stage] ?? { count: 0, oldestMs: 0 };
    s.count++;
    s.oldestMs = Math.max(s.oldestMs, now - r.at);
    stages[stage] = s;
  }
  while (failed.length && now - failed[0]!.at > FAILED_KEEP_MS) failed.shift();
  const failedLastMinute: Partial<Record<Stage, { count: number; longestMs: number }>> = {};
  for (const f of failed) {
    const s = failedLastMinute[f.stage] ?? { count: 0, longestMs: 0 };
    s.count++;
    s.longestMs = Math.max(s.longestMs, f.waitedMs);
    failedLastMinute[f.stage] = s;
  }
  const ms = (ns: number) => Math.round(ns / 1e6);
  const eventLoop = loop ? { p99Ms: ms(loop.percentile(99)), maxMs: ms(loop.max) } : undefined;
  loop?.reset();
  return {
    pending: stages,
    failedLastMinute,
    connecting,
    connected: connectedTotal,
    connectErrors,
    secondsSinceLastConnect: lastConnectAt ? Math.round((now - lastConnectAt) / 1000) : null,
    ...(eventLoop ? { eventLoop } : {}),
  };
}

export function _resetFedizenRequestStages() { requests.clear(); failed.length = 0; connecting = connectedTotal = connectErrors = lastConnectAt = 0; }
export const _stagesInternals = { requests, failed };
