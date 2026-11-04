import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Bell, Link2, Repeat2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFedizen } from './useFedizen';

const when = (d?: string) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** Desktop: your real Fedizen home timeline and notifications, once you connect read-only access. */
export function FedizenFeed() {
  const f = useFedizen();
  const head = <div className="mb-5 flex items-baseline justify-between"><h2 className="font-serif text-2xl italic">Your Fedizen feed</h2><span className="text-[10px] uppercase text-muted-foreground">Live · read-only</span></div>;
  if (!f.signedIn) return <section className="mb-12">{head}<p className="text-sm text-muted-foreground">Sign in to Atlas to see your Fedizen feed. <Link to="/auth" className="text-accent underline">Sign in</Link></p></section>;
  if (f.loading) return <section className="mb-12">{head}<p className="text-sm text-muted-foreground">Loading your Fedizen feed…</p></section>;
  if (!f.data?.connected || f.data.error === 'expired') return <section className="mb-12 rounded-2xl border border-border p-6">{head}
    <p className="text-sm text-muted-foreground">{f.data?.error === 'expired' ? 'Fedizen ended Atlas’s access. Connect again to keep reading.' : 'Let Atlas read your Fedizen timeline and notifications. Atlas can only read — it can’t post, follow or change anything.'}</p>
    {f.embedded ? <Button asChild className="mt-4"><a href={`${window.location.origin}/following`} target="_blank" rel="noopener noreferrer">Open Atlas in a new tab to connect<ArrowUpRight /></a></Button>
      : <Button className="mt-4" onClick={f.connect}><Link2 />Connect Fedizen</Button>}
    {f.error && <p role="alert" className="mt-3 text-sm text-destructive">{f.error}</p>}
  </section>;
  const { posts, notices, error } = f.data;
  return <section className="mb-12">{head}
    {error && <p className="mb-4 text-sm text-muted-foreground">Fedizen couldn’t send your timeline right now.</p>}
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="space-y-6">{posts.length ? posts.map(p => <article key={p.id} className="border-b border-border pb-5">
        {p.boostedBy && <p className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground"><Repeat2 className="size-3" />{p.boostedBy} boosted</p>}
        <p className="flex items-center gap-2 text-xs">{p.avatar && <img src={p.avatar} alt="" className="size-8 rounded-full object-cover" />}<span><span className="font-semibold">{p.author}</span> <span className="text-muted-foreground">{p.handle} · {when(p.date)}</span></span></p>
        <div className="mt-3 space-y-2 text-sm leading-relaxed">{p.paragraphs.map((t, i) => <p key={i}>{t}</p>)}</div>
        {p.image && <img src={p.image} alt="" loading="lazy" className="mt-3 max-h-80 w-full rounded-2xl object-cover" />}
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Open on Fedizen<ArrowUpRight className="size-3" /></a>
      </article>) : <p className="text-sm text-muted-foreground">Your Fedizen timeline is empty. Follow people on Fedizen and their posts will appear here.</p>}</div>
      <aside><h3 className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><Bell className="size-3" />Activity</h3>
        {notices.length ? <ul className="space-y-3">{notices.map(n => <li key={n.id} className="flex gap-2 text-xs">{n.avatar && <img src={n.avatar} alt="" className="size-6 shrink-0 rounded-full object-cover" />}<span><span className="font-semibold">{n.author}</span> <span className="text-muted-foreground">{n.text}</span></span></li>)}</ul> : <p className="text-xs text-muted-foreground">No new activity.</p>}
        <Button variant="link" size="sm" className="mt-4 px-0 text-xs text-muted-foreground" onClick={f.disconnect}>Disconnect Fedizen</Button>
      </aside>
    </div>
  </section>;
}
