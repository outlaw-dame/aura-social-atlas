import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/*
 * ws-client.server.ts runs on Node (Railway), so it's tested on Node: Bun (1.3 in CI) doesn't emit node:http's
 * `upgrade` event. The client is bundled for Node, and a script runs each case against a server that behaves like
 * Fedizen's (Phoenix): it reads the token from Sec-WebSocket-Protocol and answers without naming one.
 */
let dir = '';
let results: Record<string, unknown> = {};

const SCRIPT = (client: string, ws: string) => `
import { openWebSocket } from ${JSON.stringify(client)};
import { WebSocketServer } from ${JSON.stringify(ws)};
const until = async (cond, ms = 4000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 10)); };
const serve = (opts, onConn) => new Promise(r => { const s = new WebSocketServer({ port: 0, ...opts }); if (onConn) s.on('connection', onConn); s.on('listening', () => r(s)); });
const collect = ws => { const got = []; for (const t of ['open', 'message', 'close', 'error']) ws.addEventListener(t, e => got.push({ type: t, data: e.data })); return got; };
const out = {};

{ // the handshake names no subprotocol; the token goes only there
  let token, url;
  const s = await serve({ handleProtocols: () => false }, (w, req) => { token = req.headers['sec-websocket-protocol']; url = req.url; w.send(JSON.stringify({ event: 'delete', payload: '01A' })); });
  const ws = openWebSocket('ws://127.0.0.1:' + s.address().port + '/api/v1/streaming?stream=user', 'tok_abc-123');
  const got = collect(ws);
  await until(() => got.some(g => g.type === 'message'));
  out.handshake = { token, url, first: got[0]?.type, message: got.find(g => g.type === 'message')?.data };
  ws.close(); s.close();
}
{ // large and fragmented messages; pings answered
  let ponged = false;
  const big = 'x'.repeat(70000);
  const s = await serve({ handleProtocols: () => false }, w => { w.on('pong', () => { ponged = true; }); w.ping(); w.send(big); w.send('part one ', { fin: false }); w.send('and two', { fin: true }); });
  const ws = openWebSocket('ws://127.0.0.1:' + s.address().port + '/', 't');
  const got = collect(ws);
  await until(() => got.filter(g => g.type === 'message').length >= 2 && ponged);
  const msgs = got.filter(g => g.type === 'message').map(g => g.data);
  out.messages = { bigOk: msgs[0] === big, fragmented: msgs[1], ponged };
  ws.close(); s.close();
}
{ // a refused handshake is an error, never an open
  const s = await serve({ verifyClient: (_i, cb) => cb(false, 403) });
  const ws = openWebSocket('ws://127.0.0.1:' + s.address().port + '/', 'bad');
  const got = collect(ws);
  await until(() => got.length > 0);
  out.refused = got.map(g => g.type);
  s.close();
}
{ // closing from either side
  let serverSawClose = false;
  const s = await serve({ handleProtocols: () => false }, w => { w.on('close', () => { serverSawClose = true; }); });
  const ws = openWebSocket('ws://127.0.0.1:' + s.address().port + '/', 't');
  const got = collect(ws);
  await until(() => got.some(g => g.type === 'open'));
  ws.close();
  await until(() => serverSawClose);
  const s2 = await serve({ handleProtocols: () => false }, w => setTimeout(() => w.close(1001), 20));
  const ws2 = openWebSocket('ws://127.0.0.1:' + s2.address().port + '/', 't');
  const got2 = collect(ws2);
  await until(() => got2.some(g => g.type === 'close'));
  out.closing = { ours: got.map(g => g.type), serverSawClose, theirs: got2.map(g => g.type) };
  s.close(); s2.close();
}
console.log(JSON.stringify(out));
process.exit(0);
`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-ws-'));
  const built = await Bun.build({ entrypoints: [resolve('src/lib/ws-client.server.ts')], target: 'node', format: 'esm', outdir: dir });
  if (!built.success) throw new Error('could not bundle ws-client for Node');
  const script = join(dir, 'run.mjs');
  writeFileSync(script, SCRIPT(join(dir, 'ws-client.server.js'), resolve('node_modules/ws/wrapper.mjs')));
  const p = Bun.spawn(['node', script], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  const line = stdout.trim().split('\n').pop() ?? '';
  try { results = JSON.parse(line); } catch { throw new Error(`node run failed: ${stderr.slice(0, 500)}`); }
}, 60_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("Atlas's WebSocket client for Fedizen, on Node", () => {
  test('accepts a handshake that names no subprotocol, sending the token only there', () => {
    expect(results.handshake).toEqual({ token: 'tok_abc-123', url: '/api/v1/streaming?stream=user', first: 'open', message: '{"event":"delete","payload":"01A"}' });
  });
  test('large and fragmented messages arrive whole; pings are answered', () => {
    expect(results.messages).toEqual({ bigOk: true, fragmented: 'part one and two', ponged: true });
  });
  test('a refused handshake is an error, never an open', () => {
    expect(results.refused).toEqual(['error']);
  });
  test('closing from our side tells the server; the server closing is a close', () => {
    expect(results.closing).toEqual({ ours: ['open', 'close'], serverSawClose: true, theirs: ['open', 'close'] });
  });
});
