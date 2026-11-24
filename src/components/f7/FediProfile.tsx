import { useEffect, useRef, useState } from 'react';
import { TagText, hashtagLabel } from '@/lib/hashtags';
import { featuredDetail } from '@/lib/featured-tags';
import type { FeaturedTag } from '@/lib/fedi-profile';
import { openTag } from '@/lib/hashtags';
import { linkifyPost } from '@/components/social/PostPeople';
import { Block, BlockTitle, Button, Icon, Link, List, ListItem, Navbar, NavRight, Page, Popup, f7 } from 'framework7-react';
import type { FediProfile, FediProfilePost, FediProfileTarget } from '@/lib/fedi-profile';
import { OPEN_POST_EVENT } from '@/lib/open-post';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';
import { followLabels } from '@/lib/follow-labels';
import { VideoPlayer } from '@/components/social/VideoPlayer';
import { FOLLOW_PROBLEM, useFediFollow, useFediProfile, useIsMe, useProfilePosts } from '@/components/social/useFediProfile';
import { FilterPlaceProvider } from '@/components/social/useIntelligence';
import { MobileFilterGate } from './FilterGate';
import { SensitiveMedia } from '@/components/social/SensitiveMedia';
import { AuthorWarning } from '@/components/social/ContentWarning';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useProfileCircles } from '@/components/social/useFedizenLibrary';
import { useModerationActions } from './useModerationActions';
import { PostBody } from '@/components/social/PostBody';

/**
 * Phone: a fediverse account opened inside Atlas from an author tag — read from the account's own server
 * (ActivityPub), with its newest public posts, and Follow through the reader's Fedizen connection.
 */

const n = (v?: number) => (v == null ? null : new Intl.NumberFormat(undefined, { notation: 'compact' }).format(v));
const day = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function Follow({ p }: { p: FediProfile }) {
  const me = useIsMe(p.acct);
  const f = useFediFollow(p.acctVerified && !me ? p.acct : undefined, p.actor);
  const words = followLabels(p.kind, p.locked);
  if (!f.signedIn || me) return null;
  const on = f.state === 'following', asked = f.state === 'requested';
  if (!p.acctVerified) return <p className="atlas-fedi-note">{FOLLOW_PROBLEM.unverified}</p>;
  return <>
    {f.canFollow && <Button round fill={!on && !asked} tonal={on || asked} disabled={f.busy} onClick={f.toggle} aria-pressed={on}>
      {on ? words.on : asked ? words.asked : words.off}
    </Button>}
    {f.error && <p role="alert" className="atlas-fedi-note">{f.error}</p>}
  </>;
}

/** Phone: More (…) in a profile's navbar: Circles, Mute / Unmute, Report, and Block their server (unblocking is on Fedizen), for a confirmed handle that isn't yours. */
function ProfileMore({ p }: { p: FediProfile }) {
  const { user } = useAtlasAuth();
  const me = useIsMe(p.acct);
  const allowed = !!user && !me && p.acctVerified && p.kind !== 'group';
  const mod = useModerationActions({ name: p.name, acct: p.acct }, allowed);
  const circles = useProfileCircles(allowed ? { acct: p.acct, actor: p.actor } : null);
  useEffect(() => { if (circles.error) f7.toast.show({ text: circles.error, closeTimeout: 3000 }); }, [circles.error]);
  if (!mod.buttons.length) return null;
  // Your circles: add them to one or take them out of one (each a separate tap, as Mastodon's "Add to list").
  const chooseCircles = () => f7.actions.create({ buttons: [
    [{ text: 'Your circles', label: true }, ...circles.circles.map(c => ({ text: circles.isIn(c.id) ? `Remove from ${c.title}` : `Add to ${c.title}`, color: circles.isIn(c.id) ? 'red' : undefined, onClick: () => void circles.toggle(c.id) }))],
    [{ text: 'Cancel', strong: true }],
  ] }).open();
  const circleButton = circles.canWrite && circles.ready && circles.circles.length > 0 ? [{ text: 'Circles…', onClick: chooseCircles }] : [];
  return <Link iconOnly aria-label="More" onClick={() => f7.actions.create({ buttons: [[...circleButton, ...mod.buttons], [{ text: 'Cancel', strong: true }]] }).open()}><Icon ios="f7:ellipsis_circle" md="material:more_vert" /></Link>;
}

export function FediProfilePopup({ target, onClose }: { target: FediProfileTarget | null; onClose: () => void }) {
  const q = useFediProfile(target);
  const p = q.data?.profile;
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => setTag(null), [target]);
  // Opening one of their posts pushes its conversation: the profile closes so it shows.
  useEffect(() => { if (!target) return; const on = () => onClose(); window.addEventListener(OPEN_POST_EVENT, on); return () => window.removeEventListener(OPEN_POST_EVENT, on); }, [target, onClose]);
  return <Popup opened={!!target} onPopupClosed={onClose} swipeToClose className="atlas-fedi-popup">
    <Page>
      <Navbar title={p?.name ?? target?.name ?? 'Profile'}><NavRight>{p && <ProfileMore p={p} />}<Link iconOnly popupClose aria-label="Close profile"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight></Navbar>
      {!p ? <Block>{q.isLoading ? 'Loading their profile from their server…' : 'This profile couldn’t be loaded. Their server may be down or not share it publicly.'}</Block> : <>
        <div className="atlas-fedi-header" style={p.header ? { backgroundImage: `url("${p.header.replace(/"/g, '%22')}")` } : undefined} aria-hidden="true" />
        <header className="atlas-fedi-head">
          {p.avatar ? <img src={p.avatar} alt="" width={80} height={80} referrerPolicy="no-referrer" /> : <span className="atlas-fedi-initial" aria-hidden="true">{p.name.charAt(0)}</span>}
          <h1>{p.name}{p.kind === 'bot' && <small> · Automated</small>}{p.kind === 'group' && <small> · Group</small>}{p.kind === 'podcast' && <small> · Podcast</small>}{p.kind === 'channel' && <small> · Video channel</small>}{p.locked && <Icon ios="f7:lock_fill" md="material:lock" aria-label="Approves followers" />}</h1>
          <p className="atlas-fedi-acct">{p.acct}{p.acctVerified && <Icon ios="f7:checkmark_seal_fill" md="material:verified" aria-label="Handle confirmed by their server" />}</p>
          {p.joined && <p className="atlas-fedi-note">Joined {day(p.joined)}</p>}
          <div className="atlas-fedi-stats">
            {n(p.postCount) && <span><b>{n(p.postCount)}</b> posts</span>}
            {n(p.following) && <span><b>{n(p.following)}</b> following</span>}
            {n(p.followers) && <span><b>{n(p.followers)}</b> followers</span>}
          </div>
          <Follow p={p} />
        </header>
        {p.podcast && (p.podcast.category || p.podcast.feed) && <List strong inset dividers>
          {p.podcast.category && <ListItem header="Category" title={p.podcast.category} />}
          {p.podcast.feed && <ListItem link={p.podcast.feed} external target="_blank" title="RSS feed"><Icon slot="media" ios="f7:dot_radiowaves_left_right" md="material:rss_feed" /></ListItem>}
        </List>}
        {p.bio.length > 0 && <Block className="atlas-fedi-bio">{p.bio.map((t, i) => <p key={i}>{linkifyPost(t, undefined, tag => { onClose(); openTag(tag); })}</p>)}</Block>}
        {p.fields.length > 0 && <List strong inset dividers>{p.fields.map(f => <ListItem key={f.name} header={f.name} title={f.value} />)}</List>}
        {p.featured && <MobileFeaturedTags tags={p.featured} selected={tag} onSelect={setTag} />}
        <MobileProfilePosts p={p} tag={tag} onClearTag={() => setTag(null)} onTag={t => { onClose(); openTag(t); }} />
        <Block><Link external target="_blank" href={p.url}>View on {p.host}</Link></Block>
      </>}
    </Page>
  </Popup>;
}

/**
 * Phone: their posts — the ones Fedizen has as feed cards you can act on, and the newest from their own server that
 * Fedizen hasn't received yet, read-only with that server's counts. Older posts load as you near the end.
 */
function MobileProfilePosts({ p, onTag, tag, onClearTag }: { p: FediProfile; onTag: (tag: string) => void; tag: string | null; onClearTag: () => void }) {
  const posts = useProfilePosts(p, tag);
  const actions = useMobilePostActions();
  const end = useRef<HTMLDivElement>(null);
  const { hasMore, loadMore } = posts;
  useEffect(() => {
    const el = end.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(); }, { rootMargin: '0px 0px 800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);
  return <>
    {tag
      ? <BlockTitle className="atlas-featured-title"><span>Posts with <TagText tag={tag} mark /></span><Link onClick={onClearTag}>All posts</Link></BlockTitle>
      : <BlockTitle>{p.kind === 'podcast' ? 'Episodes and posts' : p.kind === 'channel' ? 'Videos' : 'Recent posts'}</BlockTitle>}
    {actions.error && <Block><p role="alert" className="atlas-fedi-note">{actions.error}</p></Block>}
    <FilterPlaceProvider place="account">{posts.items.map(x => x.kind === 'fedizen'
      ? <MobilePostCard key={`f-${x.post.id}`} post={x.post} actions={actions} />
      : <OriginPost key={`o-${x.post.id}`} post={x.post} host={p.host} onTag={onTag} />)}</FilterPlaceProvider>
    {posts.loading && !posts.items.length && <Block>Loading their posts…</Block>}
    {!posts.loading && !posts.items.length && <Block>{tag ? 'No public posts with this hashtag that Atlas can see.' : p.postsHidden ? `${p.host} doesn’t share this account’s posts publicly.` : 'No public posts yet.'}</Block>}
    {posts.hasMore && <div ref={end} className="atlas-older">
      {posts.loadingMore ? <span>Loading older posts…</span> : <Link onClick={posts.loadMore}>{posts.moreFailed ? 'Couldn’t load older posts. Try again' : 'Load older posts'}</Link>}
    </div>}
    {actions.sheet}
  </>;
}

/** A post from their own server that Fedizen hasn't received yet: read-only, with that server's counts. */
function OriginPost({ post, host, onTag }: { post: FediProfilePost; host: string; onTag: (tag: string) => void }) {
  const c = post.counts;
  const counts = [c?.replies != null ? `${n(c.replies)} replies` : '', c?.boosts != null ? `${n(c.boosts)} boosts` : '', c?.likes != null ? `${n(c.likes)} likes` : ''].filter(Boolean).join(' · ');
  return <MobileFilterGate post={post}><Block strong inset className="atlas-fedi-post">
    {post.title && <h2>{post.title}</h2>}
    <AuthorWarning cw={post.cw} phone><PostBody post={post} onTag={onTag} />
    <SensitiveMedia sensitive={post.sensitive} cta="Tap to view">{post.video ? <VideoPlayer video={post.video} /> : post.image && <img src={post.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}</SensitiveMedia></AuthorWarning>
    <p className="atlas-fedi-note">{[day(post.date), counts].filter(Boolean).join(' · ')}</p>
    <p className="atlas-fedi-note">Not on Fedizen yet · <Link external target="_blank" href={post.url}>Open on {host}</Link></p>
  </Block></MobileFilterGate>;
}

/** Phone: the hashtags someone features, as a row of tiles that scrolls sideways; picking one shows their posts with it. */
function MobileFeaturedTags({ tags, selected, onSelect }: { tags: FeaturedTag[]; selected: string | null; onSelect: (tag: string | null) => void }) {
  return <>
    <BlockTitle>Featured hashtags</BlockTitle>
    <div className="atlas-featured-tags" role="list">
      {tags.map(t => {
        const on = selected?.toLowerCase() === t.name.toLowerCase();
        const detail = featuredDetail(t);
        return <button key={t.name} type="button" role="listitem" aria-pressed={on} className={on ? 'is-on' : undefined}
          aria-label={`${hashtagLabel(t.name)}${detail ? `, ${detail}` : ''}${on ? ', showing posts with it' : ''}`} onClick={() => onSelect(on ? null : t.name)}>
          <span className="atlas-featured-name"><TagText tag={t.name} /></span>
          {detail && <span className="atlas-featured-detail">{detail}</span>}
        </button>;
      })}
    </div>
  </>;
}
