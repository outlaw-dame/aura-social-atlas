import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { stream as readStream } from '@durable-streams/client';
import { supabase } from '@/integrations/supabase/client';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { readSse } from '@/lib/live-events';
import { useAtlasAuth } from './AuthState';
import { markDeleted } from './useOwnPosts';

/**
 * Live updates in place of polling (GET /api/live, src/lib/live.server.ts). Mounted once per app (DesktopHosts,
 * AtlasMobileApp). While the page is visible it keeps one stream open: a new post in Home goes to the feed's "N new
 * posts" (useHomeTimeline listens for LIVE_POST_EVENT), a deleted one disappears, notifications and messages refresh
 * Activity and Messages, and the unread count is kept for badges. Hidden pages close the stream; it reconnects with
 * backoff, and Home falls back to its own checks whenever there's no stream with posts.
 *
 * Where the server keeps streams (src/lib/live-hub.server.ts), the events come from the person's live hub, a Durable
 * Stream: this tab remembers how far it read (sessionStorage) and, coming back after hiding, a dropped connection or a
 * refresh, reads on from there, so nothing is missed. When it can't (a new hub, or the hub says Fedizen's side
 * dropped: `resync`), it does what a missed event would have needed: Home checks, Activity and Messages refresh.
 * Without it, /api/live as before.
 */
export const LIVE_POST_EVENT = 'atlas-live-post';
export const LIVE_NOTICE_EVENT = 'atlas-live-notification';

type LiveState = { connected: boolean; posts: boolean; unseen: number | null };
let state: LiveState = { connected: false, posts: false, unseen: null };
const listeners = new Set<() => void>();
const set = (p: Partial<LiveState>) => { state = { ...state, ...p }; listeners.forEach(l => l()); };
const OFFSET_KEY = (uid: string) => `atlas-live-offset:${uid}`;
type Saved = { hub: string; offset: string };
function readSaved(uid: string): Saved | null {
  try { const v = JSON.parse(sessionStorage.getItem(OFFSET_KEY(uid)) ?? 'null') as Saved | null; return v && typeof v.hub === 'string' && typeof v.offset === 'string' ? v : null; } catch { return null; }
}
function save(uid: string, v: Saved) { try { sessionStorage.setItem(OFFSET_KEY(uid), JSON.stringify(v)); } catch { /* storage blocked: resumes from now */ } }

/** Only Atlas's own hub route: a URL from anywhere else is refused, so the sign-in token is never sent elsewhere. */
export function hubUrl(path: string, base: string): string {
  const u = new URL(path, base);
  if (u.origin !== new URL(base).origin || !/^\/api\/live-stream\/[0-9a-f-]{36}$/.test(u.pathname)) throw new Error('Unexpected live address');
  return u.toString();
}

export const useLiveState = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
/** For non-React code (the Home check rhythm): whether posts are arriving live. */
export const livePosts = () => state.connected && state.posts;

export function LiveUpdates() {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!user || typeof window === 'undefined' || typeof ReadableStream === 'undefined') return;
    let stop = false, ctrl: AbortController | null = null, wait = 2000, timer: ReturnType<typeof setTimeout> | undefined, off = false;
    let hubs: 'unknown' | 'yes' | 'no' = 'unknown';
    // What a missed event would have needed: Home checks (LIVE_NOTICE_EVENT), Activity and Messages refresh.
    const resync = () => {
      void qc.invalidateQueries({ queryKey: ['fedizen-notification-groups', user.id] });
      void qc.invalidateQueries({ queryKey: ['fedizen-messages', user.id] });
      window.dispatchEvent(new Event(LIVE_NOTICE_EVENT));
    };
    const handle = (event: string, data: string) => {
      let d: Record<string, unknown>;
      try { d = JSON.parse(data) as Record<string, unknown>; } catch { return; }
      handleEvent(event, d);
    };
    const handleEvent = (event: string, d: Record<string, unknown>) => {
      if (event === 'resync') resync();
      else if (event === 'ready') { set({ connected: true, posts: d.posts === true }); wait = 2000; }
      else if (event === 'post' && d.post && typeof d.post === 'object') window.dispatchEvent(new CustomEvent<{ post: FedizenPost; edited: boolean }>(LIVE_POST_EVENT, { detail: { post: d.post as FedizenPost, edited: d.edited === true } }));
      else if (event === 'delete' && typeof d.id === 'string') markDeleted(d.id);
      else if (event === 'notification') {
        void qc.invalidateQueries({ queryKey: ['fedizen-notification-groups', user.id] });
        void qc.invalidateQueries({ queryKey: ['fedizen-follow-requests'] });
        window.dispatchEvent(new Event(LIVE_NOTICE_EVENT));
      } else if (event === 'message') void qc.invalidateQueries({ queryKey: ['fedizen-messages', user.id] });
      else if (event === 'unseen' && typeof d.count === 'number') set({ unseen: d.count });
      else if (event === 'off') off = true; // not connected to Fedizen, or access ended: wait for a change of session
    };
    const bearer = async () => `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}`;
    /** Reads the person's live hub from where this tab left off. 'no' when the server keeps no streams. */
    const fromHub = async (signal: AbortSignal): Promise<'no' | 'read'> => {
      const s = await fetch('/api/live-stream/session', { headers: { Authorization: await bearer() }, signal, cache: 'no-store' });
      if (s.status === 404) return 'no';
      if (!s.ok) throw new Error(String(s.status));
      const { id, streamUrl, posts } = await s.json() as { id: string; streamUrl: string; posts?: boolean | null };
      const saved = readSaved(user.id);
      // A hub this tab hasn't read: start from now, and catch up on whatever the old one would have brought.
      const offset = saved?.hub === id ? saved.offset : 'now';
      if (saved && saved.hub !== id) resync();
      const res = await readStream<Record<string, unknown>>({
        url: hubUrl(streamUrl, window.location.href), live: 'sse', json: true, offset, signal,
        headers: { Authorization: bearer },
      });
      set({ connected: true, ...(typeof posts === 'boolean' ? { posts } : {}) });
      wait = 2000;
      res.subscribeJson(batch => {
        for (const e of batch.items) if (e && typeof e.type === 'string') handleEvent(e.type, e);
        save(user.id, { hub: id, offset: batch.offset });
      });
      await res.closed;
      return 'read';
    };
    const connect = async () => {
      if (stop || document.hidden || off) return;
      ctrl = new AbortController();
      try {
        if (hubs !== 'no') {
          const r = await fromHub(ctrl.signal);
          if (r === 'no') hubs = 'no'; else hubs = 'yes';
        }
        if (hubs === 'yes') throw new Error('hub read ended');
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch('/api/live', { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const r = readSse(buf + value);
          buf = r.rest;
          r.events.forEach(e => handle(e.event, e.data));
        }
      } catch { /* dropped, or aborted: reconnect below */ }
      set({ connected: false });
      if (!stop && !document.hidden && !off) { timer = setTimeout(() => void connect(), wait); wait = Math.min(60_000, wait * 2); }
    };
    const visible = () => {
      if (document.hidden) { ctrl?.abort(); clearTimeout(timer); set({ connected: false }); }
      else if (!ctrl || ctrl.signal.aborted) { wait = 2000; void connect(); }
    };
    void connect();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => { stop = true; ctrl?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); set({ connected: false, posts: false, unseen: null }); };
  }, [user, qc]);
  return null;
}
