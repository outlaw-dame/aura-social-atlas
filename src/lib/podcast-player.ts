import { useSyncExternalStore } from 'react';
import type { FediEpisode } from './podcast-episode';

/**
 * One audio element for all of Atlas, so only one episode plays at a time and playback survives the card scrolling
 * out of view. Every card subscribes to the same state; the Media Session API puts the episode on the lock screen
 * and headphone controls (skip back 15 s, forward 30 s, as Apple Podcasts does).
 */

export const SKIP_BACK = 15;
export const SKIP_FORWARD = 30;

export type PlayerState = {
  /** The episode loaded into the player (its page URL), if any. */
  current?: string;
  playing: boolean;
  /** Waiting for audio to arrive. */
  loading: boolean;
  time: number;
  duration?: number;
  error?: boolean;
};

let state: PlayerState = { playing: false, loading: false, time: 0 };
let audio: HTMLAudioElement | null = null;
let episode: FediEpisode | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<PlayerState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };

function element(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'none';
  const sync = () => set({ time: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : episode?.duration });
  a.addEventListener('timeupdate', sync);
  a.addEventListener('durationchange', sync);
  a.addEventListener('loadedmetadata', sync);
  a.addEventListener('playing', () => set({ playing: true, loading: false, error: false }));
  a.addEventListener('pause', () => set({ playing: false, loading: false }));
  a.addEventListener('waiting', () => set({ loading: true }));
  a.addEventListener('ended', () => set({ playing: false, time: a.duration || state.time }));
  a.addEventListener('error', () => set({ playing: false, loading: false, error: true }));
  audio = a;
  return a;
}

function mediaSession(ep: FediEpisode) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const art = ep.image ?? ep.podcast.avatar;
  navigator.mediaSession.metadata = new MediaMetadata({ title: ep.title, artist: ep.podcast.name, album: ep.podcast.acct, artwork: art ? [{ src: art }] : [] });
  const on = (a: MediaSessionAction, h: MediaSessionActionHandler) => { try { navigator.mediaSession.setActionHandler(a, h); } catch { /* unsupported action */ } };
  on('play', () => void element().play());
  on('pause', () => element().pause());
  on('seekbackward', d => skip(-(d.seekOffset ?? SKIP_BACK)));
  on('seekforward', d => skip(d.seekOffset ?? SKIP_FORWARD));
  on('seekto', d => { if (d.seekTime != null) seek(d.seekTime); });
}

/** Starts playback; a rejection counts as an error only if it isn't a deliberate abort (pausing, or switching
 *  episodes, while the audio is still loading) and the episode is still the one loaded. */
function start(a: HTMLAudioElement, url: string) {
  void a.play().catch((e: unknown) => {
    if (state.current !== url) return;
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    set({ loading: false, ...(aborted ? {} : { error: true }) });
  });
}

/** Play this episode (loading it first if another was playing), or pause it. */
export function toggle(ep: FediEpisode) {
  const a = element();
  if (state.current !== ep.url) {
    a.pause();
    episode = ep;
    a.src = ep.audio.src;
    set({ current: ep.url, playing: false, loading: true, time: 0, duration: ep.duration, error: false });
    mediaSession(ep);
    start(a, ep.url);
    return;
  }
  if (a.paused) { set({ loading: true, error: false }); start(a, ep.url); }
  else a.pause();
}

export function seek(seconds: number) {
  const a = audio;
  if (!a) return;
  const end = Number.isFinite(a.duration) ? a.duration : state.duration ?? Infinity;
  a.currentTime = Math.max(0, Math.min(seconds, end));
  set({ time: a.currentTime });
}
export const skip = (by: number) => { if (audio) seek(audio.currentTime + by); };

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const IDLE: PlayerState = { playing: false, loading: false, time: 0 };

/** The player's state as it concerns one episode card. */
export function useEpisodePlayback(ep: FediEpisode) {
  const s = useSyncExternalStore(subscribe, () => state, () => IDLE);
  const mine = s.current === ep.url;
  return {
    active: mine,
    playing: mine && s.playing,
    loading: mine && s.loading,
    error: mine && !!s.error,
    time: mine ? s.time : 0,
    duration: (mine ? s.duration : undefined) ?? ep.duration,
  };
}
