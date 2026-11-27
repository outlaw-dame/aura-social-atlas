/**
 * Live updates (GET /api/live): one stream per open Atlas tab, from Fedizen to the browser, with the Fedizen token kept
 * on the server — the browser only ever sees Atlas's events (live-events.ts).
 *
 * Upstream it prefers Mastodon's WebSocket streaming API on Fedizen (the `user` stream: new posts in Home, edits,
 * deletes and notifications), opened from the Worker with the token in a header. Where the runtime
 * can't open an outgoing WebSocket, or Fedizen refuses the upgrade, it reads Bonfire's SSE stream at the same path
 * instead (notifications, messages and the unread count, but not posts; /api/v1-bonfire/streaming). On Node (Railway),
 * where a fetch can't upgrade, it opens the same WebSocket with ws-client.server.ts, the token again only in
 * Sec-WebSocket-Protocol (Node's own WebSocket refuses Fedizen's handshake, which names no subprotocol back). Downstream it's Server-Sent Events, with a heartbeat; each stream ends after MAX_MS and the
 * browser reconnects, so no connection lives forever.
 *
 * openUpstream is the Fedizen side alone, shared with live-hub.server.ts (one connection per person, kept on a
 * Durable Stream so tabs resume without missing events).
 */
import { FEDIZEN, fromStatuses } from './fedizen-feed';
import { fromBonfireSse, fromMastoFrame, readSse, toSse, type LiveEvent } from './live-events';
import { fedizenFetch } from './fedizen-connections';

const MAX_MS = 25 * 60_000, HEARTBEAT_MS = 25_000;
const STREAM = `${FEDIZEN}/api/v1/streaming`;
// Bonfire's own SSE stream (bonfire_notify StreamingController, routed under /api/v1-bonfire since Feb 2026); the
// Mastodon path above is WebSocket only.
const SSE_STREAM = `${FEDIZEN}/api/v1-bonfire/streaming`;

type CfSocket = { accept(): void; close(code?: number, reason?: string): void; addEventListener(t: 'message' | 'close' | 'error', l: (e: { data?: unknown }) => void): void };

type WsLike = { close(code?: number): void; addEventListener(t: 'open' | 'message' | 'close' | 'error', l: (e: { data?: unknown }) => void): void };
/** Opens a WebSocket with the token as its only subprotocol. */
type WsOpen = (url: string, protocol: string) => WsLike;
// Node, not Cloudflare's runtime (which upgrades through fetch above and has WebSocketPair).
const onNode = typeof process !== 'undefined' && !!process.versions?.node && !(globalThis as { WebSocketPair?: unknown }).WebSocketPair;

/** Fedizen access and the runtime's WebSocket client, swappable in tests. */
export const liveDeps: {
  server: () => Promise<{ tokenFor(uid: string): Promise<{ access_token: string } | null>; liveStatus(raw: unknown): unknown | null }>;
  /** Node only (Railway): ws-client.server.ts, which accepts Fedizen's handshake without a subprotocol. */
  openWs: (() => Promise<WsOpen>) | undefined;
} = {
  server: () => import('./fedizen.server') as never,
  openWs: onNode ? async () => (await import('./ws-client.server')).openWebSocket : undefined,
};

/** What goes to the browser: Atlas's own events only (never the token or Bonfire's text). */
export type Outgoing = { type: string } & Record<string, unknown>;
const WS_OPEN_MS = 8_000;

/**
 * Opens Fedizen's stream for `userId` and passes each event to `out`, in order: `ready` (with whether posts come too)
 * once connected, `off` (and the end) when there's no connection to Fedizen or access ended. `done` is called once,
 * when the upstream ends for any reason. Returns a function that closes it.
 */
export function openUpstream(userId: string, out: (e: Outgoing) => void, done: () => void): () => void {
  let closed = false;
  const cleanups: (() => void)[] = [];
  const finish = () => {
    if (closed) return;
    closed = true;
    cleanups.forEach(f => { try { f(); } catch { /* already gone */ } });
    done();
  };
  let check: ((raw: unknown) => unknown | null) | null = null;
  // Events go out in the order they came in.
  let queue = Promise.resolve();
  const emit = (e: LiveEvent | null) => { if (e) queue = queue.then(() => send(e)).catch(() => {}); return queue; };
  const send = async (e: LiveEvent) => {
    if (closed) return;
    if (e.type === 'post') {
      const st = check?.(e.status);
      const post = st ? fromStatuses([st as never])[0] : undefined;
      if (post) out({ type: 'post', post, ...(e.edited ? { edited: true } : {}) });
      return;
    }
    out(e as Outgoing);
  };
  const onFrame = (ev: { data?: unknown }) => { if (typeof ev.data === 'string' && ev.data.length < 1_000_000) void emit(fromMastoFrame(ev.data)); };

  const start = async () => {
    const { tokenFor, liveStatus } = await liveDeps.server();
    check = liveStatus;
    const t = await tokenFor(userId);
    if (closed) return;
    if (!t) { out({ type: 'off', reason: 'not-connected' }); finish(); return; }
    const auth = { Authorization: `Bearer ${t.access_token}` };

    // Mastodon's WebSocket API, where the runtime has outgoing WebSockets (Cloudflare Workers: a fetch with Upgrade).
    try {
      // Bonfire reads the token from Sec-WebSocket-Protocol, as many Mastodon clients send it (its Authorization lookup
      // only sees x- headers: MastoStreamingWebSocket.resolve_token); never from the URL, where it would be logged.
      const res = await fedizenFetch(`${STREAM}?stream=user`, { headers: { ...auth, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': t.access_token }, redirect: 'manual' });
      const ws = (res as Response & { webSocket?: CfSocket | null }).webSocket;
      if (res.status === 101 && ws) {
        ws.accept();
        cleanups.push(() => ws.close(1000, 'done'));
        ws.addEventListener('message', onFrame);
        ws.addEventListener('close', finish);
        ws.addEventListener('error', finish);
        out({ type: 'ready', posts: true });
        return;
      }
      try { await res.body?.cancel(); } catch { /* nothing to drop */ }
    } catch { /* no upgrade by fetch here */ }
    if (closed) return;

    // Node: Atlas's own WebSocket client (ws-client.server.ts), the token only in Sec-WebSocket-Protocol. If Fedizen
    // won't take it, SSE below.
    const load = liveDeps.openWs;
    const open = load ? await load().catch(e => { console.warn('Fedizen WebSocket client failed to load', { name: (e as Error)?.name }); return undefined; }) : undefined;
    if (open) {
      // Listeners go on before the handshake ends, so nothing that arrives with it (or a close right after) is missed:
      // messages wait in `early` until the connection is taken, and a close before that is a failed open.
      let taken = false, gone = false;
      const early: { data?: unknown }[] = [];
      const opened = await new Promise<WsLike | null>(resolve => {
        let ws: WsLike;
        try { ws = open(`${STREAM.replace(/^https:/, 'wss:')}?stream=user`, t.access_token); } catch { resolve(null); return; }
        const timer = setTimeout(() => { if (!gone) console.warn('Fedizen WebSocket not used; reading SSE', { why: 'no-open' }); gone = true; try { ws.close(); } catch { /* gone */ } resolve(null); }, WS_OPEN_MS);
        const fail = (ev?: { data?: unknown }) => {
          clearTimeout(timer);
          if (taken) { finish(); return; }
          // Why Fedizen's WebSocket wasn't used (status or error code only), so a fallback to SSE is visible in logs.
          if (!gone) console.warn('Fedizen WebSocket not used; reading SSE', ev?.data ?? { why: 'closed' });
          gone = true; resolve(null);
        };
        ws.addEventListener('message', ev => { if (taken) onFrame(ev); else early.push(ev); });
        ws.addEventListener('close', () => fail());
        ws.addEventListener('error', fail);
        ws.addEventListener('open', () => { clearTimeout(timer); if (!gone) resolve(ws); });
      });
      if (closed) { try { opened?.close(1000); } catch { /* gone */ } return; }
      if (opened && !gone) {
        taken = true;
        cleanups.push(() => opened.close(1000));
        out({ type: 'ready', posts: true });
        for (const ev of early.splice(0)) onFrame(ev);
        return;
      }
    }

    // Bonfire's own SSE stream: notifications, messages and the unread count.
    const up = new AbortController();
    cleanups.push(() => up.abort());
    const res = await fedizenFetch(SSE_STREAM, { headers: { ...auth, Accept: 'text/event-stream' }, signal: up.signal, redirect: 'manual' }).catch(() => null);
    if (closed) return;
    if (!res?.ok || !res.body) { out({ type: 'off', reason: res && (res.status === 401 || res.status === 403) ? 'expired' : 'unavailable' }); finish(); return; }
    out({ type: 'ready', posts: false });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done: end } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
      if (end || closed) break;
      const r = readSse(buf + value);
      buf = r.rest;
      for (const e of r.events) await emit(fromBonfireSse(e));
    }
    finish();
  };
  void start().catch(finish);
  return finish;
}


export function liveStream(userId: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const cleanups: (() => void)[] = [];
  const write = (s: string) => { if (!closed) { try { ctl.enqueue(enc.encode(s)); } catch { finish(); } } };
  const finish = () => {
    if (closed) return;
    closed = true;
    cleanups.forEach(f => { try { f(); } catch { /* already gone */ } });
    try { ctl.close(); } catch { /* already closed */ }
  };
  return new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
      write('retry: 10000\n\n');
      const beat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      const stop = setTimeout(finish, MAX_MS);
      cleanups.push(() => clearInterval(beat), () => clearTimeout(stop));
      signal.addEventListener('abort', finish, { once: true });
      const close = openUpstream(userId, e => write(toSse(e)), finish);
      cleanups.push(close);
    },
    cancel() { finish(); },
  });
}
