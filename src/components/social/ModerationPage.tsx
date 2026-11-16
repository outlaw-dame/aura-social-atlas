import { useState } from 'react';
import { ArrowUpRight, Ban, Globe2, Plus, TextSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FEDIZEN_BLOCKED_URL } from '@/lib/fedizen-feed';
import { KeywordFilters } from './KeywordFilters';
import { LIBRARY_PROBLEM, useBlockActions, useFedizenBlocks } from './useFedizenLibrary';
import { useAtlasAuth } from './AuthState';

/**
 * Settings → Moderation: three separate lists, where Bonfire shows blocked people and instances in one.
 * Blocked people are read and changed here (Mastodon API, which Bonfire v1.1.0-rc.1 serves). Keyword filters are
 * Atlas's own (KeywordFilters): Bonfire lists /api/v2/filters as "coming soon", and its own filters match words without
 * context. Blocked instances have no client API yet, so that list opens Fedizen's page.
 */

function Section({ icon: Icon, title, detail, children }: { icon: typeof Ban; title: string; detail: string; children: React.ReactNode }) {
  return <section className="border-t border-border py-7">
    <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="size-4 text-accent" />{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    <div className="mt-4">{children}</div>
  </section>;
}

const OnFedizen = ({ href, label }: { href: string; label: string }) =>
  <Button asChild variant="outline" className="rounded-full"><a href={href} target="_blank" rel="noopener noreferrer">{label}<ArrowUpRight /></a></Button>;

export function ModerationPage() {
  const { user } = useAtlasAuth();
  const q = useFedizenBlocks();
  const act = useBlockActions();
  const [handle, setHandle] = useState(''), [note, setNote] = useState<string | null>(null), [confirming, setConfirming] = useState<string | null>(null);
  const people = q.data?.people ?? [];
  const canWrite = !!q.data?.canWrite;
  return <div className="mt-6">
    <Section icon={TextSearch} title="Keyword filters" detail="Hide posts about things you’d rather not see, in every Atlas feed.">
      <KeywordFilters />
    </Section>

    <Section icon={Ban} title="Blocked people" detail="They can’t follow you or see your posts, and you won’t see theirs.">
      {!user && <p className="text-sm text-muted-foreground">Sign in to Atlas and connect Fedizen to manage who you block.</p>}
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {(q.data?.error || q.isError) && <p role="alert" className="text-sm text-muted-foreground">{LIBRARY_PROBLEM[q.data?.error ?? 'unavailable']}</p>}
      <ul className="divide-y divide-border">
        {people.map(p => <li key={p.id} className="flex items-center gap-3 py-3">
          {p.avatar ? <img src={p.avatar} alt="" referrerPolicy="no-referrer" className="size-10 atlas-avatar object-cover" /> : <span className="social-avatar size-10 font-serif" aria-hidden="true">{p.name.charAt(0)}</span>}
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.handle}</span></span>
          {canWrite && (confirming === p.id
            ? <span className="flex gap-1"><Button size="sm" variant="outline" className="rounded-full" disabled={act.busy} onClick={async () => { setNote(await act.unblock(p.id)); setConfirming(null); }}>Unblock</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button></span>
            : <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setConfirming(p.id)}>Unblock</Button>)}
        </li>)}
        {user && !q.isLoading && !q.data?.error && !people.length && <li className="py-3 text-sm text-muted-foreground">You haven’t blocked anyone.</li>}
      </ul>
      {user && !q.isLoading && !q.data?.error && (canWrite
        ? <form className="mt-3 flex gap-2" onSubmit={async e => { e.preventDefault(); const h = handle.trim(); if (!h) return; const err = await act.block(h); setNote(err); if (!err) setHandle(''); }}>
            <Input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@name@server.social" aria-label="Block someone by handle" />
            <Button type="submit" variant="outline" disabled={!handle.trim() || act.busy}><Plus />Block</Button>
          </form>
        : <p className="mt-3 text-xs text-muted-foreground">{LIBRARY_PROBLEM['needs-permission']}</p>)}
      {note && <p role="alert" className="mt-2 text-sm text-destructive">{note}</p>}
    </Section>

    <Section icon={Globe2} title="Blocked instances" detail="Block a whole server: nothing from its people reaches you. Fedizen keeps this list; Atlas can’t show or change it yet.">
      <OnFedizen href={FEDIZEN_BLOCKED_URL} label="Manage blocked instances on Fedizen" />
    </Section>
  </div>;
}
