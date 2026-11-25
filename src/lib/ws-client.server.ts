/**
 * A small WebSocket client for Fedizen's streaming API on Node (server only).
 *
 * Bonfire (Fedizen) takes the access token as the WebSocket subprotocol, as Ice Cubes sends it
 * (bonfire_notify MastoStreamingWebSocket.resolve_token: the `access_token` query param, else the first
 * Sec-WebSocket-Protocol value; Phoenix only passes x- headers to connect, so not Authorization). It never answers with
 * a Sec-WebSocket-Protocol of its own, and RFC 6455 §4.1 has a client that asked for one fail the connection then — so
 * Node's built-in WebSocket and the `ws` package both refuse Fedizen's handshake. Putting the token in the URL instead
 * would write it into Fedizen's logs. This client does the handshake itself (RFC 6455 §4) and accepts the answer
 * without a subprotocol; the token is only ever sent in that header, over TLS.
 *
 * What it does: text messages (with continuation frames), answers pings, sends its own ping every PING_MS (Phoenix
 * closes a socket that hasn't heard from the client for 60 s), and treats IDLE_MS without any frame as a dead
 * connection. Server frames must be unmasked; ours are masked (§5.3). Messages over MAX_MESSAGE close it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const PING_MS = 25_000;
export const IDLE_MS = 75_000;
const MAX_MESSAGE = 4 * 1024 * 1024;
const HANDSHAKE_MS = 10_000;

export type WsEvent = 'open' | 'message' | 'close' | 'error';
export type MiniWs = { close(code?: number): void; addEventListener(t: WsEvent, l: (e: { data?: unknown }) => void): void };

function frame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const mask = randomBytes(4);
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, len >> 8, len & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 0x80 | 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

/** Opens `url` (ws: or wss:) with `protocol` as the only Sec-WebSocket-Protocol value. */
export function openWebSocket(url: string, protocol: string): MiniWs {
  const listeners: Record<WsEvent, ((e: { data?: unknown }) => void)[]> = { open: [], message: [], close: [], error: [] };
  const emit = (t: WsEvent, data?: unknown) => { for (const l of listeners[t]) { try { l({ data }); } catch { /* a listener's own problem */ } } };
  let socket: Duplex | null = null;
  let ended = false;
  let handshake: ReturnType<typeof setTimeout> | undefined, idle: ReturnType<typeof setTimeout> | undefined, ping: ReturnType<typeof setInterval> | undefined;
  const end = (why: 'close' | 'error') => {
    if (ended) return;
    ended = true;
    clearTimeout(handshake); clearTimeout(idle); clearInterval(ping);
    try { socket?.destroy(); } catch { /* gone */ }
    emit(why);
  };

  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const key = randomBytes(16).toString('base64');
  const req = (secure ? httpsRequest : httpRequest)({
    host: u.hostname, port: u.port || (secure ? 443 : 80), path: `${u.pathname}${u.search}`, method: 'GET',
    headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
      'Sec-WebSocket-Protocol': protocol, 'User-Agent': 'Atlas (live updates)',
    },
  });
  handshake = setTimeout(() => { req.destroy(); end('error'); }, HANDSHAKE_MS);
  req.on('error', () => end('error'));
  req.on('response', res => { res.resume(); end('error'); }); // anything but 101: refused
  req.on('upgrade', (res, sock, head) => {
    clearTimeout(handshake);
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    if (res.statusCode !== 101 || res.headers['sec-websocket-accept'] !== accept) { sock.destroy(); end('error'); return; }
    socket = sock;
    let buf: Buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    let parts: Buffer[] = [], partsLen = 0;
    const heard = () => { clearTimeout(idle); idle = setTimeout(() => end('close'), IDLE_MS); };
    ping = setInterval(() => { try { sock.write(frame(0x9)); } catch { end('error'); } }, PING_MS);
    heard();

    const read = () => {
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_MESSAGE)) { end('error'); return; } len = Number(big); off = 10; }
        if (masked) { end('error'); return; } // a server must not mask (§5.1)
        if (len > MAX_MESSAGE) { end('error'); return; }
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        heard();
        if (op === 0x9) { try { sock.write(frame(0xA, Buffer.from(payload))); } catch { end('error'); return; } continue; }
        if (op === 0xA) continue;
        if (op === 0x8) { try { sock.write(frame(0x8, Buffer.from(payload.subarray(0, 2)))); } catch { /* gone */ } end('close'); return; }
        if (op === 0x1 || op === 0x2 || op === 0x0) {
          if (op !== 0x0) { parts = []; partsLen = 0; }
          parts.push(Buffer.from(payload)); partsLen += payload.length;
          if (partsLen > MAX_MESSAGE) { end('error'); return; }
          if (fin) { const msg = Buffer.concat(parts); parts = []; partsLen = 0; if (op !== 0x2) emit('message', msg.toString('utf8')); }
          continue;
        }
        end('error'); return; // unknown opcode
      }
    };
    sock.on('data', (d: Buffer) => { buf = buf.length ? Buffer.concat([buf, d]) : d; if (buf.length > MAX_MESSAGE + 16) { end('error'); return; } read(); });
    sock.on('close', () => end('close'));
    sock.on('error', () => end('error'));
    emit('open');
    read();
  });
  req.end();

  return {
    close(code = 1000) {
      if (ended) return;
      const b = Buffer.alloc(2); b.writeUInt16BE(code);
      try { socket?.write(frame(0x8, b)); socket?.end(); } catch { /* gone */ }
      end('close');
    },
    addEventListener(t, l) { listeners[t].push(l); },
  };
}
