import type { GatedPost } from '@/components/social/FilterGate';
import type { TagPost } from './tag-feed.functions';

/**
 * A public hashtag post (mastodon.social's tag timeline) as the keyword filters read it, so the signed-out / not-connected
 * fallback on /tags/$tag and the phone's hashtag page hides, warns or blurs exactly as connected feeds do.
 */
export const gatedTagPost = (p: TagPost): GatedPost => ({
  id: p.id, paragraphs: p.text, cw: p.cw || undefined,
  author: p.author.name, handle: `@${p.author.acct.replace(/^@/, '')}`, avatar: p.author.avatar, date: p.createdAt,
});
