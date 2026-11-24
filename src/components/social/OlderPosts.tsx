import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FedizenPost } from '@/lib/fedizen-feed';
import type { ForYouReason } from '@/lib/feed-types';
import { FeedPostCard, type FeedActions } from './FeedPostCard';
import { useLoadMoreSentinel } from './useOlderPages';

type Older = { posts: (FedizenPost & { reasons?: ForYouReason[] })[]; hasMore: boolean; loading: boolean; failed: boolean; loadMore: () => void };

/** Desktop: a feed's older posts under its first page, read ahead of the reader, with a manual fallback. */
export function OlderPosts({ older, actions, inTag }: { older: Older; actions: FeedActions; inTag?: string }) {
  const sentinel = useLoadMoreSentinel(older.hasMore && !older.failed, older.loadMore);
  return <>
    {older.posts.map(p => <FeedPostCard key={p.id} post={p} actions={actions} reasons={p.reasons} inTag={inTag} />)}
    {older.hasMore && <div ref={sentinel} className="flex justify-center py-2">
      {older.failed ? <p role="status" className="text-xs text-muted-foreground">Couldn’t load older posts. <Button variant="link" size="sm" className="px-1" onClick={older.loadMore}>Try again</Button></p>
        : older.loading ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading older posts…</span>
        : <Button type="button" variant="ghost" size="sm" onClick={older.loadMore}>Load older posts</Button>}
    </div>}
  </>;
}
