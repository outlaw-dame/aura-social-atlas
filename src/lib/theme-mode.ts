import { useEffect, useSyncExternalStore } from 'react';

/**
 * Color theme, shared by desktop and phone (Settings → Appearance): Light, Dim, Dark or Match device.
 *
 * Dim is a softer dark: Atlas's dark tokens and Framework7's dark mode with charcoal surfaces in place of near-black
 * (tokens in styles.css under [data-theme="dim"]). On <html> it is `class="dark"` plus `data-theme="dim"`, so every
 * `dark:` style still applies and only the palette changes. Match device picks Dim, not Dark, when the device is dark.
 *
 * The choice is kept in this browser (localStorage). `?mode=light|dim|dark|auto` overrides it for one visit without
 * saving (testing and Device Lab). THEME_BOOT_SCRIPT applies it before first paint so the page never flashes light.
 */
export type ThemeMode = 'light' | 'dim' | 'dark' | 'system';
export type Appearance = 'light' | 'dim' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dim', 'dark', 'system'];
const KEY = 'atlas-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** A stored or URL value as a mode; `auto` is the URL's name for Match device. */
export function parseThemeMode(v: string | null | undefined): ThemeMode | null {
  if (v === 'auto') return 'system';
  return THEME_MODES.includes(v as ThemeMode) ? (v as ThemeMode) : null;
}

export function resolveAppearance(mode: ThemeMode, systemDark: boolean): Appearance {
  return mode === 'system' ? (systemDark ? 'dim' : 'light') : mode;
}

/** What <html> carries for an appearance. */
export function htmlThemeFor(a: Appearance): { dark: boolean; dataTheme: 'dim' | null; colorScheme: 'light' | 'dark' } {
  return { dark: a !== 'light', dataTheme: a === 'dim' ? 'dim' : null, colorScheme: a === 'light' ? 'light' : 'dark' };
}

function initial(): ThemeMode {
  try {
    const fromUrl = parseThemeMode(new URLSearchParams(window.location.search).get('mode'));
    if (fromUrl) return fromUrl;
  } catch { /* no URL */ }
  try { return parseThemeMode(localStorage.getItem(KEY)) ?? 'light'; } catch { return 'light'; }
}

let mode: ThemeMode | null = null;
const listeners = new Set<() => void>();
const current = (): ThemeMode => (mode ??= initial());

export function setThemeMode(m: ThemeMode) {
  if (m === current()) return;
  mode = m;
  try { localStorage.setItem(KEY, m); } catch { /* private mode: this visit only */ }
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, current, () => 'light');
}

const subscribeSystem = (l: () => void) => {
  const q = window.matchMedia(DARK_QUERY);
  q.addEventListener('change', l);
  return () => q.removeEventListener('change', l);
};
export function useSystemDark(): boolean {
  return useSyncExternalStore(subscribeSystem, () => window.matchMedia(DARK_QUERY).matches, () => false);
}

export function applyAppearance(a: Appearance) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement, t = htmlThemeFor(a);
  html.classList.toggle('dark', t.dark);
  if (t.dataTheme) html.dataset.theme = t.dataTheme; else delete html.dataset.theme;
  html.style.colorScheme = t.colorScheme;
}

/** The appearance in effect now, read outside React (the first render after hydration still sees the server's 'light'). */
export function currentAppearance(): Appearance {
  return resolveAppearance(current(), typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches);
}

/** The appearance in effect now (follows the device under Match device). */
export function useAppearance(): Appearance {
  return resolveAppearance(useThemeMode(), useSystemDark());
}

/** Keeps <html> in step with the appearance. Applies the live value, never the hydration render's 'light', so the
 *  class THEME_BOOT_SCRIPT set is not taken off and put back (a flash). */
export function useApplyAppearance(): Appearance {
  const a = useAppearance();
  useEffect(() => { applyAppearance(currentAppearance()); }, [a]);
  return a;
}

/** Runs in <head> before the page paints; mirrors initial(), resolveAppearance() and applyAppearance(). */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=null,q=new URLSearchParams(location.search).get('mode');if(q==='auto')q='system';if(['light','dim','dark','system'].indexOf(q)>=0)m=q;if(!m){try{m=localStorage.getItem('${KEY}')}catch(e){}}if(['light','dim','dark','system'].indexOf(m)<0)m='light';var a=m==='system'?(matchMedia('${DARK_QUERY}').matches?'dim':'light'):m,h=document.documentElement;if(a!=='light')h.classList.add('dark');if(a==='dim')h.setAttribute('data-theme','dim');h.style.colorScheme=a==='light'?'light':'dark'}catch(e){}})();`;
