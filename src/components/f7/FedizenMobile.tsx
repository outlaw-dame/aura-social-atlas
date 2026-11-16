import { useFollowRequests } from '@/components/social/useOwnPosts';
import { openTag } from '@/lib/hashtags';
import { linkifyPost } from '@/components/social/PostPeople';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Block, BlockTitle, Button, Card, CardContent, CardFooter, Link, List, ListItem, Navbar, NavRight, Page, Popup } from 'framework7-react';
import { getRecentArticles, getFedizenPublic } from '@/lib/bonfire.functions';
import type { BonfireArticle } from '@/lib/spotlight';
import { useFedizen, useFedizenMessages } from '@/components/social/useFedizen';
import { openCollection } from '@/lib/collections';
import { openFediProfile } from '@/lib/fedi-profile';
import { SaveLink } from './SavedAndCircles';
import { ArticleCard } from './ArticleAuthors';
import { VideoPlayer } from '@/components/social/VideoPlayer';
import { Icon } from './F7Extras';
import { MobilePostCard, useMobilePostActions } from './MobilePostCard';
import { FilterPlaceProvider } from '@/components/social/useIntelligence';
import { MobileFilterGate } from './FilterGate';
import { SensitiveMedia } from '@/components/social/SensitiveMedia';
import { AuthorWarning } from '@/components/social/ContentWarning';
import { useHomeTimeline } from '@/components/social/useHomeTimeline';

const when = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export function MobileRecentArticles() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['bonfire-articles'], queryFn: () => getRecentArticles(), staleTime: 5 * 60_000 });
  const [open, setOpen] = useState<BonfireArticle | null>(null);
  const list = data?.articles ?? [];
  return <>
    <BlockTitle><span className="atlas-blocktitle-icon"><Icon ios="f7:book" md="material:menu_book" /> Recent articles</span></BlockTitle>
    {isLoading ? <Block strong inset>Loading articles from Fedizen…</Block>
      : isError || data?.error ? <Block strong inset>Fedizen couldn’t be reached right now. <Link onClick={() => refetch()}>Try again</Link></Block>
      : !list.length ? <Block strong inset>No articles on Fedizen yet.</Block>
      : list.slice(0, 6).map(a => <div key={a.id} role="button" tabIndex={0} onClick={() => setOpen(a)} onKeyDown={e => e.key === 'Enter' && setOpen(a)} style={{ cursor: 'pointer' }}><Card outline>
        {a.image && <img src={a.image} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />}
        <CardContent><div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 22, lineHeight: 1.2 }}>{a.title}</div>{a.summary && <p style={{ opacity: .7, fontSize: 14, marginBottom: 0 }}>{a.summary.slice(0, 140)}</p>}</CardContent>
        <CardFooter><span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>{a.avatar && <img src={a.avatar} alt="" width={20} height={20} className="atlas-avatar" style={{ objectFit: 'cover' }} />}{a.author} · {when(a.date)}</span></CardFooter>
      </Card></div>)}
    <Popup opened={!!open} onPopupClosed={() => setOpen(null)} swipeToClose>
      <Page>
        <Navbar title={open?.author ?? ''}><NavRight><Link popupClose iconOnly aria-label="Close article"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight></Navbar>
        {open && <Block>
          {open.image && <img src={open.image} alt="" style={{ width: '100%', borderRadius: 16 }} />}
          <h1 style={{ fontFamily: 'Instrument Serif, serif', fontWeight: 400, fontSize: 30, lineHeight: 1.15 }}>{open.title}</h1>
          {open.authorUrl
            ? <Link onClick={() => openFediProfile({ actor: open.authorUrl, acct: open.handle, name: open.author })} aria-label={`More from ${open.author}`} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', margin: '4px 0 8px' }}>
                {open.avatar && <img src={open.avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" className="atlas-avatar" style={{ objectFit: 'cover' }} />}
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}><b style={{ fontSize: 14 }}>{open.author}</b><span style={{ opacity: .6, fontSize: 12 }}>{open.handle}</span></span>
              </Link>
            : null}
          <p style={{ opacity: .6, fontSize: 12 }}>{open.authorUrl ? '' : `${open.handle ?? ''} · `}{when(open.date)} · ♥ {open.likes} · ↻ {open.boosts}</p>
          {open.paragraphs.map((p, i) => <p key={i} style={{ lineHeight: 1.6 }}>{p}</p>)}
          <Button fill round external target="_blank" href={open.url} style={{ marginTop: 16 }}>Open on Fedizen</Button>
        </Block>}
      </Page>
    </Popup>
  </>;
}

export function MobileFedizenFeed() {
  const f = useFedizen();
  const actions = useMobilePostActions();
  const list = useRef<HTMLDivElement>(null);
  const live = !!f.data?.connected && !f.data.error;
  const tl = useHomeTimeline(f.data, live, list, f.updatedAt);
  return <>
    <BlockTitle>Your Fedizen feed</BlockTitle>
    {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
    {!f.signedIn ? <Block strong inset>Sign in to Atlas to see your Fedizen feed. <Link href="/auth" external>Sign in</Link></Block>
      : f.loading ? <Block strong inset>Loading your Fedizen feed…</Block>
      : !f.data?.connected || f.data.error === 'expired' ? <Block strong inset>
        <p style={{ marginTop: 0 }}>{f.data?.error === 'expired' ? 'Fedizen ended Atlas’s access. Connect again to keep reading.' : 'Connect your Fedizen account to see your timeline and notifications here, and to join groups and follow people from Atlas.'}</p>
        {f.embedded ? <Button fill round external target="_blank" href={`${window.location.origin}/app`}>Open Atlas in a new tab to connect</Button> : <Button fill round onClick={f.connect}>Connect Fedizen</Button>}
        {f.error && <p role="alert" style={{ color: 'var(--f7-theme-color)' }}>{f.error}</p>}
      </Block>
      : !tl.posts.length ? <Block strong inset>Your Fedizen timeline is empty.</Block>
      : <div ref={list} className="atlas-home-list">
        {/* New posts wait here until asked for (Bonfire: "Show N new activities"; Mastodon: "N new items"). */}
        {tl.newCount > 0 && <div className="atlas-new-posts"><button type="button" onClick={tl.reveal}><Icon ios="f7:arrow_up" md="material:arrow_upward" />{tl.newCount === 1 ? '1 new post' : `${tl.newCount}${tl.gap ? '+' : ''} new posts`}</button></div>}
        {tl.posts.map(p => <MobilePostCard key={p.id} post={p} actions={actions} />)}
        {tl.hasOlder && <div ref={tl.sentinel} className="atlas-older">
          {tl.olderFailed ? <span>Couldn’t load older posts. <Link onClick={() => void tl.loadOlder()}>Try again</Link></span>
            : tl.loadingOlder ? <span><span className="preloader preloader-small" /> Loading older posts…</span>
            : <Link onClick={() => void tl.loadOlder()}>Load older posts</Link>}
        </div>}
      </div>}
    {(!f.signedIn || (!f.loading && (!f.data?.connected || f.data.error === 'expired'))) && <MobilePublicFedizen />}
    {actions.sheet}
  </>;
}

const noticeIcon: Record<string, { ios: string; md: string }> = {
  favourite: { ios: 'f7:heart_fill', md: 'material:favorite' },
  reblog: { ios: 'f7:arrow_2_circlepath', md: 'material:sync' },
  follow: { ios: 'f7:person_badge_plus_fill', md: 'material:person_add' },
  follow_request: { ios: 'f7:person_badge_plus', md: 'material:person_add_alt' },
  mention: { ios: 'f7:at', md: 'material:alternate_email' },
  status: { ios: 'f7:square_pencil', md: 'material:edit' },
  poll: { ios: 'f7:chart_bar_alt_fill', md: 'material:poll' },
  added_to_collection: { ios: 'f7:square_stack_3d_up_fill', md: 'material:collections_bookmark' },
  collection_update: { ios: 'f7:square_stack_3d_up', md: 'material:collections_bookmark' },
};

/** Phone: people asking to follow you, with Accept and Decline, above Activity (only while there are some). */
function MobileFollowRequests() {
  const r = useFollowRequests();
  if (!r.people.length && !r.readError) return null;
  return <>
    <BlockTitle>Follow requests</BlockTitle>
    {r.readError && <Block>{r.readError}</Block>}
    <List strong inset dividers mediaList>
      {r.people.map(p => <ListItem key={p.id} title={p.name} subtitle={p.handle}
        link="#" onClick={() => openFediProfile({ actor: p.actor, acct: p.acct, name: p.name })}>
        <span slot="media" className="atlas-activity-media">{p.avatar ? <img src={p.avatar} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : <span className="atlas-activity-initial" aria-hidden="true">{p.name.charAt(0)}</span>}</span>
        <span slot="footer" className="atlas-request-actions">
          <Button small fill round disabled={r.busyId === p.id} onClick={(e: { stopPropagation?: () => void }) => { e.stopPropagation?.(); r.answer(p.id, true); }}>Accept</Button>
          <Button small tonal round disabled={r.busyId === p.id} onClick={(e: { stopPropagation?: () => void }) => { e.stopPropagation?.(); r.answer(p.id, false); }}>Decline</Button>
        </span>
      </ListItem>)}
    </List>
    {r.error && <Block><p role="alert" style={{ margin: 0 }}>{r.error}</p></Block>}
  </>;
}

/** Activity tab: the person's real Fedizen notifications. */
export function MobileActivity() {
  const f = useFedizen();
  if (!f.signedIn) return <Block strong inset>Sign in to Atlas to see who followed, mentioned or boosted you. <Link href="/auth" external>Sign in</Link></Block>;
  if (f.loading) return <Block strong inset>Loading your activity…</Block>;
  if (!f.data?.connected || f.data.error === 'expired') return <Block strong inset>
    <p style={{ marginTop: 0 }}>{f.data?.error === 'expired' ? 'Fedizen ended Atlas’s access. Connect again to see your activity.' : 'Connect your Fedizen account to see your notifications here, and to join groups and follow people from Atlas.'}</p>
    {f.embedded ? <Button fill round external target="_blank" href={`${window.location.origin}/app`}>Open Atlas in a new tab to connect</Button> : <Button fill round onClick={f.connect}>Connect Fedizen</Button>}
    {f.error && <p role="alert" style={{ color: 'var(--f7-theme-color)' }}>{f.error}</p>}
  </Block>;
  const n = f.data.notices;
  if (!n.length) return <><MobileFollowRequests /><Block strong inset>No activity yet. Follows, mentions, likes and boosts on Fedizen will show up here.</Block></>;
  return <><MobileFollowRequests /><List strong inset dividers mediaList className="atlas-activity">
    {n.map(x => {
      const i = noticeIcon[x.type] ?? { ios: 'f7:bell_fill', md: 'material:notifications' };
      // Tapping someone in Activity opens their profile in Atlas (phones have no hover card).
      const who = x.acct || x.actor ? { actor: x.actor, acct: x.acct, name: x.author } : null;
      return <ListItem key={x.id} title={x.author} after={when(x.date)} text={x.text} {...(who ? { link: '#', onClick: (e: { preventDefault?: () => void }) => { e.preventDefault?.(); openFediProfile(who); } } : {})}>
        <span slot="media" className="atlas-activity-media">
          {x.avatar ? <img src={x.avatar} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : <span className="atlas-activity-initial" aria-hidden="true">{x.author.charAt(0)}</span>}
          <span className={`atlas-activity-kind atlas-activity-${x.type}`}><Icon ios={i.ios} md={i.md} /></span>
        </span>
      </ListItem>;
    })}
  </List></>;
}

/** Phone: live public Fedizen posts, no sign-in needed. */
export function MobilePublicFedizen() {
  const q = useQuery({ queryKey: ['fedizen-public'], queryFn: () => getFedizenPublic(), staleTime: 60_000 });
  const list = q.data?.posts ?? [];
  return <>
    <BlockTitle>Live on Fedizen</BlockTitle>
    {q.isLoading ? <Block strong inset>Loading public posts…</Block>
      : q.isError || q.data?.error ? <Block strong inset>Fedizen couldn’t be reached right now. <Link onClick={() => q.refetch()}>Try again</Link></Block>
      : !list.length ? <Block strong inset>No public posts on Fedizen yet.</Block>
      : <FilterPlaceProvider place="public">{list.slice(0, 8).map(p => <MobileFilterGate key={p.id} post={p}><Card outline>
        <CardContent>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>{p.avatar && <img src={p.avatar} alt="" width={32} height={32} className="atlas-avatar" style={{ objectFit: 'cover' }} referrerPolicy="no-referrer" />}<span><b>{p.author}</b> <span style={{ opacity: .6 }}>{p.handle}</span></span></div>
          <AuthorWarning cw={p.cw} phone>{p.paragraphs.slice(0, 5).map((t, i) => <p key={i} style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }}>{linkifyPost(t, p.mentions, openTag)}</p>)}
          <SensitiveMedia sensitive={p.sensitive} cta="Tap to view">{p.image && <img src={p.image} alt="" loading="lazy" style={{ width: '100%', borderRadius: 12 }} referrerPolicy="no-referrer" />}</SensitiveMedia></AuthorWarning>
        </CardContent>
        <CardFooter><span style={{ fontSize: 12, opacity: .6 }}>{when(p.date)}</span><Link external target="_blank" href={p.url}>Open</Link></CardFooter>
      </Card></MobileFilterGate>)}</FilterPlaceProvider>}
  </>;
}

/** Phone: Messages, opened from the top right. Direct conversations from Fedizen (Mastodon's conversations API, served by Bonfire). */
export function MessagesPopup({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const f = useFedizen();
  const m = useFedizenMessages(opened && !!f.data?.connected);
  const list = m.data?.conversations ?? [];
  const body = !f.signedIn ? <Block strong inset>Sign in to Atlas to read your direct messages. <Link href="/auth" external>Sign in</Link></Block>
    : f.loading || m.loading ? <Block strong inset>Loading your messages…</Block>
    : !f.data?.connected || f.data.error === 'expired' || m.data?.error === 'expired' ? <Block strong inset>
      <p style={{ marginTop: 0 }}>{f.data?.connected ? 'Fedizen ended Atlas’s access. Connect again to read your messages.' : 'Connect your Fedizen account to read your direct messages here.'}</p>
      {f.embedded ? <Button fill round external target="_blank" href={`${window.location.origin}/app`}>Open Atlas in a new tab to connect</Button> : <Button fill round onClick={f.connect}>Connect Fedizen</Button>}
      {f.error && <p role="alert" style={{ color: 'var(--f7-theme-color)' }}>{f.error}</p>}
    </Block>
    : m.queryError || m.data?.error ? <Block strong inset>Fedizen couldn’t send your messages right now. <Link onClick={m.retry}>Try again</Link></Block>
    : !list.length ? <Block strong inset>No messages yet. Direct messages with people on Fedizen and across the fediverse show up here.</Block>
    : <List strong inset dividers mediaList className="atlas-activity">
      {list.map(c => {
        const who = c.people[0];
        const names = c.people.map(p => p.name).join(', ') || 'Just you';
        return <ListItem key={c.id} link={c.url ?? undefined} external={!!c.url} target={c.url ? '_blank' : undefined} title={names} after={when(c.date)} text={c.text || 'No text'} className={c.unread ? 'atlas-msg-unread' : undefined}>
          <span slot="media" className="atlas-activity-media">
            {who?.avatar ? <img src={who.avatar} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : <span className="atlas-activity-initial" aria-hidden="true">{names.charAt(0)}</span>}
            {c.unread && <span className="atlas-msg-dot" aria-label="Unread" />}
          </span>
        </ListItem>;
      })}
    </List>;
  return <Popup opened={opened} onPopupClosed={onClose} swipeToClose>
    <Page>
      <Navbar title="Messages"><NavRight><Link iconOnly popupClose aria-label="Close"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight></Navbar>
      {body}
    </Page>
  </Popup>;
}
