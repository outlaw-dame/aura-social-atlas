import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('../src/lib/fedizen.server', () => ({
  tokenFor: async (uid: string) => (uid === 'u1' ? { access_token: 'secret-token', scope: 'read write follow' } : null),
  liveStatus: (s: unknown) => (s && typeof s === 'object' && 'id' in s ? s : null),
}));
const { liveStream } = await import('../src/lib/live.server');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
async function readAll(s: ReadableStream<Uint8Array>, until: (t: string) => boolean): Promise<string> {
  const r = s.pipeThrough(new TextDecoderStream()).getReader();
  let out = '';
  for (;;) { const { value, done } = await r.read(); if (done) break; out += value; if (until(out)) { await r.cancel(); break; } }
  return out;
}

describe('Live updates stream', () => {
  test('not connected to Fedizen: says so and ends', async () => {
    const out = await readAll(liveStream('nobody', new AbortController().signal), () => false);
    expect(out).toContain('"type":"off","reason":"not-connected"');
  });
  test('the WebSocket path relays posts and deletes, never the token', async () => {
    const listeners: Record<string, ((e: { data?: unknown }) => void)[]> = {};
    const ws = { accept() {}, close() {}, addEventListener: (t: string, l: (e: { data?: unknown }) => void) => { (listeners[t] ??= []).push(l); } };
    const seen: { url: string; auth: string | null; upgrade: string | null; proto: string | null }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      seen.push({ url: String(url), auth: h.get('authorization'), upgrade: h.get('upgrade'), proto: h.get('sec-websocket-protocol') });
      return { status: 101, webSocket: ws, body: null } as unknown as Response;
    }) as unknown as typeof fetch;
    const stream = liveStream('u1', new AbortController().signal);
    const reading = readAll(stream, t => t.includes('event: delete'));
    await new Promise(r => setTimeout(r, 20));
    listeners.message.forEach(l => l({ data: JSON.stringify({ stream: ['user'], event: 'update', payload: JSON.stringify({ id: '01A', content: '<p>Hello live</p>', account: { acct: 'ann', display_name: 'Ann' } }) }) }));
    listeners.message.forEach(l => l({ data: JSON.stringify({ event: 'delete', payload: '01B' }) }));
    const out = await reading;
    expect(seen[0]).toEqual({ url: 'https://fedizen.net/api/v1/streaming?stream=user', auth: 'Bearer secret-token', upgrade: 'websocket', proto: 'secret-token' });
    expect(out).toContain('"type":"ready","posts":true');
    expect(out).toContain('event: post');
    expect(out).toContain('Hello live');
    expect(out).toContain('"type":"delete","id":"01B"');
    expect(out).not.toContain('secret-token');
  });
  test('without WebSockets it reads Bonfire SSE: notifications and the unread count', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      if (new Headers(init?.headers).get('upgrade')) return new Response('no', { status: 400 });
      return new Response('event: unseen_count\ndata: {"count":2}\n\nevent: notification\ndata: {"title":"Ann liked","url":"https://fedizen.net/x"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const out = await readAll(liveStream('u1', new AbortController().signal), () => false);
    expect(out).toContain('"type":"ready","posts":false');
    expect(out).toContain('"type":"unseen","count":2');
    expect(out).toContain('event: notification');
    expect(out).not.toContain('Ann liked'); // Bonfire's own text and links aren't passed on
  });
});
