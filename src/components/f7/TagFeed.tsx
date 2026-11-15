import { Block, BlockFooter, Button, Link, Navbar, NavRight, Page, Popup } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useFedizen } from '@/components/social/useFedizen';
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
          : q.isError || q.data?.error === 'unavailable' ? <Block strong inset>{FEED_PROBLEM.unavailable} <Link onClick={() => void q.refetch()}>Try again</Link></Block>
          : q.data?.error ? <Block strong inset><p style={{ marginTop: 0 }}>{FEED_PROBLEM[q.data.error]}</p><ConnectFedizen /></Block>
          : !q.data?.posts.length ? <Block strong inset>No posts you can see use #{tag} yet.</Block>
          : q.data.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} inTag={tag} />)}
        {actions.sheet}
      </>}
    </Page>
  </Popup>;
}

/** Not connected, expired or missing a permission: connect Fedizen again from here (a new tab when Atlas is embedded). */
function ConnectFedizen() {
  const f = useFedizen();
  return <>
    {f.embedded ? <Button fill round external target="_blank" href={`${window.location.origin}/app`}>Open Atlas in a new tab to connect</Button>
      : <Button fill round onClick={() => void f.connect()} disabled={f.actionBusy}>{f.actionBusy ? 'Connecting…' : 'Connect Fedizen'}</Button>}
    {f.error && <p role="alert">{f.error}</p>}
  </>;
}
