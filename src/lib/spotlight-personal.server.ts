/** Owner-bound public Spotlight sampling. No global cache, no private feed,
 * no unbounded scrolling, and no retry loop on Fedizen rate limits. */
import { allowedSpotlightItem, allowedSpotlightSources, type SpotlightModeration } from './spotlight-curation';
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
  // A public-looking status without a real account cannot be authenticated or
  // screened and must never enter source aggregation (nor crash its caller).
  return !!account && status.visibility === 'public' && account.discoverable !== false &&
    status.sensitive !== true && !(typeof status.spoiler_text === 'string' && status.spoiler_text.trim()) &&
    !status.reblog && !status.quote && !status.in_reply_to_id;
}

/** Both "local" and federated timeline pages can mix actor origins.
 * Verify each original contributor against the same complete owner policy
 * BEFORE combining links or extracting podcast candidates. A blocked source
 * must neither contaminate a safe card nor contribute to its text or score. */
export function eligiblePublicSpotlightPosts(values: unknown[], moderation: SpotlightModeration): unknown[] {
  return values.slice(0, 20).filter(value => {
    if (!isPublicSpotlightStatus(value)) return false;
    const status = value as Record<string, unknown>;
    const account = status.account as Record<string, unknown>;
    const actorUrl = typeof account.uri === 'string' ? account.uri :
      typeof account.url === 'string' ? account.url : undefined;
    return typeof account.acct === 'string' && allowedSpotlightSources(
      [{ handle: account.acct, id: typeof account.id === 'string' ? account.id : undefined, actorUrl }],
      !!actorUrl, moderation,
    );
  });
}

/** Read at most one additional 20-status page when the first sample yields no
 * eligible public material after the reader's blocks/mutes. Never describe
 * engagement in this sample as a network-wide trending count.
 */
export async function collectPublicSpotlightCandidates(
  first: PublicSpotlightPage,
  moderation: SpotlightModeration,
  readNext: (cursor: string) => Promise<PublicSpotlightPage>,
  hasEligibleAlternative = false,
): Promise<PublicSpotlightCandidates> {
  if (first.status !== 200 || !Array.isArray(first.data)) return { posts: [], linked: [], videos: [], pagesRead: 0 };
  const posts = eligiblePublicSpotlightPosts(first.data, moderation);
  let linked = fromFederatedLinkCards(posts);
  let videos = fromFederatedVideos(posts);
  let pagesRead = 1;
  if (!hasEligibleAlternative && ![...linked, ...videos].some(it => allowedSpotlightItem(it, moderation)) &&
      first.next && first.next.length <= 512) {
    // Fedizen's Link cursor is parsed and origin-constrained by fedizenGet;
    // only the exact /timelines/public next-page route is allowed downstream.
    let next: PublicSpotlightPage | null = null;
    try { next = await readNext(first.next); } catch { /* keep the first public page */ }
    if (next?.status === 200 && Array.isArray(next.data)) {
      posts.push(...eligiblePublicSpotlightPosts(next.data, moderation));
      linked = fromFederatedLinkCards(posts);
      videos = fromFederatedVideos(posts);
      pagesRead++;
    }
  }
  return { posts, linked, videos, pagesRead };
}
