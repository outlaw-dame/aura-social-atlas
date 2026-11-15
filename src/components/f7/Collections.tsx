import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMyCollections } from '@/components/social/useCollections';
import { useServerFn } from '@tanstack/react-start';
import { Block, BlockFooter, BlockTitle, Button, Icon, Link, List, ListInput, ListItem, Navbar, NavLeft, NavRight, Page, Popup, Segmented, Sheet, Toggle, f7 } from 'framework7-react';
import { useAtlasAuth } from '@/components/social/AuthState';
import { COLLECTIONS_MAX, DESCRIPTION_MAX, ITEMS_MAX, NAME_MAX, collectionInput, type Collection } from '@/lib/collections';
import {
  addToCollection, createCollection, deleteCollection, getCollection, removeFromCollection, updateCollection,
} from '@/lib/collections.functions';

const LANGUAGES: [string, string][] = [['', 'Not set'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文']];

function Avatars({ c }: { c: Collection }) {
  const shown = c.items.slice(0, 4);
  return <span className="atlas-coll-avatars" aria-hidden="true">
    {shown.map(a => a.avatar ? <img key={a.actorUri} src={a.avatar} alt="" referrerPolicy="no-referrer" /> : <span key={a.actorUri}>{a.name.charAt(0)}</span>)}
    {shown.length === 0 && <span><Icon ios="f7:person_2" md="material:group" /></span>}
  </span>;
}

/** A collection in a list: avatars, name, count and topic. */
export function CollectionCard({ c, onOpen }: { c: Collection; onOpen: () => void }) {
  return <button type="button" className="atlas-coll-card" onClick={onOpen} aria-label={`Open collection ${c.name}`}>
    <Avatars c={c} />
    <span className="atlas-coll-card-body">
      <strong>{c.name}</strong>
      <small>{c.itemCount} {c.itemCount === 1 ? 'account' : 'accounts'}{c.tag ? ` · #${c.tag}` : ''}{!c.discoverable ? ' · Unlisted' : ''}{c.sensitive ? ' · Sensitive' : ''}</small>
    </span>
    <Icon ios="f7:chevron_right" md="material:chevron_right" />
  </button>;
}

/** Profile → Collections tab. */
export function MyCollections({ onOpen }: { onOpen: (c: Collection) => void }) {
  const q = useMyCollections();
  const [creating, setCreating] = useState(false);
  const list = q.data?.collections ?? [];
  return <div className="atlas-coll-mine">
    {q.isLoading && <p className="atlas-profile-bio-empty">Loading your collections…</p>}
    {q.data?.error && <p role="alert" className="atlas-profile-bio-empty">{q.data.error}</p>}
    {!q.isLoading && !list.length && !q.data?.error && <div className="atlas-profile-empty">
      <div className="atlas-profile-empty-icon"><Icon ios="f7:square_stack_3d_up" md="material:collections_bookmark" /></div>
      <h2>No collections yet</h2>
      <p>Gather up to {ITEMS_MAX} people worth following around a topic, and share the link.</p>
    </div>}
    {list.map(c => <CollectionCard key={c.id} c={c} onOpen={() => onOpen(c)} />)}
    {list.length < COLLECTIONS_MAX && !q.data?.error && <Button round tonal className="atlas-coll-new" onClick={() => setCreating(true)}>
      <Icon ios="f7:plus" md="material:add" /> New collection
    </Button>}
    <CollectionEditor opened={creating} onClose={() => setCreating(false)} onSaved={id => { setCreating(false); void q.refetch().then(r => { const c = r.data?.collections.find(x => x.id === id); if (c) onOpen(c); }); }} />
  </div>;
}

/** Create or edit a collection's details (accounts are managed on the collection itself, as on Mastodon). */
export function CollectionEditor({ opened, onClose, onSaved, editing }: { opened: boolean; onClose: () => void; onSaved: (id: string) => void; editing?: Collection }) {
  const create = useServerFn(createCollection), update = useServerFn(updateCollection);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [tag, setTag] = useState(''), [language, setLanguage] = useState('');
  const [discoverable, setDiscoverable] = useState(true), [sensitive, setSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setName(editing?.name ?? ''); setDescription(editing?.description ?? ''); setTag(editing?.tag ? `#${editing.tag}` : '');
    setLanguage(editing?.language ?? ''); setDiscoverable(editing?.discoverable ?? true); setSensitive(editing?.sensitive ?? false); setError(null);
  }, [opened, editing]);
  const save = async () => {
    const parsed = collectionInput.safeParse({ name, description, tag, language, discoverable, sensitive });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the details.'); return; }
    setBusy(true); setError(null);
    try {
      if (editing) { await update({ data: { id: editing.id, input: parsed.data } }); onSaved(editing.id); }
      else { const r = await create({ data: parsed.data }); if (r.id) onSaved(r.id); else setError(r.error); }
    } catch { setError('Couldn’t save. Try again.'); } finally { setBusy(false); }
  };
  return <Sheet opened={opened} onSheetClosed={onClose} swipeToClose backdrop className="atlas-coll-editor" style={{ height: 'auto' }}>
    <div className="sheet-modal-swipe-step">
      <BlockTitle large>{editing ? 'Edit collection' : 'New collection'}</BlockTitle>
      <List strong inset dividers>
        <ListInput label="Name" type="text" maxlength={NAME_MAX} value={name} onInput={e => setName(e.target.value)} info={`${name.length}/${NAME_MAX}`} placeholder="Cozy science writers" required />
        <ListInput label="Description" type="textarea" maxlength={DESCRIPTION_MAX} value={description} onInput={e => setDescription(e.target.value)} info={`${description.length}/${DESCRIPTION_MAX}`} placeholder="Optional" />
        <ListInput label="Topic" type="text" value={tag} onInput={e => setTag(e.target.value)} placeholder="#hashtag (optional)" info="One hashtag that describes the collection" />
        <ListInput label="Language" type="select" value={language} onChange={e => setLanguage(e.target.value)}>
          {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </ListInput>
      </List>
      <Block>
        <Segmented strong round>
          <Button active={discoverable} onClick={() => setDiscoverable(true)}>Public</Button>
          <Button active={!discoverable} onClick={() => setDiscoverable(false)}>Unlisted</Button>
        </Segmented>
        <BlockFooter>{discoverable ? 'Shown on your profile. Anyone with the link can open it.' : 'Not shown on your profile. Anyone with the link can open it.'}</BlockFooter>
      </Block>
      <List strong inset>
        <ListItem title="Sensitive" footer="Hides the description and accounts behind a warning">
          <Toggle slot="after" checked={sensitive} onToggleChange={() => setSensitive(v => !v)} />
        </ListItem>
      </List>
      {error && <Block><p role="alert" style={{ color: 'var(--f7-theme-color)', margin: 0 }}>{error}</p></Block>}
      <Block className="atlas-coll-editor-actions">
        <Button round onClick={onClose}>Cancel</Button>
        <Button round fill preloader loading={busy} onClick={save}>{editing ? 'Save' : 'Create'}</Button>
      </Block>
    </div>
  </Sheet>;
}

/**
 * One collection: name, curator, description (behind a warning when sensitive), topic, and its accounts.
 * The curator can add accounts (only ones that have opted in to being featured), remove them, edit and delete.
 */
export function CollectionPopup({ opened, onClose, collection, id, link }: { opened: boolean; onClose: () => void; collection?: Collection | null; id?: string; link?: string }) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const get = useServerFn(getCollection), add = useServerFn(addToCollection), removeItem = useServerFn(removeFromCollection), del = useServerFn(deleteCollection);
  const mine = useMyCollections();
  const wanted = collection?.id ?? id;
  const remote = useQuery({
    queryKey: ['collection', wanted ?? link], enabled: opened && !collection && !!(id || link),
    queryFn: () => get({ data: id ? { id } : { link: link! } }),
  });
  // The owner's live copy (refreshed after every change), whether opened from the profile or a shared link.
  const own = wanted && collection?.source !== 'mastodon' ? mine.data?.collections.find(c => c.id === wanted) : undefined;
  const c = own ?? collection ?? remote.data ?? null;
  const isOwner = !!user && c?.source === 'atlas' && !!mine.data?.collections.some(x => x.id === c.id);
  const [revealed, setRevealed] = useState(false), [handle, setHandle] = useState(''), [adding, setAdding] = useState(false), [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (opened) { setRevealed(false); setHandle(''); setNote(null); } }, [opened, wanted]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['my-collections'] }), qc.invalidateQueries({ queryKey: ['collection'] })]);

  const share = async () => {
    if (!c?.url) return;
    try {
      if (navigator.share) await navigator.share({ title: c.name, url: c.url });
      else { await navigator.clipboard.writeText(c.url); f7.toast.create({ text: 'Link copied', closeTimeout: 1500 }).open(); }
    } catch { /* dismissed */ }
  };
  const addAccount = async () => {
    if (!c || !handle.trim()) return;
    setAdding(true); setNote(null);
    try {
      const r = await add({ data: { id: c.id, handle: handle.trim() } });
      if (r.ok) { setHandle(''); await refresh(); } else setNote(r.message ?? 'Couldn’t add them.');
    } catch { setNote('Couldn’t add them. Try again.'); } finally { setAdding(false); }
  };
  const confirmDelete = () => f7.dialog.confirm(`Delete “${c?.name}”? This can’t be undone.`, 'Delete collection', async () => {
    if (!c) return; await del({ data: { id: c.id } }); await refresh(); onClose();
  });
  const hidden = !!c?.sensitive && !revealed && !isOwner;

  return <>
  <Popup opened={opened} onPopupClosed={onClose} swipeToClose className="atlas-coll-popup">
    <Page>
      <Navbar title="Collection">
        <NavLeft>
          {c?.url && <Link iconOnly onClick={share} aria-label="Share collection"><Icon ios="f7:square_arrow_up" md="material:share" /></Link>}
        </NavLeft>
        <NavRight>
          <Link iconOnly popupClose aria-label="Close"><Icon ios="f7:xmark" md="material:close" /></Link>
        </NavRight>
      </Navbar>
      {!c && (remote.isLoading ? <Block>Loading…</Block> : <Block>This collection couldn’t be opened. It may have been deleted, or its server isn’t reachable.</Block>)}
      {c && <>
        <header className="atlas-coll-head">
          <Avatars c={c} />
          <h1>{c.name}</h1>
          <p className="atlas-coll-by">
            {c.curator.avatar && <img src={c.curator.avatar} alt="" referrerPolicy="no-referrer" />}
            By {c.curator.url ? <Link external target="_blank" href={c.curator.url}>{c.curator.name}</Link> : c.curator.name}
            {c.source === 'mastodon' && c.curator.acct ? <span> · {c.curator.acct}</span> : null}
          </p>
          <p className="atlas-coll-meta">
            {c.itemCount} {c.itemCount === 1 ? 'account' : 'accounts'}
            {c.tag && <> · <a href={`/tags/${encodeURIComponent(c.tag.toLowerCase())}`} className="atlas-tag">#{c.tag}</a></>}
            {!c.discoverable && ' · Unlisted'}
          </p>
          {hidden ? <div className="atlas-coll-cw">
            <p>This collection is marked sensitive.</p>
            <Button small round tonal onClick={() => setRevealed(true)}>Show</Button>
          </div> : c.description && <p className="atlas-coll-desc">{c.description}</p>}
          {isOwner && <div className="atlas-coll-owner-actions">
            <Button small round tonal onClick={() => setEditing(true)}>Edit details</Button>
            <Button small round onClick={confirmDelete} color="red">Delete</Button>
          </div>}
        </header>

        {!hidden && <List strong inset dividers mediaList className="atlas-coll-items">
          {c.items.map(a => <ListItem key={a.actorUri} title={a.name} subtitle={a.acct} link={a.url ?? '#'} external target="_blank" after={a.state === 'pending' ? 'Pending' : undefined}>
            {a.avatar ? <img slot="media" src={a.avatar} alt="" width={44} height={44} referrerPolicy="no-referrer" /> : <span slot="media" className="atlas-activity-initial" aria-hidden="true">{a.name.charAt(0)}</span>}
            {isOwner && <Button slot="after" small round onClick={async (e: { preventDefault: () => void; stopPropagation: () => void }) => { e.preventDefault(); e.stopPropagation(); await removeItem({ data: { id: c.id, actorUri: a.actorUri } }); await refresh(); }} aria-label={`Remove ${a.name}`}>
              <Icon ios="f7:minus_circle" md="material:remove_circle_outline" />
            </Button>}
          </ListItem>)}
          {!c.items.length && <ListItem title={c.itemCount ? 'Open it on its server to see who’s in it' : 'No one here yet'} />}
        </List>}
        {c.source === 'mastodon' && c.url && c.items.length < c.itemCount && <Block><Link external target="_blank" href={c.url}>See the full collection on {new URL(c.url).hostname}</Link></Block>}

        {isOwner && c.items.length < ITEMS_MAX && <>
          <BlockTitle>Add someone</BlockTitle>
          <List strong inset>
            <ListInput type="text" placeholder="@name@server.social" value={handle} onInput={e => setHandle(e.target.value)} clearButton
              info="People can be added only if they’ve opted in to being featured. They can remove themselves at any time." />
          </List>
          <Block>
            <Button fill round preloader loading={adding} onClick={addAccount} disabled={!handle.trim()}>Add to collection</Button>
            {note && <p role="alert" style={{ color: 'var(--f7-theme-color)' }}>{note}</p>}
          </Block>
        </>}
      </>}
    </Page>
  </Popup>
  {/* A sibling of the popup: Framework7 sheets nested inside a popup break its swipe handling. */}
  {isOwner && c && <CollectionEditor opened={editing} editing={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void refresh(); }} />}
  </>;
}
