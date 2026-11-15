import { useSyncExternalStore } from 'react';
import type { FediVideo } from './fedi-video';
import { claimMedia } from './media-focus';

/**
 * One video element for all of Atlas, so a video keeps playing while you browse, the way Arc's Mini Player does:
 * it plays inside its post while the post is on screen, and when you scroll away or leave the page it floats in a
 * small player in the corner (resizable, movable, with a way back to the post). The element is moved between the
 * post and the floating player rather than recreated; a media element moved within the same task keeps playing
 * (HTML's "removed from a document" steps only pause it if it is still detached at the next stable state).
 */

export type VideoState = {
  video?: FediVideo;
  /** Where it shows: inside its post, floating, or nowhere (nothing loaded). */
  mode: 'inline' | 'floating' | 'none';
  playing: boolean;
  loading: boolean;
  muted: boolean;
  time: number;
  duration?: number;
  error?: boolean;
};

let state: VideoState = { mode: 'none', playing: false, loading: false, muted: false, time: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<VideoState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };

let el: HTMLVideoElement | null = null;
/** Bumped on every load and on close, so a load that resolves late (hls.js arriving) can tell it's stale. */
let generation = 0;
let hls: { destroy(): void } | null = null;
let dock: HTMLElement | null = null;
/** Posts showing the loaded video, and whether each is on screen. */
const hosts = new Map<HTMLElement, boolean>();

function element(): HTMLVideoElement {
  if (el) return el;
  const v = document.createElement('video');
  v.playsInline = true;
  v.preload = 'metadata';
  v.className = 'atlas-video-el';
  const sync = () => set({ time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : state.video?.duration });
  v.addEventListener('timeupdate', sync);
  v.addEventListener('loadedmetadata', sync);
  v.addEventListener('playing', () => { claimMedia('video', () => v.pause()); if (state.video) mediaSession(state.video); set({ playing: true, loading: false, error: false }); });
  v.addEventListener('pause', () => set({ playing: false, loading: false }));
  v.addEventListener('waiting', () => set({ loading: true }));
  v.addEventListener('volumechange', () => set({ muted: v.muted }));
  v.addEventListener('error', () => set({ playing: false, loading: false, error: true }));
  el = v;
  return v;
}

let frame: HTMLElement | null = null;
/** The floating player: a fixed frame on <body>, outside React so it survives page changes. Its controls are a
 *  React portal into the same frame (VideoDock). Shown only while a video floats. */
export function dockFrame(): HTMLElement {
  if (frame) return frame;
  frame = document.createElement('div');
  frame.className = 'atlas-pip';
  frame.dataset.corner = 'br';
  frame.hidden = true;
  dock = document.createElement('div');
  dock.className = 'atlas-pip-slot';
  frame.appendChild(dock);
  document.body.appendChild(frame);
  return frame;
}
function dockSlot(): HTMLElement { dockFrame(); return dock!; }

/** Puts the element where it should be: the first visible post showing it, else the floating player. */
function place() {
  const v = el;
  if (!v || !state.video) return;
  const visible = [...hosts].find(([, on]) => on)?.[0];
  const target = visible ?? (state.playing || state.loading || v.currentTime > 0 ? dockSlot() : [...hosts.keys()][0]);
  if (target && v.parentElement !== target) target.appendChild(v);
  v.controls = !!visible;
  const mode = visible ? 'inline' : target === dock ? 'floating' : 'inline';
  dockFrame().hidden = mode !== 'floating';
  if (mode !== state.mode) set({ mode });
}

/** Loads the video; false if another load or a close superseded it meanwhile. */
async function load(v: HTMLVideoElement, video: FediVideo): Promise<boolean> {
  const mine = ++generation;
  hls?.destroy(); hls = null;
  v.removeAttribute('src');
  v.poster = video.poster ?? '';
  const file = video.sources.find(s => !s.type || v.canPlayType(s.type)) ?? video.sources[0];
  const nativeHls = !!video.hls && v.canPlayType('application/vnd.apple.mpegurl') !== '';
  if (video.hls && (nativeHls || !file)) {
    if (nativeHls) v.src = video.hls;
    else {
      const { default: Hls } = await import('hls.js');
      if (mine !== generation) return false;
      if (!Hls.isSupported()) { if (file) v.src = file.src; else set({ error: true }); return true; }
      const h = new Hls({ capLevelToPlayerSize: true });
      h.loadSource(video.hls);
      h.attachMedia(v);
      hls = h;
    }
  } else if (file) v.src = file.src;
  else set({ error: true });
  return true;
}

/** Lock-screen and headphone controls follow whatever is playing: when the video takes over, its handlers replace
 *  the podcast player's (which re-registers its own when it plays again). */
function mediaSession(video: FediVideo) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: video.title ?? 'Video', artist: video.creator?.name ?? '', artwork: video.poster ? [{ src: video.poster }] : [] });
  const on = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { navigator.mediaSession.setActionHandler(a, h); } catch { /* unsupported */ } };
  on('play', () => { void el?.play().catch(() => undefined); });
  on('pause', () => el?.pause());
  on('seekbackward', d => { if (el) seekVideo(el.currentTime - (d.seekOffset ?? 10)); });
  on('seekforward', d => { if (el) seekVideo(el.currentTime + (d.seekOffset ?? 10)); });
  on('seekto', d => { if (d.seekTime != null) seekVideo(d.seekTime); });
}

/** Play this video in its post (loading it if another was playing), or pause it. */
export async function playVideo(video: FediVideo) {
  const v = element();
  if (state.video?.url !== video.url) {
    v.pause();
    set({ video, mode: 'inline', playing: false, loading: true, time: 0, duration: video.duration, error: false });
    if (!(await load(v, video)) || state.video?.url !== video.url) return;
  }
  place();
  v.play().catch((e: unknown) => { if (!(e instanceof DOMException && e.name === 'AbortError')) set({ loading: false, error: true }); });
}
export function togglePlay() { const v = el; if (!v) return; if (v.paused) void v.play().catch(() => undefined); else v.pause(); }
export function toggleMute() { if (el) el.muted = !el.muted; }
export function seekVideo(t: number) { if (el) el.currentTime = Math.max(0, Math.min(t, Number.isFinite(el.duration) ? el.duration : t)); }

/** Close: stop and unload the video, and drop the floating player. */
export function closeVideo() {
  const v = el;
  generation++;
  if (v) { v.pause(); hls?.destroy(); hls = null; v.removeAttribute('src'); v.load(); v.remove(); }
  if (frame) frame.hidden = true;
  set({ video: undefined, mode: 'none', playing: false, loading: false, time: 0, duration: undefined, error: false });
}

/** System picture-in-picture (outside the browser window), where the browser offers it. */
export async function systemPip() {
  const v = el;
  if (!v || typeof document === 'undefined' || !document.pictureInPictureEnabled) return;
  try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); } catch { /* refused */ }
}
export const canSystemPip = () => typeof document !== 'undefined' && !!document.pictureInPictureEnabled;

/** A post registers where its video should show; `visible` changes as it scrolls. Returns an unregister. */
export function hostVideo(url: string, slot: HTMLElement, visible: boolean): () => void {
  if (state.video?.url !== url) return () => undefined;
  hosts.set(slot, visible);
  place();
  return () => { hosts.delete(slot); place(); };
}
export function setHostVisible(slot: HTMLElement, visible: boolean) {
  if (!hosts.has(slot)) return;
  hosts.set(slot, visible);
  place();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const IDLE: VideoState = { mode: 'none', playing: false, loading: false, muted: false, time: 0 };
export function useVideoState(): VideoState {
  return useSyncExternalStore(subscribe, () => state, () => IDLE);
}
