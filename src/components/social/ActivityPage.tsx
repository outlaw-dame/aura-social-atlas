import { Link } from '@tanstack/react-router';
import { ArrowUpRight, AtSign, Bell, BarChart3, Heart, Link2, PenLine, Repeat2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFedizen } from './useFedizen';

const when = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const kinds: Record<string, { icon: typeof Bell; color: string }> = {
  favourite: { icon: Heart, color: '#e0245e' },
  reblog: { icon: Repeat2, color: '#17bf63' },
  follow: { icon: UserPlus, color: '#6364ff' },
  follow_request: { icon: UserPlus, color: '#6364ff' },
  mention: { icon: AtSign, color: 'var(--accent)' },
  status: { icon: PenLine, color: 'var(--accent)' },
  poll: { icon: BarChart3, color: 'var(--accent)' },
};

/** Desktop Activity page: the person's real Fedizen notifications, as the phone app's Activity tab. */
export function ActivityPage() {
  const f = useFedizen();
  const note = (children: React.ReactNode) => <div className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">{children}</div>;
  if (!f.signedIn) return note(<>Sign in to Atlas to see who followed, mentioned or boosted you. <Link to="/auth" className="text-accent underline">Sign in</Link></>);
  if (f.loading) return note('Loading your activity…');
  if (f.queryError) return note(<>Atlas couldn’t check your Fedizen connection. <Button variant="link" size="sm" className="px-1" onClick={f.retry}>Try again</Button></>);
  if (!f.data?.connected || f.data.error === 'expired') return note(<>
    <p>{f.data?.error === 'expired' ? 'Fedizen ended Atlas’s access. Connect again to see your activity.' : 'Connect your Fedizen account to see your notifications here, and to join groups and follow people from Atlas.'}</p>
    {f.embedded ? <Button asChild className="mt-4"><a href={`${window.location.origin}/activity`} target="_blank" rel="noopener noreferrer">Open Atlas in a new tab to connect<ArrowUpRight /></a></Button>
      : <Button className="mt-4" onClick={f.connect}><Link2 />Connect Fedizen</Button>}
    {f.error && <p role="alert" className="mt-3 text-destructive">{f.error}</p>}
  </>);
  const list = f.data.notices;
  if (!list.length) return note('No activity yet. Follows, mentions, likes and boosts on Fedizen will show up here.');
  return <ul className="divide-y divide-border">{list.map(n => {
    const k = kinds[n.type ?? ''] ?? { icon: Bell, color: 'var(--accent)' };
    return <li key={n.id} className="flex gap-4 py-4">
      <span className="relative size-10 shrink-0">
        {n.avatar ? <img src={n.avatar} alt="" referrerPolicy="no-referrer" className="size-10 rounded-full object-cover" /> : <span className="social-avatar size-10 font-serif text-lg" aria-hidden="true">{n.author.charAt(0)}</span>}
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full text-white ring-2 ring-background" style={{ background: k.color }}><k.icon className="size-3" aria-hidden="true" /></span>
      </span>
      <div className="min-w-0 flex-1"><p className="flex items-baseline justify-between gap-3 text-sm"><span className="font-semibold">{n.author}</span><span className="shrink-0 text-xs text-muted-foreground">{when(n.date)}</span></p>
        <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">{n.text}</p></div>
    </li>;
  })}</ul>;
}
