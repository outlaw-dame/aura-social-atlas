import { registerImageFallbacks } from './image-fallback';
// Memoji-style avatar presets shipped with the app. Keys are stored in
// profiles.avatar_key so bundled imports stay build-hashed and stable.
// AVIF at 512 px (each ~6–16 KB, from ~1 MB PNG masters kept beside them; scripts/encode-avatars.py), with WebP
// copies for the few browsers that can't decode AVIF (registered with image-fallback.ts below).
import a1 from '@/assets/avatars/avatar-1.avif';
import a2 from '@/assets/avatars/avatar-2.avif';
import a3 from '@/assets/avatars/avatar-3.avif';
import a4 from '@/assets/avatars/avatar-4.avif';
import w1 from '@/assets/avatars/avatar-1.webp';
import w2 from '@/assets/avatars/avatar-2.webp';
import w3 from '@/assets/avatars/avatar-3.webp';
import w4 from '@/assets/avatars/avatar-4.webp';

export type AvatarPreset = { key: string; src: string; webp: string; label: string };

export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: 'memoji-1', src: a1, webp: w1, label: 'Curly dark hair' },
  { key: 'memoji-2', src: a2, webp: w2, label: 'Blonde with freckles' },
  { key: 'memoji-3', src: a3, webp: w3, label: 'Black hair, glasses' },
  { key: 'memoji-4', src: a4, webp: w4, label: 'Purple hair' },
];

export const DEFAULT_AVATAR_KEYS = AVATAR_PRESETS.map(p => p.key);

export function avatarPreset(key?: string | null): AvatarPreset {
  return AVATAR_PRESETS.find(p => p.key === key) ?? AVATAR_PRESETS[0];
}

// Deterministic fallback pick when a profile has no stored avatar yet.
export function defaultAvatarKey(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return DEFAULT_AVATAR_KEYS[hash % DEFAULT_AVATAR_KEYS.length];
}

// If a browser can't decode a preset's AVIF, it gets the WebP copy (see image-fallback.ts).
registerImageFallbacks(AVATAR_PRESETS.map(p => [p.src, p.webp]));
