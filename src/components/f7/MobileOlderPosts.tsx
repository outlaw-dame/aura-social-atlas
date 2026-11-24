import { Link } from 'framework7-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import type { ForYouReason } from '@/lib/feed-types';
import { useLoadMoreSentinel } from '@/components/social/useOlderPages';
import { MobilePostCard, type MobileActions } from './MobilePostCard';

type Older = { posts: (FedizenPost & { reasons?: ForYouReason[] })[]; hasMore: boolean; loading: boolean; failed: boolean; loadMore: () => void };

/** Phone: a feed's older posts under its first page, read ahead of the reader, with a manual fallback. */
export function MobileOlderPosts({ older, actions, inTag }: { older: Older; actions: MobileActions; inTag?: string }) {
  const sentinel = useLoadMoreSentinel(older.hasMore && !older.failed, older.loadMore);
  return <>
    {older.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} reasons={p.reasons} inTag={inTag} />)}
    {older.hasMore && <div ref={sentinel} className="atlas-older">
      {older.failed ? <span>Couldn’t load older posts. <Link onClick={older.loadMore}>Try again</Link></span>
        : older.loading ? <span>Loading older posts…</span>
        : <Link onClick={older.loadMore}>Load older posts</Link>}
    </div>}
  </>;
}
