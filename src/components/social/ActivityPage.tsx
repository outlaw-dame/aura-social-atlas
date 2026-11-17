import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { openFediProfile } from '@/lib/fedi-profile';
import { ProfileHoverCard } from './ProfileHoverCard';
import { ArrowUpRight, AtSign, Bell, BarChart3, Heart, Layers3, Link2, PenLine, RefreshCw, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFedizen } from './useFedizen';
import { useFollowRequests } from './useOwnPosts';

const when = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const kinds: Record<string, { icon: typeof Bell; color: string }> = {
  favourite: { icon: Heart, color: '#e0245e' },
  reblog: { icon: RefreshCw, color: '#17bf63' },
  follow: { icon: UserPlus, color: '#6364ff' },
  follow_request: { icon: UserPlus, color: '#6364ff' },
  mention: { icon: AtSign, color: 'var(--accent)' },
  status: { icon: PenLine, color: 'var(--accent)' },
  poll: { icon: BarChart3, color: 'var(--accent)' },
  // Mastodon 4.6 collections: someone featured you, or changed a collection you're in.
  added_to_collection: { icon: Layers3, color: 'var(--accent)' },
  collection_update: { icon: Layers3, color: 'var(--accent)' },
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
  if (!list.length) return <><FollowRequests />{note('No activity yet. Follows, mentions, likes and boosts on Fedizen will show up here.')}</>;
  return <><FollowRequests /><ul className="divide-y divide-border">{list.map(n => {
    const k = kinds[n.type ?? ''] ?? { icon: Bell, color: 'var(--accent)' };
    const who = n.acct || n.actor ? { actor: n.actor, acct: n.acct, name: n.author } : null;
    const face = <span className="relative size-10 shrink-0">
        <Face avatar={n.avatar} name={n.author} />
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full text-white ring-2 ring-background" style={{ background: k.color }}><k.icon className="size-3" aria-hidden="true" /></span>
      </span>;
    return <li key={n.id} className="flex gap-4 py-4">
      {who ? <ProfileHoverCard target={who}><button type="button" className="shrink-0 rounded-full" onClick={() => openFediProfile(who)} aria-label={`${n.author}. Open their profile`}>{face}</button></ProfileHoverCard> : face}
      <div className="min-w-0 flex-1"><p className="flex items-baseline justify-between gap-3 text-sm">{who ? <ProfileHoverCard target={who}><button type="button" className="font-semibold hover:underline" onClick={() => openFediProfile(who)}>{n.author}</button></ProfileHoverCard> : <span className="font-semibold">{n.author}</span>}<span className="shrink-0 text-xs text-muted-foreground">{when(n.date)}</span></p>
        <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">{n.text}</p></div>
    </li>;
  })}</ul></>;
}

/**
 * People asking to follow you, with Accept and Decline, at the top of Activity as Mastodon lists follow requests. Only
 * shown while there are some (an account that approves followers gets them).
 */
function FollowRequests() {
  const r = useFollowRequests();
  if (!r.people.length && !r.readError) return null;
  return <section aria-labelledby="follow-requests" className="mb-6 rounded-2xl border border-border p-4">
    <h2 id="follow-requests" className="mb-3 text-sm font-semibold">Follow requests <span className="text-muted-foreground">{r.people.length || ''}</span></h2>
    {r.readError && <p role="alert" className="text-sm text-muted-foreground">{r.readError}</p>}
    <ul className="space-y-3">{r.people.map(p => {
      const who = { actor: p.actor, acct: p.acct, name: p.name };
      return <li key={p.id} className="flex items-center gap-3">
        <ProfileHoverCard target={who}><button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => openFediProfile(who)} aria-label={`${p.name} ${p.handle}. Open their profile`}>
          <Face avatar={p.avatar} name={p.name} />
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.handle}</span></span>
        </button></ProfileHoverCard>
        <Button size="sm" disabled={r.busyId === p.id} onClick={() => r.answer(p.id, true)}>Accept</Button>
        <Button size="sm" variant="outline" disabled={r.busyId === p.id} onClick={() => r.answer(p.id, false)}>Decline</Button>
      </li>;
    })}</ul>
    {r.error && <p role="alert" className="mt-2 text-sm text-destructive">{r.error}</p>}
  </section>;
}

/** An avatar, or the initial when there's none or it won't load. */
function Face({ avatar, name }: { avatar?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  return avatar && !broken
    ? <img src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-10 atlas-avatar object-cover" />
    : <span className="social-avatar size-10 font-serif text-lg" aria-hidden="true">{name.charAt(0)}</span>;
}
