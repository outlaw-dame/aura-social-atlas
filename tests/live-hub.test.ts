import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { _resetHubs, _sweep, hubDeps, hubFor, IDLE_MS, STREAM_TTL_SECONDS, touchHub } from '../src/lib/live-hub.server';
import type { Outgoing } from '../src/lib/live.server';
import { hubUrl } from '../src/components/social/LiveUpdates';

const cfg = { base: 'http://streams.internal:4437/v1/stream', token: 't'.repeat(40) };

// A stream that records what's appended, and an upstream the test drives.
type Fake = { url: string; created?: unknown; appended: Outgoing[]; closed: boolean };
let streams: Fake[] = [];
let upstreams: { userId: string; out: (e: Outgoing) => void; done: () => void; closed: boolean }[] = [];
let now = 0;
const realOpen = hubDeps.open, realStream = hubDeps.stream, realNow = hubDeps.now;

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
afterEach(() => { _resetHubs(); hubDeps.open = realOpen; hubDeps.stream = realStream; hubDeps.now = realNow; });
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

describe('the browser side', () => {
  test("reads only Atlas's own hub route", () => {
    const id = crypto.randomUUID();
    expect(hubUrl(`/api/live-stream/${id}`, 'https://atlas.test/app')).toBe(`https://atlas.test/api/live-stream/${id}`);
    expect(() => hubUrl(`https://evil.test/api/live-stream/${id}`, 'https://atlas.test/')).toThrow();
    expect(() => hubUrl('/api/live-stream/session', 'https://atlas.test/')).toThrow();
  });

  test('resumes from where this tab read; a new hub means catching up the old way', () => {
    const src = readFileSync('src/components/social/LiveUpdates.tsx', 'utf8');
    expect(src).toMatch(/const offset = saved\?\.hub === id \? saved\.offset : 'now';/);
    expect(src).toMatch(/if \(saved && saved\.hub !== id\) resync\(\);/);
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
