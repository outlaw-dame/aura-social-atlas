import { useState } from 'react';
import { Block, BlockFooter, BlockTitle, Button, Icon, Link, List, ListInput, ListItem, Navbar, Page, f7 } from 'framework7-react';
import { FEDIZEN_BLOCKED_URL } from '@/lib/fedizen-feed';
import { pushPage } from './navigation';
import { LIBRARY_PROBLEM, useBlockActions, useFedizenBlocks } from '@/components/social/useFedizenLibrary';
import { useMutes } from '@/components/social/useOwnPosts';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useContentFilters } from '@/components/social/useIntelligence';
import { STATS_DAYS, useFilteredCounts } from '@/lib/filter-stats';

/**
 * Phone: Settings → Moderation, a pushed page in the same order as desktop's /settings/moderation: keyword filters,
 * blocked people, muted people, blocked instances — separate lists, where Bonfire shows blocked people and instances
 * in one. Blocked and muted people are read and changed here; keyword filters are Atlas's own (their own page, with
 * how many there are and what they caught); blocked instances open Fedizen's page, since Bonfire v1.1.0-rc.1 has no
 * client API for them yet.
 */
export function ModerationPage() {
  const { user } = useAtlasAuth();
  const q = useFedizenBlocks(true);
  const act = useBlockActions();
  const filters = useContentFilters();
  const list = filters.data && 'filters' in filters.data ? filters.data.filters : [];
  const counts = useFilteredCounts(user?.id);
  const [handle, setHandle] = useState(''), [note, setNote] = useState<string | null>(null);
  const people = q.data?.people ?? [];
  const canWrite = !!q.data?.canWrite;
  const unblock = (id: string, name: string) => f7.dialog.confirm(`Unblock ${name}? They’ll be able to follow you and see your posts again.`, 'Unblock', async () => setNote(await act.unblock(id)));
  const block = async () => { const h = handle.trim(); if (!h) return; const err = await act.block(h); setNote(err); if (!err) setHandle(''); };
  const caught = list.reduce((n, f) => n + (counts.get(f.id) ?? 0), 0);
  return <Page>
      <Navbar title="Moderation" backLink backLinkShowText={false} />

      <List strong inset dividers>
        <ListItem link="#" title="Keyword filters" after={list.length ? String(list.length) : undefined}
          footer={list.length ? `Caught ${caught} post${caught === 1 ? '' : 's'} in the last ${STATS_DAYS} days` : 'Hide posts about things you’d rather not see, in every Atlas feed.'}
          onClick={() => pushPage('/keyword-filters/')}>
          <Icon slot="media" ios="f7:text_badge_xmark" md="material:filter_alt" />
        </ListItem>
      </List>

      <BlockTitle>Blocked people</BlockTitle>
      {!user && <Block>Sign in to Atlas and connect Fedizen to manage who you block.</Block>}
      {q.isLoading && <Block>Loading…</Block>}
      {(q.data?.error || q.isError) && <Block>{LIBRARY_PROBLEM[q.data?.error ?? 'unavailable']}</Block>}
      <List strong inset dividers mediaList>
        {people.map(p => <ListItem key={p.id} title={p.name} subtitle={p.handle}>
          {p.avatar ? <img slot="media" src={p.avatar} alt="" width={40} height={40} className="atlas-avatar" style={{ objectFit: 'cover' }} referrerPolicy="no-referrer" />
            : <span slot="media" className="atlas-activity-initial" aria-hidden="true">{p.name.charAt(0)}</span>}
          {canWrite && <Link slot="after" onClick={() => unblock(p.id, p.name)}>Unblock</Link>}
        </ListItem>)}
        {user && !q.isLoading && !q.data?.error && !people.length && <ListItem title="You haven’t blocked anyone." />}
      </List>
      {user && !q.isLoading && !q.data?.error && (canWrite ? <>
        <List strong inset>
          <ListInput label="Block someone" type="text" placeholder="@name@server.social" value={handle} onInput={e => setHandle((e.target as HTMLInputElement).value)} clearButton />
        </List>
        <Block><Button tonal round onClick={block} disabled={!handle.trim() || act.busy}>Block</Button></Block>
      </> : <BlockFooter>{LIBRARY_PROBLEM['needs-permission']}</BlockFooter>)}
      {note && <BlockFooter><span role="alert">{note}</span></BlockFooter>}

      <MutedPeople opened />

      <BlockTitle>Blocked instances</BlockTitle>
      <List strong inset dividers>
        <ListItem link={FEDIZEN_BLOCKED_URL} external target="_blank" title="Manage on Fedizen" footer="Block a whole server: nothing from its people reaches you.">
          <Icon slot="media" ios="f7:globe" md="material:public_off" />
        </ListItem>
      </List>
      <BlockFooter>Fedizen keeps blocked instances; Atlas can’t show or change them yet.</BlockFooter>
    </Page>;
}

/** Phone: muted people, with Unmute and mute-by-handle (desktop's MutedPeople). */
function MutedPeople({ opened }: { opened: boolean }) {
  const m = useMutes(opened);
  const [handle, setHandle] = useState('');
  const mute = async () => { const h = handle.trim().replace(/^@/, ''); if (h && await m.mute({ acct: h, on: true })) setHandle(''); };
  if (!m.signedIn) return null;
  return <>
    <BlockTitle>Muted people</BlockTitle>
    {m.loading && <Block>Loading…</Block>}
    {m.readError && <Block>{m.readError}</Block>}
    <List strong inset dividers mediaList>
      {m.people.map(p => <ListItem key={p.id} title={p.name} subtitle={p.handle}>
        {p.avatar ? <img slot="media" src={p.avatar} alt="" width={40} height={40} className="atlas-avatar" style={{ objectFit: 'cover' }} referrerPolicy="no-referrer" />
          : <span slot="media" className="atlas-activity-initial" aria-hidden="true">{p.name.charAt(0)}</span>}
        <Link slot="after" onClick={() => void m.mute({ accountId: p.id, on: false })}>Unmute</Link>
      </ListItem>)}
      {!m.loading && !m.readError && !m.people.length && <ListItem title="You haven’t muted anyone." />}
    </List>
    {!m.loading && !m.readError && <>
      <List strong inset><ListInput label="Mute someone" type="text" placeholder="@name@server.social" value={handle} onInput={e => setHandle((e.target as HTMLInputElement).value)} clearButton /></List>
      <Block><Button tonal round onClick={() => void mute()} disabled={!handle.trim() || m.busy}>Mute</Button></Block>
    </>}
    <BlockFooter>{m.error ? <span role="alert">{m.error}</span> : 'Their posts leave your feeds. Unlike blocking, they can still follow you and won’t know you muted them.'}</BlockFooter>
  </>;
}
