/** Owner-bound public Spotlight sampling. No global cache, no private feed,
 * no unbounded scrolling, and no retry loop on Fedizen rate limits. */
import { allowedSpotlightItem, type SpotlightModeration } from './spotlight-curation';
import { fromFederatedLinkCards, fromFederatedVideos, type SpotlightItem } from './spotlight';

export type PublicSpotlightPage = { status: number; data: unknown[]; next?: string };
export type PublicSpotlightCandidates = {
  posts: unknown[];
  linked: SpotlightItem[];
  videos: SpotlightItem[];
  pagesRead: number;
};

export function isPublicSpotlightStatus(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  const account = status.account && typeof status.account === 'object' && !Array.isArray(status.account)
    ? status.account as Record<string, unknown> : null;
  return status.visibility === 'public' && account?.discoverable !== false &&
    status.sensitive !== true && !(typeof status.spoiler_text === 'string' && status.spoiler_text.trim()) &&
    !status.reblog && !status.quote && !status.in_reply_to_id;
}

/** Read at most one additional 20-status page when the first sample yields no
 * eligible public material after the reader's blocks/mutes. Never describe
 * engagement in this sample as a network-wide trending count.
 */
export async function collectPublicSpotlightCandidates(
  first: PublicSpotlightPage,
  moderation: SpotlightModeration,
  readNext: (cursor: string) => Promise<PublicSpotlightPage>,
): Promise<PublicSpotlightCandidates> {
  if (first.status !== 200 || !Array.isArray(first.data)) return { posts: [], linked: [], videos: [], pagesRead: 0 };
  const posts = first.data.slice(0, 20).filter(isPublicSpotlightStatus);
  let linked = fromFederatedLinkCards(posts);
  let videos = fromFederatedVideos(posts);
  let pagesRead = 1;
  if (![...linked, ...videos].some(it => allowedSpotlightItem(it, moderation)) &&
      first.next && first.next.length <= 512) {
    // Fedizen's Link cursor is parsed and origin-constrained by fedizenGet;
    // only the exact /timelines/public next-page route is allowed downstream.
    let next: PublicSpotlightPage | null = null;
    try { next = await readNext(first.next); } catch { /* keep the first public page */ }
    if (next?.status === 200 && Array.isArray(next.data)) {
      posts.push(...next.data.slice(0, 20).filter(isPublicSpotlightStatus));
      linked = fromFederatedLinkCards(posts);
      videos = fromFederatedVideos(posts);
      pagesRead++;
    }
  }
  return { posts, linked, videos, pagesRead };
}
