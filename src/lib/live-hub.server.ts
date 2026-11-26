/**
 * Live updates that don't miss anything (server only), on Durable Streams.
 *
 * Mastodon's streaming API, which Fedizen speaks, has no way to replay what a client missed, so every reconnect of
 * /api/live (every 25 minutes, a hidden tab, a dropped connection, a refresh) lost what happened in between, and pages
 * re-read their feeds to catch up. Here each person gets one hub: one connection to Fedizen (openUpstream in
 * live.server.ts), whatever number of tabs and devices they have open, and every event it passes on is appended to a
 * Durable Stream of their own on Atlas's private stream server. A tab reads that stream through
 * /api/live-stream/$hubId and remembers how far it got, so when it comes back it reads from there: nothing missed and
 * nothing twice.
 *
 * - A hub stays while it's read: each read marks it, and one not read for IDLE_MS is closed (Fedizen connection
 *   closed, stream closed and left to expire after STREAM_TTL_SECONDS).
 * - If Fedizen's side drops, the hub reconnects with backoff and appends `resync` before the new `ready`: events may
 *   have been missed upstream, so readers refresh what they show (the one gap no stream can fill).
 * - `off` (no Fedizen connection, or access ended) is appended and the hub closes; readers wait for a change of session.
 * - Hubs live in this server's memory: after a restart a reader's hub is gone (404), it asks for a new one and treats
 *   that as a gap too.
 * - Only the events live.server.ts already sends the browser go on the stream: never the Fedizen token.
 * - A hub's stream is replaced every ROTATE_MS (`rotate` on the old one: readers move to the new one from its start,
 *   missing nothing), and Fedizen's connection renewed every RENEW_MS, the new one up before the old one closes, with
 *   post and delete ids de-duplicated while they overlap.
 * - An append that fails closes the hub, so readers come back and catch up rather than silently miss an event.
 * - When Fedizen's side can't send posts (Bonfire's SSE, used while Fedizen's WebSocket refuses Atlas), the hub checks
 *   Home itself, once per person however many tabs, and appends new posts as `post` events, oldest first: every tab gets
 *   them at once and their own checks drop to a safety net. Every POLL_MIN_MS while posts turn up, slowing to
 *   POLL_MAX_MS; only while a tab is reading; more new posts than one page holds is a `resync` (tabs check Home).
 */
import { DurableStream } from '@durable-streams/client';
import { openUpstream, type Outgoing } from './live.server';
import { fromStatuses, type FedizenPost } from './fedizen-feed';
import type { DurableConfig } from './assistant/durable.server';

export const IDLE_MS = 10 * 60_000;
export const STREAM_TTL_SECONDS = 60 * 60;
/** A hub's stream is replaced by a fresh one this often, so a tab left open for days doesn't grow one without end. */
export const ROTATE_MS = 6 * 60 * 60_000;
/**
 * Fedizen's connection is renewed this often, the new one opened before the old is closed, so a connection that went
 * quiet without closing can't leave a hub silent for long — and the renewal itself misses nothing.
 */
export const RENEW_MS = 30 * 60_000;
const SWEEP_MS = 60_000;
/** Home checks on the server while Fedizen's side sends no posts (same rhythm as a tab's own checks, capped lower). */
export const POLL_MIN_MS = 30_000, POLL_MAX_MS = 120_000;
const SEEN_KEEP = 100;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

type Hub = {
  id: string;
  userId: string;
  lastRead: number;
  createdAt: number;
  stream: DurableStream;
  ready: Promise<void>;
  /** The Fedizen connection in use, by generation; a renewal briefly has two. */
  upstreams: Map<number, () => void>;
  gen: number;
  connectedAt: number;
  attempt: number;
  retry: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  /** Whether posts come too (Fedizen's WebSocket), from the last `ready`; null before one. */
  posts: boolean | null;
  /** While two connections overlap: post and delete ids already passed on, so neither goes on the stream twice. */
  overlapUntil: number;
  recent: Set<string>;
  /** Tabs reading the stream right now (the read route counts them). */
  readers: number;
  /** Checking Home on the server: while Fedizen's side sends no posts. */
  poll: { on: boolean; timer: ReturnType<typeof setTimeout> | null; delay: number; last: number; seen: string[] | null; running: boolean };
};

export const hubDeps = {
  now: () => Date.now(),
  /** How long a renewed and an old connection overlap. */
  overlapMs: 10_000,
  /** The server's Home checks: soonest and slowest. */
  pollMinMs: POLL_MIN_MS,
  pollMaxMs: POLL_MAX_MS,
  open: openUpstream,
  stream: (url: string, token: string) => new DurableStream({ url, headers: { Authorization: `Bearer ${token}` }, contentType: 'application/json' }),
  /** The newest page of this person's Home, as Atlas's posts; null when it can't be read right now. */
  home: async (userId: string): Promise<FedizenPost[] | null> => {
    const { tokenFor, fedizenGet } = await import('./fedizen.server');
    const t = await tokenFor(userId);
    if (!t) return null;
    // The same read as a tab's check (getFedizenHomeLatest), so the server's micro-cache joins them.
    const r = await fedizenGet(t.access_token, '/api/v1/timelines/home?limit=20');
    return r.status === 200 ? fromStatuses(r.data as never) : null;
  },
  /**
   * What a tab's own check adds to new posts (getFedizenHomeLatest): verified creators, episodes and videos. Only the
   * posts being passed on, so the check itself stays one read.
   */
  enrich: async (userId: string, posts: FedizenPost[]): Promise<FedizenPost[]> => {
    const [{ tokenFor }, { withArticleAuthors }] = await Promise.all([import('./fedizen.server'), import('./feed-enrich.server')]);
    const t = await tokenFor(userId);
    return t ? withArticleAuthors(posts, 1200, t.access_token) : posts;
  },
};

const hubs = new Map<string, Hub>(); // by Atlas user
const byId = new Map<string, Hub>();
let sweeper: ReturnType<typeof setInterval> | null = null;

export const hubPath = (id: string) => `live/${id}`;
export const hubReadPath = (id: string) => `/api/live-stream/${id}`;

function newStream(cfg: { base: string; token: string }, id: string) {
  const stream = hubDeps.stream(`${cfg.base}/${hubPath(id)}`, cfg.token);
  const ready = stream.create({ contentType: 'application/json', ttlSeconds: STREAM_TTL_SECONDS }).then(() => undefined);
  return { stream, ready };
}

function append(h: Hub, e: Outgoing) {
  if (h.closed) return;
  const { stream, ready } = h;
  // Appends queue in order inside the client, after the stream exists. One that fails means readers could miss it:
  // the hub is closed, so they come back for a new one and catch up (resync) rather than silently miss events.
  void ready.then(() => stream.append(JSON.stringify(e))).catch(() => { if (h.stream === stream) close(h); });
}

function close(h: Hub, last?: Outgoing) {
  if (h.closed) return;
  if (last) append(h, last);
  h.closed = true;
  if (h.retry) clearTimeout(h.retry);
  stopPolling(h);
  for (const c of h.upstreams.values()) { try { c(); } catch { /* gone */ } }
  h.upstreams.clear();
  const { stream, ready } = h;
  void ready.then(() => stream.close()).catch(() => undefined);
  if (hubs.get(h.userId) === h) hubs.delete(h.userId);
  byId.delete(h.id);
}

/** A short fingerprint of an edit's content, so two different edits of one post are never taken for the same. */
function fingerprint(v: unknown): string {
  const t = JSON.stringify(v) ?? '';
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${t.length}:${(h >>> 0).toString(36)}`;
}

const identity = (e: Outgoing): string | null =>
  e.type === 'post' && e.post && typeof e.post === 'object'
    ? `p:${(e.post as { id?: unknown }).id}${e.edited ? `:e:${fingerprint(e.post)}` : ''}`
    : e.type === 'delete' && typeof e.id === 'string' ? `d:${e.id}` : null;

/** Passes on a post unless it already went on the stream (a renewal's overlap, or the server's own check). */
function passOn(h: Hub, e: Outgoing): boolean {
  const key = identity(e);
  if (key) {
    if (h.recent.has(key) && (e.type !== 'post' || h.poll.on || hubDeps.now() < h.overlapUntil)) return false;
    h.recent.add(key);
    if (h.recent.size > 500) h.recent.delete(h.recent.values().next().value!);
  }
  append(h, e);
  return true;
}

function stopPolling(h: Hub) {
  h.poll.on = false;
  if (h.poll.timer) clearTimeout(h.poll.timer);
  h.poll.timer = null;
}

function startPolling(h: Hub) {
  if (h.poll.on || h.closed) return;
  h.poll.on = true;
  h.poll.delay = hubDeps.pollMinMs;
  schedulePoll(h, 0);
}

/** The next check: only while a tab is reading (reading again starts it, readerOpened). */
function schedulePoll(h: Hub, wait: number) {
  if (h.poll.timer) clearTimeout(h.poll.timer);
  h.poll.timer = null;
  if (!h.poll.on || h.closed || h.readers <= 0) return;
  h.poll.timer = setTimeout(() => { h.poll.timer = null; void pollOnce(h); }, wait);
  (h.poll.timer as { unref?: () => void }).unref?.();
}

async function pollOnce(h: Hub) {
  if (!h.poll.on || h.closed || h.poll.running) return;
  h.poll.running = true;
  h.poll.last = hubDeps.now();
  let found = false;
  try {
    const posts = await hubDeps.home(h.userId).catch(() => null);
    if (!posts || h.closed || !h.poll.on) return;
    const ids = posts.map(p => p.id);
    const seen = h.poll.seen;
    if (seen) {
      const known = new Set(seen);
      const fresh = posts.filter(p => !known.has(p.id));
      if (fresh.length) {
        found = true;
        // Nothing on this page was seen before: more arrived than one page holds. Tabs check Home and show the gap.
        if (seen.length && !posts.some(p => known.has(p.id))) append(h, { type: 'resync' });
        else {
          const ready = await hubDeps.enrich(h.userId, fresh.reverse()).catch(() => fresh);
          if (h.closed || !h.poll.on) return;
          for (const post of ready) passOn(h, { type: 'post', post });
        }
      }
    }
    // The first check only notes where Home is: tabs read their own first page.
    h.poll.seen = [...ids, ...(seen ?? []).filter(id => !ids.includes(id))].slice(0, SEEN_KEEP);
  } finally {
    h.poll.running = false;
    h.poll.delay = found ? hubDeps.pollMinMs : Math.min(hubDeps.pollMaxMs, Math.round(h.poll.delay * 1.5));
    schedulePoll(h, h.poll.delay);
  }
}

/** A tab started reading the hub (the read route); call the returned function when it stops. */
export function readerOpened(userId: string, id: string): () => void {
  const h = byId.get(id);
  if (!h || h.userId !== userId) return () => undefined;
  h.readers++;
  h.lastRead = hubDeps.now();
  // Coming back to a hub that checks Home: check now if it's been a while, else carry on where it was.
  if (h.poll.on && !h.poll.timer && !h.poll.running) schedulePoll(h, Math.max(0, h.poll.delay - (hubDeps.now() - h.poll.last)));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    h.readers = Math.max(0, h.readers - 1);
    h.lastRead = hubDeps.now();
    if (h.readers === 0 && h.poll.timer) { clearTimeout(h.poll.timer); h.poll.timer = null; }
  };
}

/** `body`, calling `done` once however it ends: read to the end, failed partway, or cancelled by the reader. */
export function releaseOnEnd(body: ReadableStream<Uint8Array>, done: () => void): ReadableStream<Uint8Array> {
  const upstream = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const r = await upstream.read();
        if (r.done) { done(); c.close(); } else c.enqueue(r.value);
      } catch (e) { done(); c.error(e); }
    },
    cancel(reason) { done(); return upstream.cancel(reason); },
  });
}

/** Opens a Fedizen connection for the hub. `renewal`: a planned one, opened before the old one is closed. */
function connect(h: Hub, renewal = false) {
  if (h.closed) return;
  const gen = ++h.gen;
  const reconnecting = h.attempt > 0;
  let ended = false;
  h.upstreams.set(gen, () => undefined); // until open() returns its closer
  const closeThis = hubDeps.open(h.userId, e => {
    if (h.closed || !h.upstreams.has(gen)) return;
    if (e.type === 'ready') {
      if (reconnecting && !renewal) append(h, { type: 'resync' });
      h.attempt = 0;
      // Posts from Fedizen's side, or from the hub's own Home checks: either way, tabs get them on the stream.
      if (e.posts === true) stopPolling(h); else startPolling(h);
      h.posts = true;
      e = { ...e, posts: true, ...(h.poll.on ? { checked: true } : {}) };
      h.connectedAt = hubDeps.now();
      // The renewal is up: the older connections go, after a short overlap so nothing between them is missed.
      for (const [g, c] of h.upstreams) if (g !== gen) {
        h.overlapUntil = hubDeps.now() + hubDeps.overlapMs;
        setTimeout(() => { h.upstreams.delete(g); try { c(); } catch { /* gone */ } }, hubDeps.overlapMs);
      }
    }
    if (e.type === 'post' || e.type === 'delete') passOn(h, e); else append(h, e);
    if (e.type === 'off') close(h);
  }, () => {
    if (ended) return;
    ended = true;
    const wasCurrent = h.upstreams.has(gen) && gen === h.gen;
    h.upstreams.delete(gen);
    // An older connection closed after a renewal, or the hub is gone: nothing to do.
    if (h.closed || !wasCurrent) return;
    if (idle(h, hubDeps.now())) { close(h); return; }
    const wait = BACKOFF_MS[Math.min(h.attempt, BACKOFF_MS.length - 1)];
    h.attempt++;
    h.retry = setTimeout(() => { h.retry = null; connect(h); }, wait);
  });
  if (h.upstreams.has(gen)) h.upstreams.set(gen, closeThis); else { try { closeThis(); } catch { /* gone */ } }
}

/** A fresh stream for the hub: new events go there; the old one says where (`rotate`) and closes. Same connection. */
function rotate(h: Hub, cfg: { base: string; token: string }) {
  const old = { id: h.id, stream: h.stream, ready: h.ready };
  const id = crypto.randomUUID();
  const next = newStream(cfg, id);
  h.id = id; h.stream = next.stream; h.ready = next.ready; h.createdAt = hubDeps.now();
  byId.delete(old.id); byId.set(id, h);
  next.ready.catch(() => { if (h.stream === next.stream) close(h); });
  void old.ready.then(() => old.stream.append(JSON.stringify({ type: 'rotate' }))).then(() => old.stream.close()).catch(() => undefined);
}

let config: { base: string; token: string } | null = null;

/**
 * Not read for IDLE_MS: no tab has had it open since. A tab still reading keeps it (an SSE read can stay open for a
 * long time), up to a bound in case a read's end went unnoticed.
 */
const idle = (h: Hub, now: number) => now - h.lastRead > (h.readers > 0 ? 2 * ROTATE_MS : IDLE_MS);

function sweep() {
  const now = hubDeps.now();
  for (const h of [...hubs.values()]) {
    if (idle(h, now)) { close(h); continue; }
    if (config && now - h.createdAt > ROTATE_MS) rotate(h, config);
    if (h.connectedAt && now - h.connectedAt > RENEW_MS && h.upstreams.size === 1 && !h.retry) { h.connectedAt = now; connect(h, true); }
  }
  if (!hubs.size && sweeper) { clearInterval(sweeper); sweeper = null; }
}

/** This person's hub, started if there's none: its id and where the browser reads it. */
export function hubFor(cfg: DurableConfig, userId: string): { id: string; streamUrl: string; posts: boolean | null } {
  config = cfg;
  let h = hubs.get(userId);
  if (!h || h.closed) {
    const id = crypto.randomUUID();
    const { stream, ready } = newStream(cfg, id);
    h = {
      id, userId, lastRead: hubDeps.now(), createdAt: hubDeps.now(), stream, ready, upstreams: new Map(), gen: 0, connectedAt: 0,
      attempt: 0, retry: null, closed: false, posts: null, overlapUntil: 0, recent: new Set(),
      readers: 0, poll: { on: false, timer: null, delay: POLL_MIN_MS, last: 0, seen: null, running: false },
    };
    const hub = h;
    // A stream that can't be made: the hub is closed and the browser falls back to /api/live.
    ready.catch(() => { if (hub.ready === ready) close(hub); });
    hubs.set(userId, h);
    byId.set(id, h);
    connect(h);
    sweeper ??= setInterval(sweep, SWEEP_MS);
    (sweeper as { unref?: () => void }).unref?.();
  }
  h.lastRead = hubDeps.now();
  return { id: h.id, streamUrl: hubReadPath(h.id), posts: h.posts };
}

/**
 * hubFor, once its stream exists on the stream server (at most `waitMs`): null when it couldn't be made, so the
 * browser uses /api/live this time rather than a hub nobody can read.
 */
export async function readyHubFor(cfg: DurableConfig, userId: string, waitMs = 3_000): Promise<ReturnType<typeof hubFor> | null> {
  const r = hubFor(cfg, userId);
  const h = byId.get(r.id);
  if (!h) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ok = await Promise.race([h.ready.then(() => true, () => false), new Promise<boolean>(res => { timer = setTimeout(() => res(false), waitMs); })]);
  clearTimeout(timer);
  return ok && !h.closed ? { id: h.id, streamUrl: hubReadPath(h.id), posts: h.posts } : null;
}

/** Whether `id` is this person's open hub; marks it read. */
export function touchHub(userId: string, id: string): boolean {
  const h = byId.get(id);
  if (!h || h.closed || h.userId !== userId) return false;
  h.lastRead = hubDeps.now();
  return true;
}

/** For tests. */
export function _resetHubs() {
  for (const h of [...hubs.values()]) close(h);
  hubs.clear();
  byId.clear();
  if (sweeper) { clearInterval(sweeper); sweeper = null; }
}
export const _sweep = sweep;
