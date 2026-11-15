import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Link2, MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFedizen, useFedizenMessages } from './useFedizen';

const when = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

/** Desktop Messages: the person's direct conversations on Fedizen (Bonfire serves Mastodon's conversations API). */
export function MessagesPage() {
  const f = useFedizen();
  const m = useFedizenMessages(!!f.data?.connected);
  const note = (children: React.ReactNode) => <div className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">{children}</div>;
  if (!f.signedIn) return note(<>Sign in to Atlas to read your direct messages. <Link to="/auth" className="text-accent underline">Sign in</Link></>);
  if (f.loading || m.loading) return note('Loading your messages…');
  if (f.queryError || m.queryError) return note(<>Atlas couldn’t load your messages. <Button variant="link" size="sm" className="px-1" onClick={() => { f.retry(); m.retry(); }}>Try again</Button></>);
  if (!f.data?.connected || f.data.error === 'expired' || m.data?.error === 'expired') return note(<>
    <p>{f.data?.connected ? 'Fedizen ended Atlas’s access. Connect again to read your messages.' : 'Connect your Fedizen account to read your direct messages here.'}</p>
    {f.embedded ? <Button asChild className="mt-4"><a href={`${window.location.origin}/messages`} target="_blank" rel="noopener noreferrer">Open Atlas in a new tab to connect<ArrowUpRight /></a></Button>
      : <Button className="mt-4" onClick={f.connect}><Link2 />Connect Fedizen</Button>}
    {f.error && <p role="alert" className="mt-3 text-destructive">{f.error}</p>}
  </>);
  if (m.data?.error) return note(<>Fedizen couldn’t send your messages right now. <Button variant="link" size="sm" className="px-1" onClick={m.retry}>Try again</Button></>);
  const list = m.data?.conversations ?? [];
  if (!list.length) return note(<span className="flex items-center gap-3"><MessagesSquare className="size-5 shrink-0" />No messages yet. Direct messages with people on Fedizen and across the fediverse show up here.</span>);
  return <ul className="divide-y divide-border">{list.map(c => {
    const who = c.people[0];
    const names = c.people.map(p => p.name).join(', ') || 'Just you';
    const row = <>
      <span className="relative size-11 shrink-0">
        {who?.avatar ? <img src={who.avatar} alt="" referrerPolicy="no-referrer" className="size-11 atlas-avatar object-cover" /> : <span className="social-avatar size-11 font-serif text-lg" aria-hidden="true">{names.charAt(0)}</span>}
        {c.unread && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-accent ring-2 ring-background" aria-label="Unread" />}
      </span>
      <div className="min-w-0 flex-1"><p className="flex items-baseline justify-between gap-3 text-sm"><span className={`truncate ${c.unread ? 'font-semibold' : 'font-medium'}`}>{names}</span><span className="shrink-0 text-xs text-muted-foreground">{when(c.date)}</span></p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{c.text || 'No text'}</p></div>
    </>;
    return <li key={c.id}>{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex gap-4 py-4">{row}</a> : <div className="flex gap-4 py-4">{row}</div>}</li>;
  })}</ul>;
}
