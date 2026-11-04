import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Block, BlockTitle, Button, Card, CardContent, CardFooter, Link, Navbar, NavRight, Page, Popup } from 'framework7-react';
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
          <p style={{ opacity: .6, fontSize: 12 }}>{open.handle} · {when(open.date)} · ♥ {open.likes} · ↻ {open.boosts}</p>
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

/** Bell text for the phone navbar: real Fedizen notifications when connected. */
export function useActivitySummary() {
  const f = useFedizen();
  const n = f.data?.notices ?? [];
  if (!f.data?.connected) return 'Connect Fedizen in Following to see activity';
  return n.length ? n.slice(0, 3).map(x => `${x.author} ${x.text}`).join('\n') : 'No new activity';
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
