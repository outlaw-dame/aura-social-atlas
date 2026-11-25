import type { FedizenPost } from '@/lib/fedizen-feed';
import type { ForYouReason } from '@/lib/feed-types';
import { FeedPostCard, type FeedActions } from './FeedPostCard';
import { useLoadMoreSentinel } from './useOlderPages';
import { OlderFooter } from './OlderFooter';

type Older = { posts: (FedizenPost & { reasons?: ForYouReason[] })[]; hasMore: boolean; loading: boolean; failed: boolean; loadMore: () => void };

/** Desktop: a feed's older posts under its first page, read ahead of the reader as they scroll. */
export function OlderPosts({ older, actions, inTag }: { older: Older; actions: FeedActions; inTag?: string }) {
  const sentinel = useLoadMoreSentinel(older.hasMore && !older.failed, older.loadMore);
  return <>
    {older.posts.map(p => <FeedPostCard key={p.id} post={p} actions={actions} reasons={p.reasons} inTag={inTag} />)}
    {older.hasMore && <OlderFooter sentinel={sentinel} loading={older.loading} failed={older.failed} retry={older.loadMore} />}
  </>;
}
