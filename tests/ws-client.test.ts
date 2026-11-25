import { afterEach, describe, expect, test } from 'bun:test';
import { WebSocketServer } from 'ws';
import { openWebSocket } from '../src/lib/ws-client.server';

// A server that behaves like Fedizen's (Phoenix): reads the token from Sec-WebSocket-Protocol and answers without one.
let server: WebSocketServer | null = null;
afterEach(() => new Promise<void>(r => { if (!server) return r(); server.close(() => r()); server = null; }));
function fedizenLike(onConnection: (ws: import('ws').WebSocket, token: string | undefined) => void): Promise<number> {
  return new Promise(resolve => {
    server = new WebSocketServer({ port: 0, handleProtocols: () => false });
    server.on('connection', (ws, req) => onConnection(ws, req.headers['sec-websocket-protocol']));
    server.on('listening', () => resolve((server!.address() as { port: number }).port));
  });
}
const collect = (ws: ReturnType<typeof openWebSocket>) => {
  const got: { type: string; data?: unknown }[] = [];
  for (const t of ['open', 'message', 'close', 'error'] as const) ws.addEventListener(t, e => got.push({ type: t, data: e.data }));
  return got;
};
const until = async (cond: () => boolean, ms = 3000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 10)); };

describe("Atlas's WebSocket client for Fedizen", () => {
  test('accepts a handshake that names no subprotocol, sending the token only there', async () => {
    let token: string | undefined, url: string | undefined;
    const port = await fedizenLike((ws, t) => { token = t; ws.send(JSON.stringify({ event: 'delete', payload: '01A' })); });
    server!.on('connection', (_ws, req) => { url = req.url; });
    const ws = openWebSocket(`ws://127.0.0.1:${port}/api/v1/streaming?stream=user`, 'tok_abc-123');
    const got = collect(ws);
    await until(() => got.some(g => g.type === 'message'));
    expect(token).toBe('tok_abc-123');
    expect(url).toBe('/api/v1/streaming?stream=user');
    expect(got[0].type).toBe('open');
    expect(got.find(g => g.type === 'message')?.data).toBe('{"event":"delete","payload":"01A"}');
    ws.close();
  });

  test('large and fragmented messages arrive whole; pings are answered', async () => {
    const big = 'x'.repeat(70_000);
    let ponged = false;
    const port = await fedizenLike(ws => {
      ws.on('pong', () => { ponged = true; });
      ws.ping();
      ws.send(big);
      ws.send('part one ', { fin: false });
      ws.send('and two', { fin: true });
    });
    const ws = openWebSocket(`ws://127.0.0.1:${port}/`, 't');
    const got = collect(ws);
    await until(() => got.filter(g => g.type === 'message').length >= 2 && ponged);
    const msgs = got.filter(g => g.type === 'message').map(g => g.data);
    expect(msgs[0]).toBe(big);
    expect(msgs[1]).toBe('part one and two');
    expect(ponged).toBe(true);
    ws.close();
  });

  test('a refused handshake is an error, never an open', async () => {
    const port = await new Promise<number>(resolve => {
      server = new WebSocketServer({ port: 0, verifyClient: (_i, cb) => cb(false, 403) });
      server.on('listening', () => resolve((server!.address() as { port: number }).port));
    });
    const ws = openWebSocket(`ws://127.0.0.1:${port}/`, 'bad');
    const got = collect(ws);
    await until(() => got.length > 0);
    expect(got.map(g => g.type)).toEqual(['error']);
  });

  test("the server closing is a close; closing from our side tells the server", async () => {
    let serverSawClose = false;
    const port = await fedizenLike(ws => { ws.on('close', () => { serverSawClose = true; }); });
    const ws = openWebSocket(`ws://127.0.0.1:${port}/`, 't');
    const got = collect(ws);
    await until(() => got.some(g => g.type === 'open'));
    ws.close();
    await until(() => serverSawClose);
    expect(serverSawClose).toBe(true);
    expect(got.map(g => g.type)).toEqual(['open', 'close']);

    const port2 = await new Promise<number>(resolve => {
      const s2 = new WebSocketServer({ port: 0, handleProtocols: () => false });
      s2.on('connection', w => setTimeout(() => w.close(1001), 20));
      s2.on('listening', () => resolve((s2.address() as { port: number }).port));
      const prev = server; server = s2; void prev?.close();
    });
    const ws2 = openWebSocket(`ws://127.0.0.1:${port2}/`, 't');
    const got2 = collect(ws2);
    await until(() => got2.some(g => g.type === 'close'));
    expect(got2.map(g => g.type)).toEqual(['open', 'close']);
  });
});
