import { Block, BlockFooter, Link, Navbar, NavRight, Page, Popup } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { FEED_PROBLEM, useFollowedTags, useTagFeed } from '@/components/social/useFeeds';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';
import { Icon } from './F7Extras';

/**
 * Phone: a hashtag's feed, opened from a hashtag in a post or a followed-tag line. It reads Fedizen's tag timeline
 * through the person's own connection, so it holds only posts they may see — and act on, with the usual actions.
 */
export function TagFeedPopup({ tag, onClose }: { tag: string | null; onClose: () => void }) {
  const { user } = useAtlasAuth();
  const q = useTagFeed(tag);
  const followed = useFollowedTags();
  const actions = useMobilePostActions();
  return <Popup opened={!!tag} onPopupClosed={onClose} swipeToClose className="atlas-tag-popup">
    <Page>
      <Navbar title={tag ? `#${tag}` : ''}>
        <NavRight><Link iconOnly popupClose aria-label="Close"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight>
      </Navbar>
      {tag && <>
        <BlockFooter>{followed.has(tag) ? <><Icon ios="f7:tag" md="material:sell" /> You follow this hashtag. </> : null}Posts on Fedizen that use #{tag} and that you can see.</BlockFooter>
        {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
        {!user ? <Block strong inset>Sign in to Atlas and connect Fedizen to see posts using #{tag}.</Block>
          : q.isLoading ? <Block strong inset>Loading posts with #{tag}…</Block>
          : q.isError ? <Block strong inset>{FEED_PROBLEM.unavailable} <Link onClick={() => void q.refetch()}>Try again</Link></Block>
          : q.data?.error ? <Block strong inset>{FEED_PROBLEM[q.data.error]}</Block>
          : !q.data?.posts.length ? <Block strong inset>No posts you can see use #{tag} yet.</Block>
          : q.data.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} inTag={tag} />)}
        {actions.sheet}
      </>}
    </Page>
  </Popup>;
}
