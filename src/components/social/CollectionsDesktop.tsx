import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ChevronRight, Layers3, Minus, Plus, Share2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useAtlasAuth } from './AuthState';
import { useMyCollections } from './useCollections';
import { hashtagLabel, hashtagUrl, TagText } from '@/lib/hashtags';
import { COLLECTIONS_MAX, DESCRIPTION_MAX, ITEMS_MAX, NAME_MAX, OPEN_COLLECTION_EVENT, collectionInput, mastodonCollectionApi, openCollection, type Collection } from '@/lib/collections';
import { addToCollection, createCollection, deleteCollection, getCollection, removeFromCollection, updateCollection } from '@/lib/collections.functions';

/**
 * Desktop Collections, after Mastodon 4.6: curated sets of up to 25 people to follow around a topic. The phone has
 * the same features in f7/Collections.tsx. Collections made in Atlas live in Atlas until Fedizen (Bonfire) supports
 * FEP-7aa9; Mastodon collections are read from their own server.
 */

const LOCAL_NOTE = 'Made in Atlas. Mastodon and Fedizen can’t show it yet: it will federate once Fedizen supports collections.';
const LANGUAGES: [string, string][] = [['', 'Not set'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文']];
const count = (n: number) => `${n} ${n === 1 ? 'account' : 'accounts'}`;

function Avatars({ c, size = 'size-9' }: { c: Collection; size?: string }) {
  const shown = c.items.slice(0, 4);
  return <span className="flex shrink-0 -space-x-3" aria-hidden="true">
    {shown.map(a => a.avatar
      ? <img key={a.actorUri} src={a.avatar} alt="" referrerPolicy="no-referrer" className={`${size} atlas-avatar object-cover ring-2 ring-background`} />
      : <span key={a.actorUri} className={`social-avatar ${size} font-serif ring-2 ring-background`}>{a.name.charAt(0)}</span>)}
    {!shown.length && <span className={`grid ${size} place-items-center rounded-full bg-secondary text-muted-foreground`}><UsersRound className="size-4" /></span>}
  </span>;
}

/** Collection links found in a post: open in Atlas, like Mastodon's tagged_collections. */
export function CollectionLinks({ links }: { links?: string[] }) {
  if (!links?.length) return null;
  return <div className="mt-3 space-y-2">{links.map(link => <button key={link} type="button" onClick={() => openCollection(link)}
    className="flex w-full items-center gap-3 rounded-2xl border border-border px-4 py-3 text-left transition-colors hover:bg-secondary/60">
    <Layers3 className="size-5 shrink-0 text-accent" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Collection</span><span className="block truncate text-xs text-muted-foreground">{new URL(link).hostname}</span></span><ChevronRight className="size-4 text-muted-foreground" />
  </button>)}</div>;
}

/** Profile → Collections tab on desktop. */
export function DesktopCollections({ onOpen }: { onOpen: (c: Collection) => void }) {
  const q = useMyCollections();
  const [creating, setCreating] = useState(false);
  const list = q.data?.collections ?? [];
  return <div className="space-y-3">
    {q.isLoading && <p className="text-sm text-muted-foreground">Loading your collections…</p>}
    {q.data?.error && <p role="alert" className="text-sm text-muted-foreground">{q.data.error}</p>}
    {!q.isLoading && !list.length && !q.data?.error && <div className="py-12 text-center">
      <Layers3 className="mx-auto mb-4 size-8 text-muted-foreground" strokeWidth={1.5} />
      <h3 className="font-serif text-2xl">No collections yet</h3>
      <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">Gather up to {ITEMS_MAX} people worth following around a topic, and share the link.</p>
    </div>}
    {list.map(c => <button key={c.id} type="button" onClick={() => onOpen(c)} aria-label={`Open collection ${c.name}`}
      className="flex w-full items-center gap-4 rounded-2xl border border-border p-4 text-left transition-colors hover:bg-secondary/60">
      <Avatars c={c} />
      <span className="min-w-0 flex-1"><span className="block font-semibold [overflow-wrap:anywhere]">{c.name}</span>
        <span className="block text-xs text-muted-foreground">{count(c.itemCount)}{c.tag ? ` · #${c.tag}` : ''}{!c.discoverable ? ' · Unlisted' : ''}{c.sensitive ? ' · Sensitive' : ''}</span></span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>)}
    {list.length < COLLECTIONS_MAX && !q.data?.error && !q.isLoading && <Button variant="outline" className="rounded-full" onClick={() => setCreating(true)}><Plus />New collection</Button>}
    <CollectionEditorDialog open={creating} onClose={() => setCreating(false)} onSaved={id => { setCreating(false); void q.refetch().then(r => { const c = r.data?.collections.find(x => x.id === id); if (c) onOpen(c); }); }} />
  </div>;
}

/** Create or edit a collection's details. People are added on the collection itself, as on Mastodon. */
function CollectionEditorDialog({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: (id: string) => void; editing?: Collection }) {
  const { user } = useAtlasAuth();
  const create = useServerFn(createCollection), update = useServerFn(updateCollection);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [tag, setTag] = useState(''), [language, setLanguage] = useState('');
  const [discoverable, setDiscoverable] = useState(true), [sensitive, setSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? ''); setDescription(editing?.description ?? ''); setTag(editing?.tag ? `#${editing.tag}` : '');
    setLanguage(editing?.language ?? ''); setDiscoverable(editing?.discoverable ?? true); setSensitive(editing?.sensitive ?? false); setError(null);
  }, [open, editing]);
  const save = async () => {
    const parsed = collectionInput.safeParse({ name, description, tag, language, discoverable, sensitive });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the details.'); return; }
    if (!user) { setError('Sign in to save collections.'); return; }
    setBusy(true); setError(null);
    try {
      if (editing) { await update({ data: { id: editing.id, input: parsed.data, expectedAtlasUserId: user.id } }); onSaved(editing.id); }
      else { const r = await create({ data: { input: parsed.data, expectedAtlasUserId: user.id } }); if (r.id) onSaved(r.id); else setError(r.error); }
    } catch { setError('Couldn’t save. Try again.'); } finally { setBusy(false); }
  };
  const label = 'mb-1 block text-xs font-medium';
  return <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="max-w-md rounded-3xl">
      <DialogHeader><DialogTitle className="font-serif text-2xl font-normal">{editing ? 'Edit collection' : 'New collection'}</DialogTitle>
        <DialogDescription>Collections made in Atlas don’t reach Mastodon or Fedizen yet.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div><label className={label} htmlFor="coll-name">Name <span className="text-muted-foreground">{name.length}/{NAME_MAX}</span></label><Input id="coll-name" maxLength={NAME_MAX} value={name} onChange={e => setName(e.target.value)} placeholder="Cozy science writers" /></div>
        <div><label className={label} htmlFor="coll-desc">Description <span className="text-muted-foreground">{description.length}/{DESCRIPTION_MAX}</span></label><Textarea id="coll-desc" maxLength={DESCRIPTION_MAX} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" className="min-h-20" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label} htmlFor="coll-tag">Topic</label><Input id="coll-tag" value={tag} onChange={e => setTag(e.target.value)} placeholder="#hashtag" /></div>
          <div><label className={label} htmlFor="coll-lang">Language</label><select id="coll-lang" value={language} onChange={e => setLanguage(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        <label className="flex items-start justify-between gap-4 text-sm"><span><span className="font-medium">Show on my profile</span><span className="block text-xs text-muted-foreground">{discoverable ? 'Public: on your profile; anyone with the link can open it.' : 'Unlisted: not on your profile; anyone with the link can open it.'}</span></span><Switch checked={discoverable} onCheckedChange={setDiscoverable} /></label>
        <label className="flex items-start justify-between gap-4 text-sm"><span><span className="font-medium">Sensitive</span><span className="block text-xs text-muted-foreground">Hides the description and accounts behind a warning.</span></span><Switch checked={sensitive} onCheckedChange={setSensitive} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save' : 'Create'}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}

/**
 * One collection: curator, description (behind a warning when sensitive), topic and accounts. The curator adds people
 * who have opted in to being featured, removes them, edits and deletes. Opened from the profile, a shared link or a post.
 */
export function CollectionDialog({ target, onClose }: { target: { collection?: Collection; link?: string } | null; onClose: () => void }) {
  const { user } = useAtlasAuth();
  const qc = useQueryClient();
  const get = useServerFn(getCollection), add = useServerFn(addToCollection), removeItem = useServerFn(removeFromCollection), del = useServerFn(deleteCollection);
  const mine = useMyCollections();
  const link = target?.link;
  const remote = useQuery({ queryKey: ['collection', link], enabled: !!link && !target?.collection, queryFn: () => get({ data: { link: link! } }) });
  const wanted = target?.collection?.id;
  const own = wanted && target?.collection?.source === 'atlas' ? mine.data?.collections.find(c => c.id === wanted) : undefined;
  const c = own ?? target?.collection ?? remote.data ?? null;
  const isOwner = !!user && c?.source === 'atlas' && !!mine.data?.collections.some(x => x.id === c.id);
  const [revealed, setRevealed] = useState(false), [handle, setHandle] = useState(''), [adding, setAdding] = useState(false), [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false), [confirming, setConfirming] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => { setRevealed(false); setHandle(''); setNote(null); setConfirming(false); setCopied(false); }, [wanted, link]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['my-collections'] }), qc.invalidateQueries({ queryKey: ['collection'] })]);
  const share = async () => {
    if (!c?.url) return;
    try { if (navigator.share) await navigator.share({ title: c.name, url: c.url }); else { await navigator.clipboard.writeText(c.url); setCopied(true); } } catch { /* dismissed */ }
  };
  const addAccount = async () => {
    if (!c || !handle.trim() || !user) return;
    setAdding(true); setNote(null);
    try { const r = await add({ data: { id: c.id, handle: handle.trim(), expectedAtlasUserId: user.id } }); if (r.ok) { setHandle(''); await refresh(); } else setNote(r.message ?? 'Couldn’t add them.'); }
    catch { setNote('Couldn’t add them. Try again.'); } finally { setAdding(false); }
  };
  const hidden = !!c?.sensitive && !revealed && !isOwner;

  return <>
    <Dialog open={!!target && !editing} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl">
        {!c ? <DialogHeader><DialogTitle className="font-serif text-2xl font-normal">Collection</DialogTitle>
          <DialogDescription>{remote.isLoading ? 'Loading…' : 'This collection couldn’t be opened. It may have been deleted, or its server isn’t reachable.'}</DialogDescription></DialogHeader>
        : <>
          <DialogHeader>
            <Avatars c={c} size="size-11" />
            <DialogTitle className="pt-2 font-serif text-3xl font-normal [overflow-wrap:anywhere]">{c.name}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-1">
              By {c.curator.url ? <a className="underline" href={c.curator.url} target="_blank" rel="noopener noreferrer">{c.curator.name}</a> : c.curator.name}
              {c.source === 'mastodon' && c.curator.acct ? <span>· {c.curator.acct}</span> : null}
              <span>· {count(c.itemCount)}</span>{c.tag && <span>· <a className="atlas-tag atlas-hashtag" href={hashtagUrl(c.tag.toLowerCase())} aria-label={hashtagLabel(c.tag)}><TagText tag={c.tag} /></a></span>}{!c.discoverable && <span>· Unlisted</span>}
            </DialogDescription>
          </DialogHeader>
          {c.source === 'atlas' && <p className="text-xs text-muted-foreground">{LOCAL_NOTE}</p>}
          {hidden ? <div className="rounded-2xl bg-secondary p-4 text-sm"><p>This collection is marked sensitive.</p><Button size="sm" variant="outline" className="mt-3 rounded-full" onClick={() => setRevealed(true)}>Show</Button></div>
            : c.description && <p className="text-sm leading-relaxed">{c.description}</p>}
          <div className="flex flex-wrap gap-2">
            {c.url && <Button size="sm" variant="outline" className="rounded-full" onClick={share}><Share2 />{copied ? 'Link copied' : 'Share'}</Button>}
            {isOwner && <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditing(true)}>Edit details</Button>}
            {isOwner && (confirming
              ? <><Button size="sm" variant="destructive" className="rounded-full" onClick={async () => { if (!user) return; await del({ data: { id: c.id, expectedAtlasUserId: user.id } }); await refresh(); onClose(); }}>Delete for good</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep it</Button></>
              : <Button size="sm" variant="ghost" className="rounded-full text-destructive" onClick={() => setConfirming(true)}>Delete</Button>)}
          </div>
          {!hidden && <ul className="divide-y divide-border">
            {c.items.map(a => <li key={a.actorUri} className="flex items-center gap-3 py-3">
              {a.avatar ? <img src={a.avatar} alt="" referrerPolicy="no-referrer" className="size-10 atlas-avatar object-cover" /> : <span className="social-avatar size-10 font-serif" aria-hidden="true">{a.name.charAt(0)}</span>}
              <a href={a.url ?? '#'} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.name}</span><span className="block truncate text-xs text-muted-foreground">{a.acct}{a.state === 'pending' ? ' · Pending' : ''}</span></a>
              {isOwner && <Button size="icon" variant="ghost" aria-label={`Remove ${a.name}`} onClick={async () => { if (!user) return; await removeItem({ data: { id: c.id, actorUri: a.actorUri, expectedAtlasUserId: user.id } }); await refresh(); }}><Minus /></Button>}
            </li>)}
            {!c.items.length && <li className="py-3 text-sm text-muted-foreground">{c.itemCount ? 'Open it on its server to see who’s in it.' : 'No one here yet.'}</li>}
          </ul>}
          {c.source === 'mastodon' && c.url && c.items.length < c.itemCount && <a className="text-sm underline" href={c.url} target="_blank" rel="noopener noreferrer">See the full collection on {new URL(c.url).hostname}</a>}
          {isOwner && c.items.length < ITEMS_MAX && <div className="space-y-2 border-t border-border pt-4">
            <label htmlFor="coll-add" className="block text-xs font-medium">Add someone</label>
            <div className="flex gap-2"><Input id="coll-add" value={handle} onChange={e => setHandle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addAccount(); }} placeholder="@name@server.social" /><Button onClick={addAccount} disabled={!handle.trim() || adding}>{adding ? 'Adding…' : 'Add'}</Button></div>
            <p className="text-xs text-muted-foreground">People can be added only if they’ve opted in to being featured. They can remove themselves at any time.</p>
            {note && <p role="alert" className="text-sm text-destructive">{note}</p>}
          </div>}
        </>}
      </DialogContent>
    </Dialog>
    {isOwner && c && <CollectionEditorDialog open={editing} editing={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void refresh(); }} />}
  </>;
}

/** Desktop shell: opens collections linked anywhere in the app (posts, ?collection= links). */
export function useCollectionOpener() {
  const [target, setTarget] = useState<{ collection?: Collection; link?: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const link = (e as CustomEvent<{ link?: string }>).detail?.link; if (link) setTarget({ link }); };
    window.addEventListener(OPEN_COLLECTION_EVENT, on);
    const v = new URLSearchParams(window.location.search).get('collection');
    if (v && mastodonCollectionApi(v)) setTarget({ link: v });
    return () => window.removeEventListener(OPEN_COLLECTION_EVENT, on);
  }, []);
  return { target, open: (collection: Collection) => setTarget({ collection }), close: () => setTarget(null) };
}
