import { useRef, useState } from 'react';
import { Block, BlockFooter, BlockTitle, Icon, Link, List, ListItem, Navbar, Page, Searchbar, Subnavbar, f7 } from 'framework7-react';
import { FEDIZEN_BLOCKED_URL } from '@/lib/fedizen-feed';
import { pushPage } from './navigation';
import { LIBRARY_PROBLEM, useBlockActions, useFedizenBlocks } from '@/components/social/useFedizenLibrary';
import { useMutes } from '@/components/social/useOwnPosts';
import { useAtlasAuth } from '@/components/social/AuthState';
import { useContentFilters } from '@/components/social/useIntelligence';
import { STATS_DAYS, useFilteredCounts } from '@/lib/filter-stats';
import { searchPeople } from '@/lib/people-search';
import { BLOCKLIST_ACCEPT, exportBlocklist, useBlockedServers } from '@/components/social/useBlockedServers';
import type { FedizenPerson } from '@/lib/fedizen-feed';

/**
 * Phone: Settings → Moderation, a pushed page in the same order as desktop's /settings/moderation: keyword filters,
 * blocked people, muted people, blocked servers — separate lists, where Bonfire shows blocked people and instances
 * in one. Blocked and muted people are read and changed here; keyword filters are Atlas's own (their own page, with
 * how many there are and what they caught); so are blocked servers (Atlas's list, since Bonfire v1.1.0-rc.1 has no
 * client API for the ones blocked on Fedizen, which open Fedizen's page).
 */
export function ModerationPage() {
  const { user } = useAtlasAuth();
  const q = useFedizenBlocks(true);
  const m = useMutes(true);
  const filters = useContentFilters();
  const list = filters.data && 'filters' in filters.data ? filters.data.filters : [];
  const counts = useFilteredCounts(user?.id);
  const caught = list.reduce((n, f) => n + (counts.get(f.id) ?? 0), 0);
  const blocked = q.data?.people ?? [];
  const servers = useBlockedServers(true);
  const blockedFooter = !user ? 'Sign in to Atlas and connect Fedizen to manage who you block.'
    : q.data?.error || q.isError ? LIBRARY_PROBLEM[q.data?.error ?? 'unavailable']
    : 'They can’t follow you or see your posts, and you won’t see theirs.';
  return <Page>
      <Navbar title="Moderation" backLink backLinkShowText={false} />

      {/* As in iOS Settings → Blocked Contacts: each list is a row with its count and opens on its own page, so a
          long one never buries the rest. */}
      <List strong inset dividers>
        <ListItem link="#" title="Suggestions" footer="Filters to add or change, and accounts to look at, from your AI model." onClick={() => pushPage('/moderation-suggestions/')}>
          <Icon slot="media" ios="f7:sparkles" md="material:auto_awesome" />
        </ListItem>
        <ListItem link="#" title="Keyword filters" after={list.length ? String(list.length) : undefined}
          footer={list.length ? `Caught ${caught} post${caught === 1 ? '' : 's'} in the last ${STATS_DAYS} days` : 'Hide posts about things you’d rather not see, in every Atlas feed.'}
          onClick={() => pushPage('/keyword-filters/')}>
          <Icon slot="media" ios="f7:text_badge_xmark" md="material:filter_alt" />
        </ListItem>
        <ListItem link={user ? '#' : undefined} title="Blocked people" after={q.isLoading ? '…' : user && !q.data?.error ? String(blocked.length) : undefined}
          footer={blockedFooter} onClick={() => { if (user) pushPage('/blocked-people/'); }}>
          <Icon slot="media" ios="f7:nosign" md="material:block" />
        </ListItem>
        {m.signedIn && <ListItem link={m.connected ? '#' : undefined} title="Muted people" after={m.loading ? '…' : m.readError || !m.connected ? undefined : String(m.people.length)}
          footer={m.readError ?? (m.connected ? 'Their posts leave your feeds. They can still follow you and won’t know.' : LIBRARY_PROBLEM['not-connected'])} onClick={() => { if (m.connected) pushPage('/muted-people/'); }}>
          <Icon slot="media" ios="f7:speaker_slash" md="material:volume_off" />
        </ListItem>}
      </List>

      <BlockTitle>Blocked servers</BlockTitle>
      <List strong inset dividers>
        <ListItem link={user ? '#' : undefined} title="Blocked in Atlas" after={servers.loading ? '…' : user && !servers.readError ? servers.servers.length.toLocaleString() : undefined}
          footer={!user ? 'Sign in to Atlas to block servers.' : servers.readError ?? 'Posts, replies and boosts from these servers are hidden in Atlas. Add one or import a list.'}
          onClick={() => { if (user) pushPage('/blocked-servers/'); }}>
          <Icon slot="media" ios="f7:globe" md="material:public_off" />
        </ListItem>
        <ListItem link={FEDIZEN_BLOCKED_URL} external target="_blank" title="Blocked on Fedizen" footer="Managed on Fedizen.">
          <Icon slot="media" ios="f7:arrow_up_right_square" md="material:open_in_new" />
        </ListItem>
      </List>
      <BlockFooter>Atlas keeps its own list. Fedizen doesn’t know about it, and Atlas can’t read the servers you block on Fedizen.</BlockFooter>
    </Page>;
}

/** A searchable list of accounts with one action each (Unblock, Unmute), and adding someone by handle at the top. */
function PeoplePage({ title, people, loading, problem, empty, addLabel, add, canAdd, action, footer }: {
  title: string; people: FedizenPerson[]; loading: boolean; problem: string | null; empty: string;
  addLabel: string; add: (handle: string) => Promise<boolean>; canAdd: boolean;
  action: (p: FedizenPerson) => React.ReactNode; footer: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const found = searchPeople(people, query);
  // As iOS's "Add New…" row at the top of Blocked Contacts: one tap asks for the handle.
  const ask = () => f7.dialog.prompt('Their handle, like @name@server.social', addLabel, h => { if (h.trim()) void add(h.trim()); });
  return <Page>
    <Navbar title={title} backLink backLinkShowText={false}>
      {people.length > 8 && <Subnavbar inner={false}>
        <Searchbar placeholder={`Search ${people.length}`} disableButton={false} customSearch onSearchbarSearch={(_sb: unknown, v: string) => setQuery(v)} onSearchbarClear={() => setQuery('')} />
      </Subnavbar>}
    </Navbar>
    {loading && <Block>Loading…</Block>}
    {problem && <Block>{problem}</Block>}
    {!loading && !problem && <List strong inset dividers mediaList>
      {canAdd && <ListItem link="#" title={`${addLabel}…`} onClick={ask}><Icon slot="media" ios="f7:plus_circle" md="material:add_circle_outline" /></ListItem>}
      {found.map(p => <ListItem key={p.id} title={p.name} subtitle={p.handle}>
        {p.avatar ? <img slot="media" src={p.avatar} alt="" width={40} height={40} loading="lazy" className="atlas-avatar" style={{ objectFit: 'cover' }} referrerPolicy="no-referrer" />
          : <span slot="media" className="atlas-activity-initial" aria-hidden="true">{p.name.charAt(0)}</span>}
        <span slot="after">{action(p)}</span>
      </ListItem>)}
      {!people.length && <ListItem title={empty} />}
      {people.length > 0 && !found.length && <ListItem title={`No one matches “${query.trim()}”.`} />}
    </List>}
    <BlockFooter>{footer}</BlockFooter>
  </Page>;
}

/** Phone: Settings → Moderation → Blocked people. */
export function BlockedPeoplePage() {
  const q = useFedizenBlocks(true);
  const act = useBlockActions();
  const [note, setNote] = useState<string | null>(null);
  const canWrite = !!q.data?.canWrite;
  const unblock = (id: string, name: string) => f7.dialog.confirm(`Unblock ${name}? They’ll be able to follow you and see your posts again.`, 'Unblock', async () => setNote(await act.unblock(id)));
  return <PeoplePage title="Blocked people" people={q.data?.people ?? []} loading={q.isLoading}
    problem={q.data?.error || q.isError ? LIBRARY_PROBLEM[q.data?.error ?? 'unavailable'] : null}
    empty="You haven’t blocked anyone." addLabel="Block someone" canAdd={canWrite}
    add={async h => { const err = await act.block(h); setNote(err); return !err; }}
    action={p => canWrite ? <Link onClick={() => unblock(p.id, p.name)}>Unblock</Link> : null}
    footer={note ? <span role="alert">{note}</span> : !q.isLoading && !q.data?.error && !canWrite ? LIBRARY_PROBLEM['needs-permission'] : 'They can’t follow you or see your posts, and you won’t see theirs.'} />;
}

/** Phone: Settings → Moderation → Muted people. */
export function MutedPeoplePage() {
  const m = useMutes(true);
  return <PeoplePage title="Muted people" people={m.people} loading={m.loading} problem={m.readError}
    empty="You haven’t muted anyone." addLabel="Mute someone" canAdd={!m.loading && !m.readError}
    add={h => m.mute({ acct: h.replace(/^@/, ''), on: true })}
    action={p => <Link onClick={() => void m.mute({ accountId: p.id, on: false })}>Unmute</Link>}
    footer={m.error ? <span role="alert">{m.error}</span> : 'Their posts leave your feeds. Unlike blocking, they can still follow you and won’t know you muted them.'} />;
}

/** Phone: Settings → Moderation → Blocked in Atlas: the servers the person blocks in Atlas (see BlockedServers). */
export function BlockedServersPage() {
  const b = useBlockedServers(true);
  const [query, setQuery] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const found = q ? b.servers.filter(s => s.includes(q)) : b.servers;
  const ask = () => f7.dialog.prompt('A server’s name, like spam.example', 'Block a server', n => { if (n.trim()) void b.block(n.trim()); });
  const unblock = (s: string) => f7.dialog.confirm(`Unblock ${s}? Its posts will show in Atlas again.`, 'Unblock', () => void b.unblock([s]));
  const unblockAll = () => f7.dialog.confirm(`Unblock all ${b.servers.length.toLocaleString()} servers? Their posts will show in Atlas again.`, 'Unblock all', () => void b.unblock('all'));
  return <Page>
    <Navbar title="Blocked servers" backLink backLinkShowText={false}>
      {b.servers.length > 8 && <Subnavbar inner={false}>
        <Searchbar placeholder={`Search ${b.servers.length.toLocaleString()}`} disableButton={false} customSearch onSearchbarSearch={(_sb: unknown, v: string) => setQuery(v)} onSearchbarClear={() => setQuery('')} />
      </Subnavbar>}
    </Navbar>
    <input ref={file} type="file" accept={BLOCKLIST_ACCEPT} hidden aria-hidden="true" tabIndex={-1}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void b.importFile(f); }} />
    {b.loading && <Block>Loading…</Block>}
    {b.readError && <Block>{b.readError}</Block>}
    {!b.loading && !b.readError && <>
      <List strong inset dividers>
        <ListItem link="#" title="Block a server…" className={b.busy ? 'disabled' : undefined} onClick={ask}><Icon slot="media" ios="f7:plus_circle" md="material:add_circle_outline" /></ListItem>
        <ListItem link="#" title="Import a list…" footer="Mastodon’s CSV, plain text (one server a line) or JSON." className={b.busy ? 'disabled' : undefined} onClick={() => file.current?.click()}><Icon slot="media" ios="f7:square_arrow_down" md="material:file_upload" /></ListItem>
        {b.servers.length > 0 && <ListItem link="#" title="Export the list" footer="As Mastodon’s CSV." onClick={() => exportBlocklist(b.servers)}><Icon slot="media" ios="f7:square_arrow_up" md="material:file_download" /></ListItem>}
      </List>
      {b.note && <Block><span role={b.note.problem ? 'alert' : 'status'}>{b.note.text}</span></Block>}
      <List strong inset dividers>
        {found.map(s => <ListItem key={s} title={s}><span slot="after"><Link onClick={() => unblock(s)}>Unblock</Link></span></ListItem>)}
        {!b.servers.length && <ListItem title="You haven’t blocked any servers in Atlas." />}
        {b.servers.length > 0 && !found.length && <ListItem title={`No server matches “${query.trim()}”.`} />}
      </List>
      {b.servers.length > 0 && <List strong inset><ListItem link="#" title="Unblock all…" className="atlas-destructive" noChevron onClick={unblockAll} /></List>}
    </>}
    <BlockFooter>Atlas hides posts, replies and boosts from these servers. Fedizen doesn’t know about this list.</BlockFooter>
  </Page>;
}
