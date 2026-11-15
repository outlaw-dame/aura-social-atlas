/** One thing plays at a time across Atlas: starting a video pauses the podcast player, and the reverse. */
const pausers = new Map<string, () => void>();
export function claimMedia(owner: 'audio' | 'video', pause: () => void) {
  pausers.set(owner, pause);
  for (const [other, p] of pausers) if (other !== owner) p();
}
