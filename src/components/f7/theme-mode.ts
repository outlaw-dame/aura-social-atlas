import { useSyncExternalStore } from 'react';

/** Phone: Light, Dark or Match device, shared by the app and Settings → Appearance (a pushed page). */
export type ThemeMode = 'light' | 'dark' | 'system';
let mode: ThemeMode = 'light';
const listeners = new Set<() => void>();
export function setThemeMode(m: ThemeMode) { if (m === mode) return; mode = m; listeners.forEach(l => l()); }
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => mode, () => mode);
}
