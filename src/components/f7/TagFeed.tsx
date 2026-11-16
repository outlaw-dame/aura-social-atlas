import { Block, Button, Link, List, ListItem, Navbar, NavRight, Page } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useFedizen } from '@/components/social/useFedizen';
import { FEED_PROBLEM, useTagFeed } from '@/components/social/useFeeds';
import { useFollowedTagList, useTagFollow, useTagFollowState } from '@/components/social/useTagFollow';
import { hashtagLabel, TagText } from '@/lib/hashtags';
import { pushPage, tagPageUrl } from './navigation';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';
import { FilterPlaceProvider } from '@/components/social/useIntelligence';

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
  const follow = useTagFollow();
  const state = useTagFollowState(tag);
  const following = state.following;
  // Follow / Following at the top right, as Mastodon and Ivory put it, once Fedizen has answered for this account —
  // both the tag's feed and the list of tags you follow, so the button never guesses.
  const feedOk = !!tag && !!user && !q.isError && !!q.data && !q.data.error;
  const canFollow = feedOk && state.known;
  return <Page className="atlas-tag-page">
      <Navbar title={tag ?? ''} backLink backLinkShowText={false}>
        {canFollow && <NavRight>
          <Button small round fill={!following} tonal={following} className="atlas-follow-tag" aria-pressed={following} disabled={!!follow.busy} onClick={() => void follow.toggle(tag!, !following)}>
            {following ? 'Following' : 'Follow'}
          </Button>
        </NavRight>}
      </Navbar>
      {tag && <>
        {follow.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{follow.error}</p></Block>}
        {feedOk && state.failed && <Block strong inset><p role="alert" style={{ margin: 0 }}>Couldn’t check whether you follow this hashtag. <Link onClick={state.retry}>Try again</Link></p></Block>}
        {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
        {!user ? <Block strong inset>Sign in to Atlas and connect Fedizen to see posts tagged {tag}.</Block>
          : q.isLoading ? <Block strong inset>Loading posts tagged {tag}…</Block>
          : q.isError || q.data?.error === 'unavailable' ? <Block strong inset>{FEED_PROBLEM.unavailable} <Link onClick={() => void q.refetch()}>Try again</Link></Block>
          : q.data?.error ? <Block strong inset><p style={{ marginTop: 0 }}>{FEED_PROBLEM[q.data.error]}</p><ConnectFedizen /></Block>
          : !q.data?.posts.length ? <Block strong inset>No posts you can see are tagged {tag} yet.</Block>
          : <FilterPlaceProvider place="public">{q.data.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} inTag={tag} />)}</FilterPlaceProvider>}
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

const LIST_PROBLEM: Record<string, string> = {
  'not-connected': 'Connect Fedizen to follow hashtags.',
  'needs-permission': 'Reconnect Fedizen so Atlas can read the hashtags you follow.',
  expired: 'Fedizen ended Atlas’s access. Connect again to see the hashtags you follow.',
  unavailable: 'Fedizen couldn’t send the hashtags you follow right now.',
};

/** Settings → Followed hashtags (phone), pushed like any page: each tag opens its feed; Unfollow at the trailing edge,
 *  as Mastodon's Followed hashtags list has it. */
export function FollowedTagsPage() {
  const q = useFollowedTagList();
  const follow = useTagFollow();
  const names = q.data?.names ?? [];
  return <Page>
    <Navbar title="Followed hashtags" backLink backLinkShowText={false} />
    {follow.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{follow.error}</p></Block>}
    {q.isLoading ? <Block strong inset>Loading…</Block>
      : q.isError || q.data?.error ? <Block strong inset>{LIST_PROBLEM[q.data?.error ?? 'unavailable']}{(q.isError || q.data?.error === 'unavailable') && <> <Link onClick={() => void q.refetch()}>Try again</Link></>}{q.data?.error && q.data.error !== 'unavailable' && <ConnectFedizen />}</Block>
      : !names.length ? <Block strong inset>You don’t follow any hashtags yet. Follow one from its page.</Block>
      : <List strong inset dividers>
        {names.map(n => {
          const lower = n.toLowerCase();
          // Two controls per row (open, Unfollow), so the row itself isn't a link: no button inside a link.
          return <ListItem key={lower}>
            <Link slot="title" className="atlas-hashtag" aria-label={hashtagLabel(n)} onClick={() => pushPage(tagPageUrl(lower))}><TagText tag={n} /></Link>
            <Button slot="after" small round tonal className="atlas-unfollow-tag" disabled={follow.busy === lower} onClick={() => void follow.toggle(n, false)}>Unfollow</Button>
          </ListItem>;
        })}
      </List>}
    {q.data?.full && <Block><p style={{ fontSize: 13, opacity: 0.6 }}>Showing the first 200.</p></Block>}
  </Page>;
}
