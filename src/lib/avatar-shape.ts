import { useSyncExternalStore } from 'react';

/**
 * How avatars are drawn (Settings → Appearance), as Ivory offers: circle (the default), rounded or square. It applies
 * to every avatar in Atlas — people, groups, podcasts and other accounts — through --atlas-avatar-radius, so one choice
 * changes them all. Post images and episode artwork are pictures, not avatars, and keep their own corners.
 */
export const AVATAR_SHAPES = [
  { id: 'circle', name: 'Circle', radius: '50%' },
  { id: 'rounded', name: 'Rounded', radius: '24%' },
  { id: 'square', name: 'Square', radius: '0' },
] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number]['id'];
export const DEFAULT_AVATAR_SHAPE: AvatarShape = 'circle';
const KEY = 'atlas-avatar-shape';

export const avatarRadius = (id: AvatarShape) => (AVATAR_SHAPES.find(s => s.id === id) ?? AVATAR_SHAPES[0]).radius;

function read(): AvatarShape {
  try { const v = localStorage.getItem(KEY); return AVATAR_SHAPES.some(s => s.id === v) ? (v as AvatarShape) : DEFAULT_AVATAR_SHAPE; } catch { return DEFAULT_AVATAR_SHAPE; }
}
let current: AvatarShape | null = null;
const listeners = new Set<() => void>();

function apply(id: AvatarShape) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--atlas-avatar-radius', avatarRadius(id));
  root.dataset.avatarShape = id;
}

export function setAvatarShape(id: AvatarShape) {
  current = id;
  try { localStorage.setItem(KEY, id); } catch { /* private mode: this session only */ }
  apply(id);
  listeners.forEach(l => l());
}

/** The reader's avatar shape; also applies it on first use in the browser. */
export function useAvatarShape(): AvatarShape {
  return useSyncExternalStore(
    l => { listeners.add(l); if (current === null) { current = read(); apply(current); queueMicrotask(l); } return () => { listeners.delete(l); }; },
    () => current ?? DEFAULT_AVATAR_SHAPE,
    () => DEFAULT_AVATAR_SHAPE,
  );
}
