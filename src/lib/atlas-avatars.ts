// Memoji-style avatar presets shipped with the app. Keys are stored in
// profiles.avatar_key so bundled imports stay build-hashed and stable.
// AVIF at 512 px (each ~6–16 KB, from ~1 MB PNG masters kept beside them; scripts/encode-avatars.py), with WebP
// copies for the few browsers that can't decode AVIF (see installAvifFallback below).
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

/**
 * AVIF is Baseline across current browsers, but an older Safari (before 16.4) can fail to decode it. Rather than wrap
 * every avatar <img> in <picture>, one capture-phase listener swaps a preset's AVIF for its WebP copy if it fails.
 */
const WEBP_FOR = new Map(AVATAR_PRESETS.map(p => [new URL(p.src, 'http://x').pathname, p.webp]));
function swapToWebp(img: HTMLImageElement) {
  const webp = WEBP_FOR.get(new URL(img.currentSrc || img.src, location.href).pathname);
  if (webp && img.getAttribute('src') !== webp) img.src = webp;
}
/** Server-rendered avatars can fail before this module runs (slow script, no AVIF): their error event has already
 *  fired and hydration won't retry an unchanged URL, so sweep for preset images that finished without a picture. */
function recoverFailed() {
  for (const img of Array.from(document.images)) if (img.complete && img.naturalWidth === 0) swapToWebp(img);
}
function installAvifFallback() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', e => { if (e.target instanceof HTMLImageElement) swapToWebp(e.target); }, true);
  recoverFailed();
  if (document.readyState !== 'complete') window.addEventListener('load', recoverFailed, { once: true });
  // After hydration too, in case React re-applied the original src.
  window.setTimeout(recoverFailed, 0);
}
installAvifFallback();
