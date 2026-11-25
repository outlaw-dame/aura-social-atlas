import type { FedizenPost } from '@/lib/fedizen-feed';
import type { ForYouReason } from '@/lib/feed-types';
import { useLoadMoreSentinel } from '@/components/social/useOlderPages';
import { MobilePostCard, type MobileActions } from './MobilePostCard';
import { MobileOlderFooter } from './MobileOlderFooter';

type Older = { posts: (FedizenPost & { reasons?: ForYouReason[] })[]; hasMore: boolean; loading: boolean; failed: boolean; loadMore: () => void };

/** Phone: a feed's older posts under its first page, read ahead of the reader as they scroll. */
export function MobileOlderPosts({ older, actions, inTag }: { older: Older; actions: MobileActions; inTag?: string }) {
  const sentinel = useLoadMoreSentinel(older.hasMore && !older.failed, older.loadMore);
  return <>
    {older.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} reasons={p.reasons} inTag={inTag} />)}
    {older.hasMore && <MobileOlderFooter sentinel={sentinel} loading={older.loading} failed={older.failed} retry={older.loadMore} />}
  </>;
}
