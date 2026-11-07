import { Block, BlockFooter, BlockTitle, Button, Card, CardContent, CardFooter, Icon, Link, List, ListItem, Navbar, NavLeft, NavRight, Page, Popup, f7 } from 'framework7-react';
import { useGroup, useGroups } from '@/components/social/useGroups';
import { groupAccessLabel, groupHandle, type Group, type GroupPost } from '@/lib/groups';

const when = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const members = (n?: number) => (n == null ? '' : `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`);
const meta = (g: Group) => [members(g.members), groupAccessLabel(g)].filter(Boolean).join(' · ');

/** Groups are rounded squares, people are circles: the shape tells them apart at a glance. */
export function GroupAvatar({ g, size = 44 }: { g: Group; size?: number }) {
  return g.avatar
    ? <img className="atlas-group-avatar" src={g.avatar} alt="" width={size} height={size} referrerPolicy="no-referrer" style={{ width: size, height: size }} />
    : <span className="atlas-group-avatar atlas-group-initial" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.45 }}>{g.name.charAt(0)}</span>;
}

function PostCard({ p, showGroup }: { p: GroupPost; showGroup?: boolean }) {
  return <Card outline className="atlas-group-post">
    <CardContent>
      <div className="atlas-group-post-head">
        {p.avatar ? <img src={p.avatar} alt="" width={32} height={32} referrerPolicy="no-referrer" /> : <span className="atlas-activity-initial" aria-hidden="true">{p.author.charAt(0)}</span>}
        <span><b>{p.author}</b>{showGroup && p.group && <> <span className="atlas-group-in">in {p.group}</span></>}<small>{p.handle}{p.date ? ` · ${when(p.date)}` : ''}</small></span>
      </div>
      {p.paragraphs.slice(0, 4).map((t, i) => <p key={i}>{t}</p>)}
      {p.image && <img className="atlas-group-post-image" src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    </CardContent>
    <CardFooter><span /><Link external target="_blank" href={p.url}>Open on Fedizen</Link></CardFooter>
  </Card>;
}

/** The Groups tab: Fedizen's group directory, then the latest posts across groups. */
export function MobileGroups({ onOpen }: { onOpen: (g: Group) => void }) {
  const q = useGroups();
  if (q.isLoading) return <Block strong inset>Loading groups from Fedizen…</Block>;
  if (q.isError || q.data?.error) return <Block strong inset>Fedizen couldn’t be reached right now. <Link onClick={() => q.refetch()}>Try again</Link></Block>;
  const groups = (q.data?.groups ?? []).filter(g => g.type === 'group');
  if (!groups.length) return <div className="atlas-profile-empty">
    <div className="atlas-profile-empty-icon"><Icon ios="f7:person_3" md="material:groups" /></div>
    <h2>No groups yet</h2>
    <p>Groups on Fedizen, and those it follows on Lemmy, Mbin and other servers, will appear here.</p>
  </div>;
  return <>
    <BlockTitle>Groups on Fedizen</BlockTitle>
    <List strong inset dividers mediaList className="atlas-group-list">
      {groups.map(g => <ListItem key={g.id} link="#" title={g.name} subtitle={meta(g)} text={g.summary[0]} onClick={() => onOpen(g)}>
        <span slot="media"><GroupAvatar g={g} /></span>
      </ListItem>)}
    </List>
    <BlockFooter>Groups federate across the fediverse, so you can also find communities from Lemmy, Mbin and Mobilizon here.</BlockFooter>
    {!!q.data?.latest.length && <>
      <BlockTitle>Latest in groups</BlockTitle>
      {q.data.latest.slice(0, 12).map(p => <PostCard key={p.id} p={p} showGroup />)}
    </>}
  </>;
}

/** One group: banner, avatar, name, address, how to take part, about, topics and latest posts. */
export function GroupPopup({ group, onClose, onOpen }: { group: Group | null; onClose: () => void; onOpen: (g: Group) => void }) {
  const q = useGroup(group?.id);
  const g = (q.data && q.data.group) || group;
  const handle = g ? groupHandle(g) : undefined;
  const share = async () => {
    if (!g) return;
    try {
      if (navigator.share) await navigator.share({ title: g.name, url: g.url });
      else { await navigator.clipboard.writeText(g.url); f7.toast.create({ text: 'Link copied', closeTimeout: 1500 }).open(); }
    } catch { /* dismissed */ }
  };
  const copyAddress = async () => {
    if (!handle) return;
    try { await navigator.clipboard.writeText(handle); f7.toast.create({ text: 'Address copied', closeTimeout: 1500 }).open(); } catch { /* unavailable */ }
  };
  const detail = q.data && q.data.group ? q.data : null;
  return <Popup opened={!!group} onPopupClosed={onClose} swipeToClose className="atlas-group-popup">
    <Page>
      <Navbar title={g?.type === 'topic' ? 'Topic' : 'Group'}>
        <NavLeft><Link iconOnly onClick={share} aria-label="Share group"><Icon ios="f7:square_arrow_up" md="material:share" /></Link></NavLeft>
        <NavRight><Link iconOnly popupClose aria-label="Close"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight>
      </Navbar>
      {g && <>
        <div className="atlas-group-banner" aria-hidden="true" style={g.banner ? { backgroundImage: `url("${encodeURI(g.banner)}")` } : undefined} />
        <header className="atlas-group-head">
          <GroupAvatar g={g} size={76} />
          <h1>{g.name}</h1>
          {handle && <button type="button" className="atlas-group-address" onClick={copyAddress} aria-label={`Copy address ${handle}`}>{handle}</button>}
          <p className="atlas-group-meta">{meta(g)}</p>
          {g.host !== 'fedizen.net' && <p className="atlas-group-meta">Hosted on {g.host} · followed by Fedizen</p>}
          <div className="atlas-group-actions">
            <Button fill round external target="_blank" href={g.url}>{g.announcements || g.joinMode === 'invite' ? 'Follow on Fedizen' : g.joinMode === 'request' ? 'Ask to join on Fedizen' : 'Join on Fedizen'}</Button>
          </div>
          <p className="atlas-group-note">Joining and posting happen on Fedizen. Atlas only reads.</p>
        </header>
        {g.summary.length > 0 && <><BlockTitle>About</BlockTitle><Block strong inset className="atlas-group-about">{g.summary.map((t, i) => <p key={i}>{t}</p>)}</Block></>}
        {g.membersOnlyContent && <Block strong inset>Posts here are for members. Join on Fedizen to read them.</Block>}
        {!!detail?.topics.length && <>
          <BlockTitle>Topics</BlockTitle>
          <List strong inset dividers>
            {detail.topics.map(t => <ListItem key={t.id} link="#" title={t.name} footer={t.summary[0]} onClick={() => onOpen(t)}>
              <Icon slot="media" ios="f7:number" md="material:tag" />
            </ListItem>)}
          </List>
        </>}
        <BlockTitle>Latest posts</BlockTitle>
        {q.isLoading ? <Block>Loading posts…</Block>
          : q.data && !q.data.group ? <Block strong inset>{q.data.error === 'not-found' ? 'This group can’t be opened. It may be private or archived.' : 'Fedizen couldn’t be reached right now.'}</Block>
          : detail?.posts.length ? detail.posts.map(p => <PostCard key={p.id} p={p} />)
          : <Block strong inset>No public posts here yet.</Block>}
      </>}
    </Page>
  </Popup>;
}
