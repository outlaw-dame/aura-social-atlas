import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { _resetHubs, _sweep, hubDeps, hubFor, IDLE_MS, readerOpened, releaseOnEnd, readyHubFor, RENEW_MS, ROTATE_MS, STREAM_TTL_SECONDS, touchHub } from '../src/lib/live-hub.server';
import type { FedizenPost } from '../src/lib/fedizen-feed';
import type { Outgoing } from '../src/lib/live.server';
import { hubUrl } from '../src/components/social/LiveUpdates';

const cfg = { base: 'http://streams.internal:4437/v1/stream', token: 't'.repeat(40) };

// A stream that records what's appended, and an upstream the test drives.
type Fake = { url: string; created?: unknown; appended: Outgoing[]; closed: boolean };
let streams: Fake[] = [];
let upstreams: { userId: string; out: (e: Outgoing) => void; done: () => void; closed: boolean }[] = [];
let now = 0;
const realOpen = hubDeps.open, realStream = hubDeps.stream, realNow = hubDeps.now, realHome = hubDeps.home, realEnrich = hubDeps.enrich;

beforeEach(() => {
  streams = []; upstreams = []; now = 1_000_000;
  hubDeps.now = () => now;
  hubDeps.stream = ((url: string) => {
    const f: Fake = { url, appended: [], closed: false };
    streams.push(f);
    return {
      create: async (o: unknown) => { f.created = o; },
      append: async (body: string) => { f.appended.push(JSON.parse(body)); },
      close: async () => { f.closed = true; return { finalOffset: 'x' }; },
    } as never;
  }) as never;
  hubDeps.open = ((userId: string, out: (e: Outgoing) => void, done: () => void) => {
    const u = { userId, out, done, closed: false };
    upstreams.push(u);
    return () => { u.closed = true; };
  }) as never;
});
afterEach(() => { _resetHubs(); hubDeps.open = realOpen; hubDeps.stream = realStream; hubDeps.now = realNow; hubDeps.home = realHome; hubDeps.enrich = realEnrich; hubDeps.pollMinMs = 30_000; hubDeps.pollMaxMs = 120_000; });
const tick = () => new Promise(r => setTimeout(r, 5));

describe('one live hub per person, on a Durable Stream', () => {
  test('one Fedizen connection however many tabs ask; events go on the stream in order', async () => {
    const a = hubFor(cfg, 'u1'), b = hubFor(cfg, 'u1');
    expect(a.id).toBe(b.id);
    expect(upstreams.length).toBe(1);
    expect(a.streamUrl).toBe(`/api/live-stream/${a.id}`);
    expect(streams[0].url).toBe(`${cfg.base}/live/${a.id}`);
    expect(streams[0].created).toEqual({ contentType: 'application/json', ttlSeconds: STREAM_TTL_SECONDS });
    upstreams[0].out({ type: 'ready', posts: true });
    upstreams[0].out({ type: 'delete', id: '01B' });
    upstreams[0].out({ type: 'notification' });
    await tick();
    expect(streams[0].appended.map(e => e.type)).toEqual(['ready', 'delete', 'notification']);
    expect(hubFor(cfg, 'u1').posts).toBe(true);
    // Another person: their own hub.
    expect(hubFor(cfg, 'u2').id).not.toBe(a.id);
  });

  test('only its own person can read a hub', () => {
    const { id } = hubFor(cfg, 'u1');
    expect(touchHub('u1', id)).toBe(true);
    expect(touchHub('u2', id)).toBe(false);
    expect(touchHub('u1', crypto.randomUUID())).toBe(false);
  });

  test("Fedizen's side drops while it's read: reconnects, and says resync before the new ready", async () => {
    hubFor(cfg, 'u1');
    upstreams[0].out({ type: 'ready', posts: true });
    upstreams[0].done();
    await new Promise(r => setTimeout(r, 2_100));
    expect(upstreams.length).toBe(2);
    upstreams[1].out({ type: 'ready', posts: true });
    await tick();
    expect(streams[0].appended.map(e => e.type)).toEqual(['ready', 'resync', 'ready']);
  }, 5_000);

  test('not read for IDLE_MS: Fedizen connection and stream closed, and the hub is gone', async () => {
    const { id } = hubFor(cfg, 'u1');
    now += IDLE_MS + 1;
    _sweep();
    await tick();
    expect(upstreams[0].closed).toBe(true);
    expect(streams[0].closed).toBe(true);
    expect(touchHub('u1', id)).toBe(false);
    expect(hubFor(cfg, 'u1').id).not.toBe(id);
  });

  test('no Fedizen connection: off goes on the stream and the hub closes', async () => {
    const { id } = hubFor(cfg, 'u1');
    upstreams[0].out({ type: 'off', reason: 'not-connected' });
    await tick();
    expect(streams[0].appended).toEqual([{ type: 'off', reason: 'not-connected' }]);
    expect(streams[0].closed).toBe(true);
    expect(touchHub('u1', id)).toBe(false);
  });
});

describe('hardening', () => {
  test('an append that fails closes the hub, so readers come back and catch up', async () => {
    const { id } = hubFor(cfg, 'u1');
    upstreams[0].out({ type: 'ready', posts: true });
    await tick();
    // The stream server stops taking appends.
    streams[0].appended.push = () => { throw new Error('stream server gone'); };
    upstreams[0].out({ type: 'notification' });
    await tick();
    expect(touchHub('u1', id)).toBe(false);
    expect(upstreams[0].closed).toBe(true);
  });

  test('every ROTATE_MS the hub moves to a fresh stream: rotate on the old one, new events on the new', async () => {
    const first = hubFor(cfg, 'u1');
    upstreams[0].out({ type: 'ready', posts: true });
    await tick();
    now += ROTATE_MS + 1;
    hubFor(cfg, 'u1'); // a read: still active
    _sweep();
    await tick();
    upstreams[0].out({ type: 'notification' });
    await tick();
    const second = hubFor(cfg, 'u1');
    expect(second.id).not.toBe(first.id);
    expect(streams[0].appended.map(e => e.type)).toEqual(['ready', 'rotate']);
    expect(streams[0].closed).toBe(true);
    expect(streams[1].appended.map(e => e.type)).toEqual(['notification']);
    // Moving streams isn't a gap: no resync anywhere.
    expect([...streams[0].appended, ...streams[1].appended].some(e => e.type === 'resync')).toBe(false);
    expect(touchHub('u1', first.id)).toBe(false);
    expect(touchHub('u1', second.id)).toBe(true);
  });

  test('every RENEW_MS a new Fedizen connection comes up before the old goes; nothing twice, no resync', async () => {
    hubDeps.overlapMs = 30;
    try {
      hubFor(cfg, 'u1');
      upstreams[0].out({ type: 'ready', posts: true });
      await tick();
      now += RENEW_MS + 1;
      hubFor(cfg, 'u1');
      _sweep();
      expect(upstreams.length).toBe(2);
      upstreams[1].out({ type: 'ready', posts: true });
      // The same post from both while they overlap: once on the stream.
      upstreams[0].out({ type: 'post', post: { id: 'p1' } });
      upstreams[1].out({ type: 'post', post: { id: 'p1' } });
      await new Promise(r => setTimeout(r, 60));
      expect(upstreams[0].closed).toBe(true);
      upstreams[0].done(); // the old one closing doesn't start a reconnect
      upstreams[1].out({ type: 'delete', id: 'p9' });
      await tick();
      expect(streams[0].appended.map(e => e.type)).toEqual(['ready', 'ready', 'post', 'delete']);
      expect(upstreams.length).toBe(2);
    } finally {
      hubDeps.overlapMs = 10_000;
    }
  });
});

describe('overlap de-duplication', () => {
  test('the same edit from both connections is kept once; a later, different edit of the post is kept too', async () => {
    hubDeps.overlapMs = 30;
    try {
      hubFor(cfg, 'u1');
      upstreams[0].out({ type: 'ready', posts: true });
      await tick();
      now += RENEW_MS + 1;
      hubFor(cfg, 'u1');
      _sweep();
      upstreams[1].out({ type: 'ready', posts: true });
      const first = { id: 'p1', content: 'one', edited_at: '2026-11-25T10:00:00Z' };
      const second = { id: 'p1', content: 'two', edited_at: '2026-11-25T10:00:05Z' };
      upstreams[0].out({ type: 'post', post: first, edited: true });
      upstreams[1].out({ type: 'post', post: { ...first }, edited: true });
      upstreams[1].out({ type: 'post', post: second, edited: true });
      await tick();
      const edits = streams[0].appended.filter(e => e.type === 'post').map(e => (e.post as { content: string }).content);
      expect(edits).toEqual(['one', 'two']);
    } finally {
      hubDeps.overlapMs = 10_000;
    }
  });
});

describe("Fedizen's side sends no posts: the hub checks Home itself", () => {
  const post = (id: string) => ({ id, text: id }) as unknown as FedizenPost;
  let home: FedizenPost[] = [];
  let reads = 0;
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  beforeEach(() => {
    home = []; reads = 0;
    hubDeps.home = async () => { reads++; return home; };
    // What a tab's check adds (credits, episodes): marked so the test sees it went through.
    hubDeps.enrich = async (_u, posts) => posts.map(p => ({ ...p, enriched: true }) as FedizenPost);
    hubDeps.pollMinMs = 20; hubDeps.pollMaxMs = 40;
  });

  test('new Home posts go on the stream, oldest first, once; tabs are told posts come', async () => {
    const { id } = hubFor(cfg, 'u1');
    const done = readerOpened('u1', id);
    home = [post('p2'), post('p1')];
    upstreams[0].out({ type: 'ready', posts: false });
    await wait(10);
    expect(reads).toBe(1); // where Home is now: nothing passed on
    home = [post('p4'), post('p3'), post('p2'), post('p1')];
    await wait(35);
    upstreams[0].out({ type: 'ready', posts: false }); // not a reconnect: just to see the stream so far
    await tick();
    const got = streams[0].appended;
    expect(got[0]).toEqual({ type: 'ready', posts: true, checked: true });
    expect(got.filter(e => e.type === 'post').map(e => (e.post as FedizenPost).id)).toEqual(['p3', 'p4']);
    expect(got.filter(e => e.type === 'post').every(e => (e.post as { enriched?: boolean }).enriched)).toBe(true);
    expect(hubFor(cfg, 'u1').posts).toBe(true);
    // Same page again: nothing twice.
    await wait(60);
    expect(streams[0].appended.filter(e => e.type === 'post').length).toBe(2);
    done();
  });

  test('more new posts than a page holds: resync instead, so tabs check Home', async () => {
    const { id } = hubFor(cfg, 'u1');
    const done = readerOpened('u1', id);
    home = [post('a1')];
    upstreams[0].out({ type: 'ready', posts: false });
    await wait(10);
    home = [post('b3'), post('b2'), post('b1')];
    await wait(35);
    expect(streams[0].appended.map(e => e.type)).toEqual(['ready', 'resync']);
    done();
  });

  test('no tab reading: no checks; reading again starts them', async () => {
    const { id } = hubFor(cfg, 'u1');
    upstreams[0].out({ type: 'ready', posts: false });
    await wait(60);
    expect(reads).toBe(0);
    const done = readerOpened('u1', id);
    await wait(10);
    expect(reads).toBe(1);
    done();
    const after = reads;
    await wait(60);
    expect(reads).toBe(after);
  });

  test("when Fedizen's WebSocket sends posts, the hub stops checking", async () => {
    const { id } = hubFor(cfg, 'u1');
    const done = readerOpened('u1', id);
    upstreams[0].out({ type: 'ready', posts: false });
    await wait(10);
    upstreams[0].out({ type: 'ready', posts: true });
    const after = reads;
    await wait(60);
    expect(reads).toBe(after);
    expect(streams[0].appended.at(-1)).toEqual({ type: 'ready', posts: true });
    done();
  });

  test('a tab still reading keeps the hub past IDLE_MS', async () => {
    const { id } = hubFor(cfg, 'u1');
    const done = readerOpened('u1', id);
    now += IDLE_MS + 1;
    _sweep();
    expect(touchHub('u1', id)).toBe(true);
    done();
    now += IDLE_MS + 1;
    _sweep();
    expect(touchHub('u1', id)).toBe(false);
  });

  test('the read route counts a reader until the read ends, however it ends', async () => {
    const route = readFileSync('src/routes/api/live-stream/$hubId.ts', 'utf8');
    expect(route).toMatch(/const done = readerOpened\(userId, params\.hubId\);/);
    expect(route).toMatch(/request\.signal\.addEventListener\("abort", done/);
    expect(route).toMatch(/releaseOnEnd\(res\.body, done\)/);
    const chunk = new Uint8Array([1]);
    const ends: string[] = [];
    // Read to the end.
    const r1 = releaseOnEnd(new ReadableStream({ start(c) { c.enqueue(chunk); c.close(); } }), () => ends.push('end')).getReader();
    while (!(await r1.read()).done) { /* read */ }
    // The stream server drops it partway.
    const r2 = releaseOnEnd(new ReadableStream({ start(c) { c.enqueue(chunk); }, pull(c) { c.error(new Error('reset')); } }), () => ends.push('error')).getReader();
    await r2.read();
    await r2.read().catch(() => undefined);
    // The browser goes away.
    const r3 = releaseOnEnd(new ReadableStream({ start(c) { c.enqueue(chunk); } }), () => ends.push('cancel')).getReader();
    await r3.read();
    await r3.cancel();
    expect(ends).toEqual(['end', 'error', 'cancel']);
  });

  test('readers released by an error leave no phantom: polling stops with the last tab', async () => {
    const { id } = hubFor(cfg, 'u1');
    upstreams[0].out({ type: 'ready', posts: false });
    for (let i = 0; i < 3; i++) {
      const done = readerOpened('u1', id);
      const r = releaseOnEnd(new ReadableStream({ pull(c) { c.error(new Error('reset')); } }), done).getReader();
      await r.read().catch(() => undefined);
    }
    await wait(10);
    const after = reads;
    await wait(60);
    expect(reads).toBe(after);
  });
});

describe('a stream server that does not answer', () => {
  test('no hub is handed out; the browser uses /api/live this time', async () => {
    hubDeps.stream = (() => ({ create: async () => { throw new Error('refused'); }, append: async () => {}, close: async () => ({}) })) as never;
    expect(await readyHubFor(cfg, 'u1', 100)).toBeNull();
    const src = readFileSync('src/components/social/LiveUpdates.tsx', 'utf8');
    expect(src).toMatch(/if \(s\.status === 503\) return 'not-now';/);
  });
  test('a ready hub is handed out with whether posts come', async () => {
    const p = readyHubFor(cfg, 'u1');
    expect((await p)?.streamUrl).toMatch(/^\/api\/live-stream\//);
  });
});

describe('the browser side', () => {
  test("reads only Atlas's own hub route", () => {
    const id = crypto.randomUUID();
    expect(hubUrl(`/api/live-stream/${id}`, 'https://atlas.test/app')).toBe(`https://atlas.test/api/live-stream/${id}`);
    expect(() => hubUrl(`https://evil.test/api/live-stream/${id}`, 'https://atlas.test/')).toThrow();
    expect(() => hubUrl('/api/live-stream/session', 'https://atlas.test/')).toThrow();
  });

  test('resumes from where this tab read; a new hub means catching up the old way', () => {
    const src = readFileSync('src/components/social/LiveUpdates.tsx', 'utf8');
    expect(src).toMatch(/const offset = saved\?\.hub === id \? saved\.offset : rotated \? '-1' : 'now';/);
    expect(src).toMatch(/if \(saved && saved\.hub !== id && !rotated\) resync\(\);/);
    expect(src).toMatch(/save\(user\.id, \{ hub: id, offset: batch\.offset \}\);/);
    expect(src).toMatch(/if \(event === 'resync'\) resync\(\);/);
    // Without streams on the server, /api/live as before.
    expect(src).toMatch(/if \(s\.status === 404\) return 'no';/);
  });

  test('reading a hub checks the person and that it is theirs', () => {
    const route = readFileSync('src/routes/api/live-stream/$hubId.ts', 'utf8');
    expect(route).toMatch(/if \(!userId\) return new Response/);
    expect(route).toMatch(/if \(!touchHub\(userId, params\.hubId\)\) return new Response\("Not found", \{ status: 404/);
  });
});
