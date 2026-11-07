import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Block, BlockTitle, Button, Card, CardContent, CardFooter, Link, List, ListItem, Navbar, NavRight, Page, Popup } from 'framework7-react';
import { getRecentArticles, getFedizenPublic } from '@/lib/bonfire.functions';
import type { BonfireArticle } from '@/lib/spotlight';
import { useFedizen } from '@/components/social/useFedizen';
import { Icon } from './F7Extras';

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
        <CardFooter><span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>{a.avatar && <img src={a.avatar} alt="" width={20} height={20} style={{ borderRadius: 10 }} />}{a.author} · {when(a.date)}</span></CardFooter>
      </Card></div>)}
    <Popup opened={!!open} onPopupClosed={() => setOpen(null)} swipeToClose>
      <Page>
        <Navbar title={open?.author ?? ''}><NavRight><Link popupClose iconOnly aria-label="Close article"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight></Navbar>
        {open && <Block>
          {open.image && <img src={open.image} alt="" style={{ width: '100%', borderRadius: 16 }} />}
          <h1 style={{ fontFamily: 'Instrument Serif, serif', fontWeight: 400, fontSize: 30, lineHeight: 1.15 }}>{open.title}</h1>
          {open.authorUrl
            ? <Link external target="_blank" href={open.authorUrl} aria-label={`More from ${open.author} on the fediverse`} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', margin: '4px 0 8px' }}>
                {open.avatar && <img src={open.avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" style={{ borderRadius: 10, objectFit: 'cover' }} />}
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
  return <>
    <BlockTitle>Your Fedizen feed</BlockTitle>
    {!f.signedIn ? <Block strong inset>Sign in to Atlas to see your Fedizen feed. <Link href="/auth" external>Sign in</Link></Block>
      : f.loading ? <Block strong inset>Loading your Fedizen feed…</Block>
      : !f.data?.connected || f.data.error === 'expired' ? <Block strong inset>
        <p style={{ marginTop: 0 }}>{f.data?.error === 'expired' ? 'Fedizen ended Atlas’s access. Connect again to keep reading.' : 'Let Atlas read your Fedizen timeline and notifications. Atlas can only read — it can’t post, follow or change anything.'}</p>
        {f.embedded ? <Button fill round external target="_blank" href={`${window.location.origin}/app`}>Open Atlas in a new tab to connect</Button> : <Button fill round onClick={f.connect}>Connect Fedizen</Button>}
        {f.error && <p role="alert" style={{ color: 'var(--f7-theme-color)' }}>{f.error}</p>}
      </Block>
      : !f.data.posts.length ? <Block strong inset>Your Fedizen timeline is empty.</Block>
      : f.data.posts.map(p => <Card key={p.id} outline>
        <CardContent>
          {p.boostedBy && <p style={{ fontSize: 11, opacity: .6, marginTop: 0 }}>↻ {p.boostedBy} boosted</p>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>{p.avatar && <img src={p.avatar} alt="" width={32} height={32} style={{ borderRadius: 16 }} />}<span><b>{p.author}</b> <span style={{ opacity: .6 }}>{p.handle}</span></span></div>
          {p.paragraphs.map((t, i) => <p key={i} style={{ lineHeight: 1.5 }}>{t}</p>)}
          {p.image && <img src={p.image} alt="" loading="lazy" style={{ width: '100%', borderRadius: 12 }} />}
        </CardContent>
        <CardFooter><span style={{ fontSize: 12, opacity: .6 }}>{when(p.date)}</span><Link external target="_blank" href={p.url}>Open</Link></CardFooter>
      </Card>)}
    {(!f.signedIn || (!f.loading && (!f.data?.connected || f.data.error === 'expired'))) && <MobilePublicFedizen />}
  </>;
}

const noticeIcon: Record<string, { ios: string; md: string }> = {
  favourite: { ios: 'f7:heart_fill', md: 'material:favorite' },
  reblog: { ios: 'f7:arrow_2_squarepath', md: 'material:repeat' },
  follow: { ios: 'f7:person_badge_plus_fill', md: 'material:person_add' },
  follow_request: { ios: 'f7:person_badge_plus', md: 'material:person_add_alt' },
  mention: { ios: 'f7:at', md: 'material:alternate_email' },
  status: { ios: 'f7:square_pencil', md: 'material:edit' },
  poll: { ios: 'f7:chart_bar_alt_fill', md: 'material:poll' },
};

/** Activity tab: the person's real Fedizen notifications (read-only). */
export function MobileActivity() {
  const f = useFedizen();
  if (!f.signedIn) return <Block strong inset>Sign in to Atlas to see who followed, mentioned or boosted you. <Link href="/auth" external>Sign in</Link></Block>;
  if (f.loading) return <Block strong inset>Loading your activity…</Block>;
  if (!f.data?.connected || f.data.error === 'expired') return <Block strong inset>
    <p style={{ marginTop: 0 }}>{f.data?.error === 'expired' ? 'Fedizen ended Atlas’s access. Connect again to see your activity.' : 'Connect Fedizen to see your notifications here. Atlas can only read — it can’t post, follow or change anything.'}</p>
    {f.embedded ? <Button fill round external target="_blank" href={`${window.location.origin}/app`}>Open Atlas in a new tab to connect</Button> : <Button fill round onClick={f.connect}>Connect Fedizen</Button>}
    {f.error && <p role="alert" style={{ color: 'var(--f7-theme-color)' }}>{f.error}</p>}
  </Block>;
  const n = f.data.notices;
  if (!n.length) return <Block strong inset>No activity yet. Follows, mentions, likes and boosts on Fedizen will show up here.</Block>;
  return <List strong inset dividers mediaList className="atlas-activity">
    {n.map(x => {
      const i = noticeIcon[x.type] ?? { ios: 'f7:bell_fill', md: 'material:notifications' };
      return <ListItem key={x.id} title={x.author} after={when(x.date)} text={x.text}>
        <span slot="media" className="atlas-activity-media">
          {x.avatar ? <img src={x.avatar} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : <span className="atlas-activity-initial" aria-hidden="true">{x.author.charAt(0)}</span>}
          <span className={`atlas-activity-kind atlas-activity-${x.type}`}><Icon ios={i.ios} md={i.md} /></span>
        </span>
      </ListItem>;
    })}
  </List>;
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
      : list.slice(0, 8).map(p => <Card key={p.id} outline>
        <CardContent>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>{p.avatar && <img src={p.avatar} alt="" width={32} height={32} style={{ borderRadius: 16 }} referrerPolicy="no-referrer" />}<span><b>{p.author}</b> <span style={{ opacity: .6 }}>{p.handle}</span></span></div>
          {p.paragraphs.slice(0, 5).map((t, i) => <p key={i} style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }}>{t}</p>)}
          {p.image && <img src={p.image} alt="" loading="lazy" style={{ width: '100%', borderRadius: 12 }} referrerPolicy="no-referrer" />}
        </CardContent>
        <CardFooter><span style={{ fontSize: 12, opacity: .6 }}>{when(p.date)}</span><Link external target="_blank" href={p.url}>Open</Link></CardFooter>
      </Card>)}
  </>;
}
