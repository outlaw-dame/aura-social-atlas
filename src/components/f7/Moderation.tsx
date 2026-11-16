import { useState } from 'react';
import { Block, BlockFooter, BlockTitle, Button, Icon, Link, List, ListInput, ListItem, Navbar, NavRight, Page, Popup, f7 } from 'framework7-react';
import { FEDIZEN_BLOCKED_URL } from '@/lib/fedizen-feed';
import { pushPage } from './navigation';
import { LIBRARY_PROBLEM, useBlockActions, useFedizenBlocks } from '@/components/social/useFedizenLibrary';
import { useAtlasAuth } from '@/components/social/AuthState';

/**
 * Phone: Settings → Moderation. Three separate lists, where Bonfire shows blocked people and instances in one.
 * Blocked people are read and changed here; keyword filters are Atlas's own (a pushed page); blocked instances open
 * Fedizen's page, since Bonfire v1.1.0-rc.1 has no client API for them yet.
 */
export function ModerationPopup({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { user } = useAtlasAuth();
  const q = useFedizenBlocks(opened);
  const act = useBlockActions();
  const [handle, setHandle] = useState(''), [note, setNote] = useState<string | null>(null);
  const people = q.data?.people ?? [];
  const canWrite = !!q.data?.canWrite;
  const unblock = (id: string, name: string) => f7.dialog.confirm(`Unblock ${name}? They’ll be able to follow you and see your posts again.`, 'Unblock', async () => setNote(await act.unblock(id)));
  const block = async () => { const h = handle.trim(); if (!h) return; const err = await act.block(h); setNote(err); if (!err) setHandle(''); };
  return <Popup opened={opened} onPopupClosed={() => { setNote(null); onClose(); }} swipeToClose>
    <Page>
      <Navbar title="Moderation"><NavRight><Link iconOnly popupClose aria-label="Close"><Icon ios="f7:xmark" md="material:close" /></Link></NavRight></Navbar>

      <BlockTitle>Keyword filters</BlockTitle>
      <List strong inset dividers>
        <ListItem link="#" title="Keyword filters" footer="Hide posts about things you’d rather not see." onClick={() => { onClose(); pushPage('/keyword-filters/'); }}>
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

      <BlockTitle>Blocked instances</BlockTitle>
      <List strong inset dividers>
        <ListItem link={FEDIZEN_BLOCKED_URL} external target="_blank" title="Manage on Fedizen" footer="Block a whole server: nothing from its people reaches you.">
          <Icon slot="media" ios="f7:globe" md="material:public_off" />
        </ListItem>
      </List>
      <BlockFooter>Fedizen keeps blocked instances; Atlas can’t show or change them yet.</BlockFooter>
    </Page>
  </Popup>;
}
