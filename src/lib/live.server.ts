/**
 * Live updates (GET /api/live): one stream per open Atlas tab, from Fedizen to the browser, with the Fedizen token kept
 * on the server — the browser only ever sees Atlas's events (live-events.ts).
 *
 * Upstream it prefers Mastodon's WebSocket streaming API on Fedizen (the `user` stream: new posts in Home, edits,
 * deletes and notifications), opened from the Worker with the token in a header. Where the runtime
 * can't open an outgoing WebSocket, or Fedizen refuses the upgrade, it reads Bonfire's SSE stream at the same path
 * instead (notifications, messages and the unread count, but not posts). Downstream it's Server-Sent Events, with a
 * heartbeat; each stream ends after MAX_MS and the browser reconnects, so no connection lives forever.
 */
import { FEDIZEN, fromStatuses } from './fedizen-feed';
import { fromBonfireSse, fromMastoFrame, readSse, toSse, type LiveEvent } from './live-events';

const MAX_MS = 25 * 60_000, HEARTBEAT_MS = 25_000;
const STREAM = `${FEDIZEN}/api/v1/streaming`;

type CfSocket = { accept(): void; close(code?: number, reason?: string): void; addEventListener(t: 'message' | 'close' | 'error', l: (e: { data?: unknown }) => void): void };

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

  let check: ((raw: unknown) => unknown | null) | null = null;
  // Events go out in the order they came in.
  let queue = Promise.resolve();
  const emit = (e: LiveEvent | null) => { if (e) queue = queue.then(() => send(e)).catch(() => {}); return queue; };
  const send = async (e: LiveEvent) => {
    if (e.type === 'post') {
      const s = check?.(e.status);
      const post = s ? fromStatuses([s as never])[0] : undefined;
      if (post) write(toSse({ type: 'post', post, ...(e.edited ? { edited: true } : {}) }));
      return;
    }
    write(toSse(e));
  };

  const start = async () => {
    const { tokenFor, liveStatus } = await import('./fedizen.server');
    check = liveStatus;
    const t = await tokenFor(userId);
    if (!t) { write(toSse({ type: 'off', reason: 'not-connected' })); finish(); return; }
    write('retry: 10000\n\n');
    const auth = { Authorization: `Bearer ${t.access_token}` };

    // Mastodon's WebSocket API, where the runtime has outgoing WebSockets (Cloudflare Workers: a fetch with Upgrade).
    try {
      // Bonfire reads the token from Sec-WebSocket-Protocol, as many Mastodon clients send it (its Authorization lookup
      // only sees x- headers: MastoStreamingWebSocket.resolve_token); never from the URL, where it would be logged.
      const res = await fetch(`${STREAM}?stream=user`, { headers: { ...auth, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': t.access_token }, redirect: 'manual' });
      const ws = (res as Response & { webSocket?: CfSocket | null }).webSocket;
      if (res.status === 101 && ws) {
        ws.accept();
        cleanups.push(() => ws.close(1000, 'done'));
        ws.addEventListener('message', ev => { if (typeof ev.data === 'string' && ev.data.length < 1_000_000) void emit(fromMastoFrame(ev.data)); });
        ws.addEventListener('close', finish);
        ws.addEventListener('error', finish);
        write(toSse({ type: 'ready', posts: true }));
        return;
      }
      try { await res.body?.cancel(); } catch { /* nothing to drop */ }
    } catch { /* no outgoing WebSockets here: SSE below */ }

    // Bonfire's own SSE stream: notifications, messages and the unread count.
    const up = new AbortController();
    cleanups.push(() => up.abort());
    const res = await fetch(STREAM, { headers: { ...auth, Accept: 'text/event-stream' }, signal: up.signal, redirect: 'manual' }).catch(() => null);
    if (!res?.ok || !res.body) { write(toSse({ type: 'off', reason: res && (res.status === 401 || res.status === 403) ? 'expired' : 'unavailable' })); finish(); return; }
    write(toSse({ type: 'ready', posts: false }));
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
      if (done || closed) break;
      const r = readSse(buf + value);
      buf = r.rest;
      for (const e of r.events) await emit(fromBonfireSse(e));
    }
    finish();
  };

  return new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
      const beat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      const stop = setTimeout(finish, MAX_MS);
      cleanups.push(() => clearInterval(beat), () => clearTimeout(stop));
      signal.addEventListener('abort', finish, { once: true });
      void start().catch(finish);
    },
    cancel() { finish(); },
  });
}
