import { Block, BlockFooter, Button, Card, CardContent, CardFooter, Icon, Link, List, ListItem, Navbar, NavRight, Page } from 'framework7-react';
import { useQuery } from '@tanstack/react-query';
import { getTagFeed } from '@/lib/tag-feed.functions';
import { NetworkBadge } from '@/lib/networks';
import { openFediProfile } from '@/lib/fedi-profile';
import { linkifyPost } from '@/components/social/PostPeople';
import { SensitiveMedia } from '@/components/social/SensitiveMedia';
import { AuthorWarning } from '@/components/social/ContentWarning';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useFedizen } from '@/components/social/useFedizen';
import { FEED_PROBLEM, useTagFeed } from '@/components/social/useFeeds';
import { useFollowedTagList, useTagFollow, useTagFollowState } from '@/components/social/useTagFollow';
import { hashtagLabel, openTag, TagText } from '@/lib/hashtags';
import { pushPage, tagPageUrl } from './navigation';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';
import { FilterPlaceProvider } from '@/components/social/useIntelligence';
import { MobileFilterGate } from './FilterGate';
import { gatedTagPost } from '@/lib/tag-post';
import { useFeatureTag } from '@/components/social/useFeatureTag';

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
  const feature = useFeatureTag(tag);
  const state = useTagFollowState(tag);
  const following = state.following;
  // Follow / Following at the top right, as Mastodon and Ivory put it, once Fedizen has answered for this account —
  // both the tag's feed and the list of tags you follow, so the button never guesses.
  const feedOk = !!tag && !!user && !q.isError && !!q.data && !q.data.error;
  const canFollow = feedOk && state.known;
  return <Page className="atlas-tag-page">
      <Navbar title={tag ?? ''} backLink backLinkShowText={false}>
        {(canFollow || feature.available) && <NavRight>
          {feature.available && <Link iconOnly aria-pressed={feature.featured} aria-label={feature.featured ? `Remove ${tag} from your profile` : `Feature ${tag} on your profile`} onClick={() => void feature.toggle()}>
            <Icon ios={feature.featured ? 'f7:star_fill' : 'f7:star'} md={feature.featured ? 'material:star' : 'material:star_border'} />
          </Link>}
          {canFollow && <Button small round fill={!following} tonal={following} className="atlas-follow-tag" aria-pressed={following} disabled={!!follow.busy} onClick={() => void follow.toggle(tag!, !following)}>
            {following ? 'Following' : 'Follow'}
          </Button>}
        </NavRight>}
      </Navbar>
      {tag && <>
        {follow.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{follow.error}</p></Block>}
        {feature.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{feature.error}</p></Block>}
        {feedOk && state.failed && <Block strong inset><p role="alert" style={{ margin: 0 }}>Couldn’t check whether you follow this hashtag. <Link onClick={state.retry}>Try again</Link></p></Block>}
        {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
        {/* As desktop's /tags/$tag: only signed out, or not connected, does it fall back to public posts from
            mastodon.social. A connected person whose read fails sees that, with retry or reconnect. */}
        {!user ? <PublicTagPosts tag={tag} />
          : q.isLoading ? <Block strong inset>Loading posts tagged {tag}…</Block>
          : q.isError || q.data?.error === 'unavailable' ? <Block strong inset>{FEED_PROBLEM.unavailable} <Link onClick={() => void q.refetch()}>Try again</Link></Block>
          : q.data?.error === 'not-connected' ? <><Block strong inset><p style={{ marginTop: 0 }}>{FEED_PROBLEM['not-connected']}</p><ConnectFedizen /></Block><PublicTagPosts tag={tag} /></>
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

/**
 * Public posts tagged `tag` from mastodon.social (getTagFeed), for a signed-out or not-connected reader, as desktop
 * shows them: author (opens their profile in Atlas), the post with its warning and sensitive media, counts linking to
 * the original.
 */
function PublicTagPosts({ tag }: { tag: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['tag-feed', tag], queryFn: () => getTagFeed({ data: { tag } }), staleTime: 60_000 });
  return <>
    <BlockFooter><span className="atlas-spot-meta">From <NetworkBadge network="Mastodon" /> mastodon.social</span></BlockFooter>
    {isLoading ? <Block strong inset>Loading posts…</Block>
      : error ? <Block strong inset>This hashtag feed couldn’t be loaded. Please try again shortly.</Block>
      : !data?.length ? <Block strong inset>No public posts are tagged {tag} yet.</Block>
      : <FilterPlaceProvider place="public">{data.map(p => <MobileFilterGate key={p.id} post={gatedTagPost(p)}><Card outline className="atlas-f7-card atlas-public-tag-post">
        <CardContent>
          <Link className="atlas-public-tag-author" onClick={() => openFediProfile({ actor: p.author.url, acct: p.author.acct, name: p.author.name })} aria-label={`${p.author.name} ${p.author.acct}. Open their profile`}>
            <img src={p.author.avatar} alt="" width={40} height={40} className="atlas-avatar" loading="lazy" referrerPolicy="no-referrer" />
            <span><b>{p.author.name}</b><small>@{p.author.acct.replace(/^@/, '')}</small></span>
            <time dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
          </Link>
          <AuthorWarning cw={p.cw}>{p.text.map((t, i) => <p key={i}>{linkifyPost(t, undefined, t2 => openTag(t2))}</p>)}
            <SensitiveMedia sensitive={p.sensitive}>{p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', borderRadius: 12, maxHeight: 384, objectFit: 'cover' }} />}</SensitiveMedia>
          </AuthorWarning>
        </CardContent>
        <CardFooter><Link external target="_blank" href={p.url} aria-label="Open original post">↩ {p.replies} · ↻ {p.boosts} · ★ {p.favourites}</Link></CardFooter>
      </Card></MobileFilterGate>)}</FilterPlaceProvider>}
  </>;
}
