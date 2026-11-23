/** Owner-only source of moderation for Spotlight. Treat any missing or partial
 * source as unavailable: an empty list is NOT interchangeable with failed read.
 * Never cache one user's blocks/mutes under another user's identity.
 */
import type { SpotlightModeration } from './spotlight-curation';

type Reader = (path: string) => Promise<{ status: number; data: unknown[]; next?: string }>;

export async function readSpotlightModeration(read: Reader): Promise<SpotlightModeration | null> {
  const [blocks, mutes] = await Promise.all([
    read('/api/v1/blocks?limit=80').catch(() => null),
    read('/api/v1/mutes?limit=80').catch(() => null),
  ]);
  if (!blocks || !mutes || blocks.status !== 200 || mutes.status !== 200 ||
      blocks.next || mutes.next) return null;
  const parse = (input: unknown[]): { handles: string[]; ids: string[] } | null => {
    if (!Array.isArray(input) || input.length > 10_000) return null;
    const handles: string[] = [], ids: string[] = [];
    for (const value of input) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const item = value as Record<string, unknown>;
      if (typeof item.id !== 'string' || !item.id || item.id.length > 64 ||
          typeof item.acct !== 'string' || !item.acct || item.acct.length > 320) return null;
      ids.push(item.id); handles.push(item.acct);
    }
    return { handles, ids };
  };
  const banned = parse(blocks.data), muted = parse(mutes.data);
  if (!banned || !muted) return null;
  return {
    blockedHandles: banned.handles, blockedIds: banned.ids,
    mutedHandles: muted.handles, mutedIds: muted.ids,
    // Bonfire's reviewed Mastodon compatibility router exposes no personal
    // /domain_blocks endpoint. Remote Spotlight authors must be held back.
    domainCoverage: 'unavailable', blockedDomains: [],
  };
}
