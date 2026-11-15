import { Block, Button, Link, Navbar, Page } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useFedizen } from '@/components/social/useFedizen';
import { FEED_PROBLEM, useTagFeed } from '@/components/social/useFeeds';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';

/**
 * Phone: a hashtag's feed, opened from a hashtag in a post or a followed-tag line. It's a page pushed onto the main
 * view like any feed — back chevron, swipe back — not a sheet. It reads Fedizen's tag timeline through the person's
 * own connection, so it holds only posts they may see — and act on, with the usual actions.
 */
export function TagFeedPage({ f7route }: { f7route?: { params: { tag?: string } } }) {
  const raw = f7route?.params.tag;
  const tag = raw ? decodeURIComponent(raw) : null;
  const { user } = useAtlasAuth();
  const q = useTagFeed(tag);
  const actions = useMobilePostActions();
  return <Page className="atlas-tag-page">
      <Navbar title={tag ?? ''} backLink backLinkShowText={false} />
      {tag && <>
        {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
        {!user ? <Block strong inset>Sign in to Atlas and connect Fedizen to see posts tagged {tag}.</Block>
          : q.isLoading ? <Block strong inset>Loading posts tagged {tag}…</Block>
          : q.isError || q.data?.error === 'unavailable' ? <Block strong inset>{FEED_PROBLEM.unavailable} <Link onClick={() => void q.refetch()}>Try again</Link></Block>
          : q.data?.error ? <Block strong inset><p style={{ marginTop: 0 }}>{FEED_PROBLEM[q.data.error]}</p><ConnectFedizen /></Block>
          : !q.data?.posts.length ? <Block strong inset>No posts you can see are tagged {tag} yet.</Block>
          : q.data.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} inTag={tag} />)}
        {actions.sheet}
      </>}
    </Page>;
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
