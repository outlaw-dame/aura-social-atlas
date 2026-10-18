// Memoji-style avatar presets shipped with the app. Keys are stored in
// profiles.avatar_key so bundled imports stay build-hashed and stable.
import a1 from '@/assets/avatars/avatar-1.png';
import a2 from '@/assets/avatars/avatar-2.png';
import a3 from '@/assets/avatars/avatar-3.png';
import a4 from '@/assets/avatars/avatar-4.png';

export type AvatarPreset = { key: string; src: string; label: string };

export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: 'memoji-1', src: a1, label: 'Curly dark hair' },
  { key: 'memoji-2', src: a2, label: 'Blonde with freckles' },
  { key: 'memoji-3', src: a3, label: 'Black hair, glasses' },
  { key: 'memoji-4', src: a4, label: 'Purple hair' },
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
