import { Block, BlockTitle, Button, Icon, Link, List, ListItem, Navbar, NavRight, Page, Popup } from 'framework7-react';
import type { FediProfileTarget } from '@/lib/fedi-profile';
import { useFediFollow, useFediProfile } from '@/components/social/useFediProfile';

/**
 * Phone: a fediverse account opened inside Atlas from an author tag — read from the account's own server
 * (ActivityPub), with its newest public posts, and Follow through the reader's Fedizen connection.
 */

const n = (v?: number) => (v == null ? null : new Intl.NumberFormat(undefined, { notation: 'compact' }).format(v));
const day = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function Follow({ acct, locked }: { acct: string; locked: boolean }) {
  const f = useFediFollow(acct);
  if (!f.signedIn) return null;
  const on = f.state === 'following', asked = f.state === 'requested';
  return <>
    {f.canFollow && <Button round fill={!on && !asked} tonal={on || asked} disabled={f.busy} onClick={f.toggle} aria-pressed={on}>
      {on ? 'Following' : asked ? 'Requested' : locked ? 'Request to follow' : 'Follow'}
    </Button>}
    {f.error && <p role="alert" className="atlas-fedi-note">{f.error}</p>}
  </>;
}

export function FediProfilePopup({ target, onClose }: { target: FediProfileTarget | null; onClose: () => void }) {
  const q = useFediProfile(target);
  const p = q.data?.profile;
  return <Popup opened={!!target} onPopupClosed={onClose} swipeToClose className="atlas-fedi-popup">
    <Page>
      <Navbar title={p?.name ?? target?.name ?? 'Profile'}><NavRight><Link iconOnly popupClose aria-label="Close profile"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight></Navbar>
      {!p ? <Block>{q.isLoading ? 'Loading their profile from their server…' : 'This profile couldn’t be loaded. Their server may be down or not share it publicly.'}</Block> : <>
        <div className="atlas-fedi-header" style={p.header ? { backgroundImage: `url("${p.header.replace(/"/g, '%22')}")` } : undefined} aria-hidden="true" />
        <header className="atlas-fedi-head">
          {p.avatar ? <img src={p.avatar} alt="" width={80} height={80} referrerPolicy="no-referrer" /> : <span className="atlas-fedi-initial" aria-hidden="true">{p.name.charAt(0)}</span>}
          <h1>{p.name}{p.kind === 'bot' && <small> · Automated</small>}{p.kind === 'group' && <small> · Group</small>}{p.locked && <Icon ios="f7:lock_fill" md="material:lock" aria-label="Approves followers" />}</h1>
          <p className="atlas-fedi-acct">{p.acct}{p.acctVerified && <Icon ios="f7:checkmark_seal_fill" md="material:verified" aria-label="Handle confirmed by their server" />}</p>
          {p.joined && <p className="atlas-fedi-note">Joined {day(p.joined)}</p>}
          <div className="atlas-fedi-stats">
            {n(p.postCount) && <span><b>{n(p.postCount)}</b> posts</span>}
            {n(p.following) && <span><b>{n(p.following)}</b> following</span>}
            {n(p.followers) && <span><b>{n(p.followers)}</b> followers</span>}
          </div>
          <Follow acct={p.acct} locked={p.locked} />
        </header>
        {p.bio.length > 0 && <Block className="atlas-fedi-bio">{p.bio.map((t, i) => <p key={i}>{t}</p>)}</Block>}
        {p.fields.length > 0 && <List strong inset dividers>{p.fields.map(f => <ListItem key={f.name} header={f.name} title={f.value} />)}</List>}
        <BlockTitle>Recent posts</BlockTitle>
        {p.posts.map(post => <Block key={post.id} strong inset className="atlas-fedi-post">
          {post.title && <h2>{post.title}</h2>}
          {post.cw ? <details><summary>Content warning: {post.cw}</summary>{post.paragraphs.map((t, i) => <p key={i}>{t}</p>)}</details>
            : post.paragraphs.map((t, i) => <p key={i}>{t}</p>)}
          {post.image && <img src={post.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
          <p className="atlas-fedi-note">{day(post.date)} · <Link external target="_blank" href={post.url}>Original</Link></p>
        </Block>)}
        {!p.posts.length && <Block>{p.postsHidden ? `${p.host} doesn’t share this account’s posts publicly.` : 'No public posts yet.'}</Block>}
        <Block><Link external target="_blank" href={p.url}>View on {p.host}</Link></Block>
      </>}
    </Page>
  </Popup>;
}
