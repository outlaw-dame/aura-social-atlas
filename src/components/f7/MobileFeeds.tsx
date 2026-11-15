import { useEffect, useState, type ReactNode } from 'react';
import { Block, BlockFooter, BlockTitle, Link, List, ListItem, Navbar, NavRight, Page, Popup, Toggle } from 'framework7-react';
import { circleIdOf, pinCircle, unpinCircle, usePinnedCircles, type FeedKind } from '@/lib/feed-types';
import { useAtlasAuth } from '@/components/social/AuthState';
import { FEED_PROBLEM, useCircleFeed, useFeedTabs, useForYou } from '@/components/social/useFeeds';
import { useFedizenCircles } from '@/components/social/useFedizenLibrary';
import { MobileFedizenFeed, MobilePublicFedizen, MobileRecentArticles } from './FedizenMobile';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';
import { Icon } from './F7Extras';

const KEY = 'atlas-feed';

/**
 * Phone Feeds tab: Following, For You, Articles, Local and pinned circles, as a scrollable row of tabs at the top in
 * the manner of Particle: plain names, the open one in a filled pill, and a dot before any with posts you haven't seen.
 * `following` is the extra content Following shows under your Fedizen timeline (Atlas creators you follow).
 */
export function MobileFeeds({ following, visible = true }: { following?: ReactNode; /** Whether the Feeds dock tab is on screen. */ visible?: boolean }) {
  const { user } = useAtlasAuth();
  const pinned = usePinnedCircles(user?.id);
  const [feed, setFeed] = useState<FeedKind>('following');
  const [pinning, setPinning] = useState(false);
  const [restored, setRestored] = useState(false);
  useEffect(() => { try { const r = sessionStorage.getItem(KEY) as FeedKind | null; if (r) setFeed(r); } catch { /* fine */ } setRestored(true); }, []);
  const choose = (k: FeedKind) => { setFeed(k); try { sessionStorage.setItem(KEY, k); } catch { /* fine */ } };
  const circleId = circleIdOf(feed);
  useEffect(() => { if (circleId && !pinned.some(c => c.id === circleId)) choose('following'); }, [circleId, pinned]);
  const tabs = useFeedTabs(restored && visible ? feed : null);
  return <>
    <div className="atlas-feed-tabs" role="tablist" aria-label="Feeds">
      {tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={feed === t.id} onClick={e => { choose(t.id); e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }); }}
        className={feed === t.id ? 'active' : ''} aria-label={t.isNew ? `${t.label}, new posts` : undefined}>
        {t.isNew && <span className="atlas-new-dot" aria-hidden="true" />}{t.label}
      </button>)}
      {user && <button type="button" className="atlas-feed-tab-add" onClick={() => setPinning(true)} aria-label="Pin a circle to Feeds"><Icon ios="f7:plus" md="material:add" /></button>}
    </div>
    {feed === 'following' && <><MobileFedizenFeed />{following}</>}
    {feed === 'foryou' && <MobileForYou />}
    {feed === 'articles' && <MobileRecentArticles />}
    {feed === 'local' && <MobilePublicFedizen />}
    {circleId && <MobileCircleFeed id={circleId} title={pinned.find(c => c.id === circleId)?.title ?? 'Circle'} />}
    <PinCirclesPopup opened={pinning} onClose={() => setPinning(false)} />
  </>;
}

function MobileForYou() {
  const { user } = useAtlasAuth();
  const q = useForYou(true);
  const actions = useMobilePostActions();
  const d = q.data;
  return <>
    {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
    {!user ? <Block strong inset>Sign in to Atlas and connect Fedizen for your For You feed.</Block>
      : q.isLoading ? <Block strong inset>Putting your feed together…</Block>
      : q.isError ? <Block strong inset>{FEED_PROBLEM.unavailable} <Link onClick={() => void q.refetch()}>Try again</Link></Block>
      : d?.error ? <Block strong inset>{FEED_PROBLEM[d.error]}</Block>
      : !d?.posts.length ? <Block strong inset>Nothing here yet. Follow people and hashtags, or join groups, and their posts will gather here.</Block>
      : d.posts.map(p => <MobilePostCard key={p.url} post={p} actions={actions} reasons={p.reasons} />)}
    {d && !d.error && d.missing.length > 0 && <BlockFooter>Some of For You couldn’t load ({d.missing.map(m => (m === 'following' ? 'people you follow' : m === 'tags' ? 'followed hashtags' : 'your groups')).join(', ')}).</BlockFooter>}
    {actions.sheet}
  </>;
}

function MobileCircleFeed({ id, title }: { id: string; title: string }) {
  const { user } = useAtlasAuth();
  const q = useCircleFeed(id);
  const actions = useMobilePostActions();
  return <>
    {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
    {q.isLoading ? <Block strong inset>Loading posts from {title}…</Block>
      : q.isError ? <Block strong inset>{FEED_PROBLEM.unavailable} <Link onClick={() => void q.refetch()}>Try again</Link></Block>
      : q.data?.error ? <Block strong inset>{FEED_PROBLEM[q.data.error]}{q.data.error === 'not-found' && user && <> <Link onClick={() => unpinCircle(user.id, id)}>Unpin it</Link></>}</Block>
      : !q.data?.posts.length ? <Block strong inset>No recent posts from the people in {title}.</Block>
      : q.data.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} />)}
    {actions.sheet}
  </>;
}

/** Pin your circles to Feeds (or unpin them). */
function PinCirclesPopup({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { user } = useAtlasAuth();
  const q = useFedizenCircles(opened);
  const pinned = usePinnedCircles(user?.id);
  const circles = q.data?.circles ?? [];
  return <Popup opened={opened} onPopupClosed={onClose} swipeToClose>
    <Page>
      <Navbar title="Pin circles"><NavRight><Link iconOnly popupClose aria-label="Close"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight></Navbar>
      <BlockFooter>Pinned circles appear in Feeds, with posts from the people in them.</BlockFooter>
      {q.isLoading && <Block>Loading your circles…</Block>}
      {q.data?.error && <Block>{FEED_PROBLEM[q.data.error]}</Block>}
      {!q.isLoading && !q.data?.error && !circles.length && <Block>You have no circles yet. Make one in Profile → Circles.</Block>}
      {circles.length > 0 && <List strong inset dividers>{circles.map(c => { const on = pinned.some(p => p.id === c.id); return <ListItem key={c.id} title={c.title}>
        <Icon slot="media" ios="f7:circle_grid_hex" md="material:bubble_chart" />
        <Toggle slot="after" checked={on} onToggleChange={() => user && (on ? unpinCircle(user.id, c.id) : pinCircle(user.id, c))} aria-label={`Pin ${c.title} to Feeds`} />
      </ListItem>; })}</List>}
    </Page>
  </Popup>;
}
