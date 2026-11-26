import { useRef, useState } from 'react';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PEOPLE_PREVIEW } from '@/lib/people-search';
import { BLOCKLIST_ACCEPT, exportBlocklist, useBlockedServers } from './useBlockedServers';

/**
 * Settings → Moderation → Blocked servers (desktop): the servers the person blocks in Atlas. Add one by name, import a
 * blocklist file (Mastodon's CSV, plain text or JSON), export the list as Mastodon's CSV, unblock one or all. The
 * list is Atlas's: Fedizen doesn't know about it, and the section says so.
 */
export function BlockedServers() {
  const b = useBlockedServers();
  const [name, setName] = useState(''), [query, setQuery] = useState(''), [all, setAll] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  if (!b.signedIn) return <p className="text-sm text-muted-foreground">Sign in to Atlas to block servers.</p>;
  if (b.loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (b.readError) return <p role="alert" className="text-sm text-muted-foreground">{b.readError}</p>;
  const q = query.trim().toLowerCase();
  const found = q ? b.servers.filter(s => s.includes(q)) : b.servers;
  const long = b.servers.length > PEOPLE_PREVIEW, open = all || !!q;
  const shown = open ? found : found.slice(0, PEOPLE_PREVIEW);
  return <div>
    <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); const n = name.trim(); if (!n) return; const r = await b.block(n); if (r && !r.problem) setName(''); }}>
      <Input className="min-w-0 flex-1 basis-48" value={name} onChange={e => setName(e.target.value)} placeholder="spam.example" aria-label="Block a server by name" autoCapitalize="none" spellCheck={false} />
      <Button type="submit" variant="outline" disabled={!name.trim() || b.busy}><Plus />Block</Button>
      <Button type="button" variant="outline" disabled={b.busy} onClick={() => file.current?.click()}><Upload />Import list…</Button>
      <input ref={file} type="file" accept={BLOCKLIST_ACCEPT} className="hidden" aria-hidden="true" tabIndex={-1}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void b.importFile(f); }} />
    </form>
    {b.note && <p role={b.note.problem ? 'alert' : 'status'} className={`mt-2 text-sm ${b.note.problem ? 'text-destructive' : 'text-muted-foreground'}`}>{b.note.text}</p>}

    {!b.servers.length ? <p className="py-3 text-sm text-muted-foreground">You haven’t blocked any servers in Atlas.</p> : <div className="mt-4">
      {long && <label className="mb-2 flex h-9 items-center gap-2 rounded-full border border-border px-3">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${b.servers.length.toLocaleString()} servers`} aria-label="Search blocked servers" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </label>}
      <ul className={`divide-y divide-border ${open && long ? 'max-h-[28rem] overflow-y-auto overscroll-contain pr-1' : ''}`}>
        {shown.map(s => <li key={s} className="flex items-center gap-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm">{s}</span>
          {confirming === s
            ? <span className="flex gap-1"><Button size="sm" variant="outline" className="rounded-full" disabled={b.busy} onClick={async () => { await b.unblock([s]); setConfirming(null); }}>Unblock</Button><Button size="sm" variant="ghost" className="rounded-full" onClick={() => setConfirming(null)}>Cancel</Button></span>
            : <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setConfirming(s)}>Unblock</Button>}
        </li>)}
        {!found.length && <li className="py-3 text-sm text-muted-foreground" role="status">No server matches “{query.trim()}”.</li>}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {long && !q && <Button variant="link" size="sm" className="h-auto px-0" aria-expanded={all} onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${b.servers.length.toLocaleString()}`}</Button>}
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => exportBlocklist(b.servers)}><Download />Export</Button>
        {confirming === '*'
          ? <span className="flex items-center gap-1 text-sm">Unblock all {b.servers.length.toLocaleString()}?<Button size="sm" variant="outline" className="rounded-full" disabled={b.busy} onClick={async () => { await b.unblock('all'); setConfirming(null); }}>Unblock all</Button><Button size="sm" variant="ghost" className="rounded-full" onClick={() => setConfirming(null)}>Cancel</Button></span>
          : <Button variant="link" size="sm" className="h-auto px-0 text-destructive" onClick={() => setConfirming('*')}>Unblock all…</Button>}
      </div>
    </div>}
  </div>;
}
