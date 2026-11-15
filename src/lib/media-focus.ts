/**
 * One thing plays at a time across Atlas: the podcast player, the shared video, or a PeerTube embed. Whatever
 * starts claims focus and every other owner is paused (an embed, which Atlas can't pause, is closed).
 */
const pausers = new Map<string, () => void>();
export function claimMedia(owner: string, pause: () => void) {
  pausers.set(owner, pause);
  for (const [other, p] of [...pausers]) if (other !== owner) p();
}
export function releaseMedia(owner: string) { pausers.delete(owner); }
