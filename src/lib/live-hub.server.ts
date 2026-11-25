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
 */
import { DurableStream } from '@durable-streams/client';
import { openUpstream, type Outgoing } from './live.server';
import type { DurableConfig } from './assistant/durable.server';

export const IDLE_MS = 10 * 60_000;
export const STREAM_TTL_SECONDS = 60 * 60;
const SWEEP_MS = 60_000;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

type Hub = {
  id: string;
  userId: string;
  lastRead: number;
  stream: DurableStream;
  ready: Promise<void>;
  closeUpstream: (() => void) | null;
  attempt: number;
  retry: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  /** Whether posts come too (Fedizen's WebSocket), from the last `ready`; null before one. */
  posts: boolean | null;
};

export const hubDeps = {
  now: () => Date.now(),
  open: openUpstream,
  stream: (url: string, token: string) => new DurableStream({ url, headers: { Authorization: `Bearer ${token}` }, contentType: 'application/json' }),
};

const hubs = new Map<string, Hub>(); // by Atlas user
const byId = new Map<string, Hub>();
let sweeper: ReturnType<typeof setInterval> | null = null;

export const hubPath = (id: string) => `live/${id}`;
export const hubReadPath = (id: string) => `/api/live-stream/${id}`;

function append(h: Hub, e: Outgoing) {
  if (h.closed) return;
  // Appends queue in order inside the client, after the stream exists.
  void h.ready.then(() => h.stream.append(JSON.stringify(e))).catch(() => undefined);
}

function close(h: Hub, last?: Outgoing) {
  if (h.closed) return;
  if (last) append(h, last);
  h.closed = true;
  if (h.retry) clearTimeout(h.retry);
  try { h.closeUpstream?.(); } catch { /* gone */ }
  h.closeUpstream = null;
  void h.ready.then(() => h.stream.close()).catch(() => undefined);
  if (hubs.get(h.userId) === h) hubs.delete(h.userId);
  byId.delete(h.id);
}

function connect(h: Hub) {
  if (h.closed) return;
  const reconnecting = h.attempt > 0;
  let ended = false;
  h.closeUpstream = hubDeps.open(h.userId, e => {
    if (e.type === 'ready') {
      if (reconnecting) append(h, { type: 'resync' });
      h.attempt = 0;
      h.posts = e.posts === true;
    }
    append(h, e);
    if (e.type === 'off') close(h);
  }, () => {
    if (ended) return;
    ended = true;
    h.closeUpstream = null;
    if (h.closed) return;
    if (hubDeps.now() - h.lastRead > IDLE_MS) { close(h); return; }
    const wait = BACKOFF_MS[Math.min(h.attempt, BACKOFF_MS.length - 1)];
    h.attempt++;
    h.retry = setTimeout(() => { h.retry = null; connect(h); }, wait);
  });
}

function sweep() {
  const now = hubDeps.now();
  for (const h of [...hubs.values()]) if (now - h.lastRead > IDLE_MS) close(h);
  if (!hubs.size && sweeper) { clearInterval(sweeper); sweeper = null; }
}

/** This person's hub, started if there's none: its id and where the browser reads it. */
export function hubFor(cfg: DurableConfig, userId: string): { id: string; streamUrl: string; posts: boolean | null } {
  let h = hubs.get(userId);
  if (!h || h.closed) {
    const id = crypto.randomUUID();
    const stream = hubDeps.stream(`${cfg.base}/${hubPath(id)}`, cfg.token);
    h = {
      id, userId, lastRead: hubDeps.now(), stream, closeUpstream: null, attempt: 0, retry: null, closed: false, posts: null,
      ready: stream.create({ contentType: 'application/json', ttlSeconds: STREAM_TTL_SECONDS }).then(() => undefined),
    };
    const hub = h;
    // A stream that can't be made: the hub is closed and the browser falls back to /api/live.
    hub.ready.catch(() => close(hub));
    hubs.set(userId, h);
    byId.set(id, h);
    connect(h);
    sweeper ??= setInterval(sweep, SWEEP_MS);
    (sweeper as { unref?: () => void }).unref?.();
  }
  h.lastRead = hubDeps.now();
  return { id: h.id, streamUrl: hubReadPath(h.id), posts: h.posts };
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
