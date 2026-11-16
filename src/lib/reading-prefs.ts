import { useSyncExternalStore } from 'react';

/**
 * How posts with content warnings and sensitive media are shown (Settings → Appearance), Mastodon's two reading
 * preferences:
 * - "Always expand posts marked with content warnings" (Mastodon: `reading:expand:spoilers`, default off);
 * - media: blur only media marked sensitive (the default), show all media, or hide all media
 *   (Mastodon: `reading:expand:media` = default / show_all / hide_all).
 * Fedizen's preferences endpoint always answers Mastodon's defaults and has nowhere to keep a change, so Atlas keeps
 * these on the device. A keyword filter that hides media still does, whatever the media setting (as on Mastodon).
 */
export const MEDIA_DISPLAY = [
  { id: 'default', name: 'Blur sensitive media', note: 'Media marked sensitive by its author is blurred until you open it.' },
  { id: 'show_all', name: 'Show all media', note: 'Media marked sensitive is shown right away.' },
  { id: 'hide_all', name: 'Blur all media', note: 'Every image and video is blurred until you open it.' },
] as const;
export type MediaDisplay = (typeof MEDIA_DISPLAY)[number]['id'];
export type ReadingPrefs = { expandWarnings: boolean; media: MediaDisplay };
export const DEFAULT_READING: ReadingPrefs = { expandWarnings: false, media: 'default' };
const KEY = 'atlas-reading';

export function parseReading(raw: string | null): ReadingPrefs {
  try {
    const v = raw ? JSON.parse(raw) as Partial<ReadingPrefs> : {};
    return {
      expandWarnings: v.expandWarnings === true,
      media: MEDIA_DISPLAY.some(m => m.id === v.media) ? v.media as MediaDisplay : 'default',
    };
  } catch { return DEFAULT_READING; }
}

let current: ReadingPrefs | null = null;
const listeners = new Set<() => void>();
const read = () => { try { return parseReading(localStorage.getItem(KEY)); } catch { return DEFAULT_READING; } };

export function setReading(patch: Partial<ReadingPrefs>) {
  current = { ...(current ?? read()), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: this session only */ }
  listeners.forEach(l => l());
}

export function useReading(): ReadingPrefs {
  return useSyncExternalStore(
    l => { listeners.add(l); if (current === null) { current = read(); queueMicrotask(l); } return () => { listeners.delete(l); }; },
    () => current ?? DEFAULT_READING,
    () => DEFAULT_READING,
  );
}

/** Why media is veiled, if it is: a filter's reason first, then the author's mark, then the reader's own setting. */
export function veilReason(prefs: ReadingPrefs, filterReason: string | null, sensitive: boolean | undefined): string | null {
  if (filterReason) return filterReason;
  if (prefs.media === 'show_all') return null;
  if (sensitive) return 'The author marked this media as sensitive';
  if (prefs.media === 'hide_all') return 'Hidden by your media setting';
  return null;
}
