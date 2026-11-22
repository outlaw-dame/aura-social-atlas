import { useSyncExternalStore } from 'react';

/**
 * The accent the reader chooses (Settings → Appearance), applied app-wide through --accent (Tailwind `accent`),
 * --accent-foreground (text on accent, picked for contrast) and Framework7's theme color on the phone.
 * Choices are Apple's system colors (iOS, light appearance) except Blue (Twitter blue #1DA1F2), Purple (Discord
 * Blurple #5865F2) and Green (Discord green #57F287); Atlas Red is the default.
 */
export const ACCENTS = [
  { id: 'atlas', name: 'Atlas Red', hex: '#FA243C' },
  { id: 'orange', name: 'Orange', hex: '#FF9500' },
  { id: 'yellow', name: 'Yellow', hex: '#FFCC00' },
  { id: 'green', name: 'Green', hex: '#57F287' },
  { id: 'mint', name: 'Mint', hex: '#00C7BE' },
  { id: 'teal', name: 'Teal', hex: '#30B0C7' },
  { id: 'blue', name: 'Blue', hex: '#1DA1F2' },
  { id: 'indigo', name: 'Indigo', hex: '#5856D6' },
  { id: 'purple', name: 'Purple', hex: '#5865F2' },
  { id: 'pink', name: 'Pink', hex: '#FF2D55' },
  { id: 'graphite', name: 'Graphite', hex: '#8E8E93' },
] as const;
export type AccentId = (typeof ACCENTS)[number]['id'];
export const DEFAULT_ACCENT: AccentId = 'atlas';
const KEY = 'atlas-accent';

/** White on the accent when it reaches WCAG's 3:1 for icons and controls (1.4.11), as Apple's tinted buttons use;
 *  otherwise near-black (yellow, mint, green…). */
export function foregroundFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05) >= 3 ? '#FFFFFF' : '#1C1C1E';
}

export const accentHex = (id: AccentId) => (ACCENTS.find(a => a.id === id) ?? ACCENTS[0]).hex;

function read(): AccentId {
  try { const v = localStorage.getItem(KEY); return ACCENTS.some(a => a.id === v) ? (v as AccentId) : DEFAULT_ACCENT; } catch { return DEFAULT_ACCENT; }
}
let current: AccentId | null = null;
const listeners = new Set<() => void>();

function apply(id: AccentId) {
  if (typeof document === 'undefined') return;
  const hex = accentHex(id), s = document.documentElement.style;
  s.setProperty('--accent', hex);
  s.setProperty('--accent-foreground', foregroundFor(hex));
}

export function setAccent(id: AccentId) {
  current = id;
  try { localStorage.setItem(KEY, id); } catch { /* private mode: this session only */ }
  apply(id);
  listeners.forEach(l => l());
}

/** The reader's accent; also applies it on first use in the browser. */
export function useAccent(): AccentId {
  return useSyncExternalStore(
    l => { listeners.add(l); if (current === null) { current = read(); apply(current); queueMicrotask(l); } return () => { listeners.delete(l); }; },
    () => current ?? DEFAULT_ACCENT,
    () => DEFAULT_ACCENT,
  );
}
