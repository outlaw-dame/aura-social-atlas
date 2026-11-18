import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { openFediProfile } from '@/lib/fedi-profile';
import { ProfileHoverCard } from './ProfileHoverCard';
import { ArrowUpRight, AtSign, Bell, BarChart3, Heart, Layers3, Link2, PenLine, Quote, RefreshCw, Reply, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFedizen } from './useFedizen';
import { useFollowRequests } from './useOwnPosts';
import { useNotificationGroups } from './useNotificationGroups';
import { groupSentence, type FedizenNotice, type FedizenNoticeGroup } from '@/lib/fedizen-feed';
import { noticeActionLabel, noticeTarget, singleNoticeTarget, type NoticeTarget } from '@/lib/notice-target';
import { openCollection } from '@/lib/collections';

const when = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const kinds: Record<string, { icon: typeof Bell; color: string }> = {
  favourite: { icon: Heart, color: '#e0245e' },
  reblog: { icon: RefreshCw, color: '#17bf63' },
  follow: { icon: UserPlus, color: '#6364ff' },
  follow_request: { icon: UserPlus, color: '#6364ff' },
  mention: { icon: AtSign, color: 'var(--accent)' },
  reply: { icon: Reply, color: 'var(--accent)' },
  quote: { icon: Quote, color: 'var(--accent)' },
  update: { icon: PenLine, color: 'var(--accent)' },
  quoted_update: { icon: PenLine, color: 'var(--accent)' },
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
  return <><FollowRequests /><GroupedActivity fallback={<SingleActivity notices={f.data.notices} note={note} />} /></>;
}

/**
 * Activity grouped as Mastodon 4.3 and Bluesky show it: likes, boosts and follows on the same post in one row
 * ("Ann, Ben and 3 others liked your post") with their faces, and All / Mentions. Falls back to single notifications
 * when Fedizen can't group.
 */
function GroupedActivity({ fallback }: { fallback: React.ReactNode }) {
  const [mentions, setMentions] = useState(false);
  const g = useNotificationGroups(mentions);
  if (g.unsupported && !mentions) return <>{fallback}</>;
  return <section>
    <div role="tablist" aria-label="Show" className="mb-4 inline-flex rounded-full bg-muted p-1 text-sm">
      {([['All', false], ['Mentions', true]] as const).map(([label, on]) => <button key={label} type="button" role="tab" aria-selected={mentions === on}
        className={`rounded-full px-4 py-1.5 ${mentions === on ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMentions(on)}>{label}</button>)}
    </div>
    {g.loading ? <p className="text-sm text-muted-foreground">Loading your activity…</p>
      : g.error ? <p role="alert" className="text-sm text-muted-foreground">{g.error} <Button variant="link" size="sm" className="px-1" onClick={g.refresh}>Try again</Button></p>
      : !g.groups.length ? <p className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">{mentions ? 'No mentions yet.' : 'No activity yet. Follows, mentions, likes and boosts on Fedizen will show up here.'}</p>
      : <ul className="divide-y divide-border">{g.groups.map(x => <GroupRow key={x.key} g={x} />)}</ul>}
    {g.more && <Button variant="outline" className="mt-4 w-full rounded-full" disabled={g.loadingMore} onClick={g.more}>{g.loadingMore ? 'Loading…' : 'Show older'}</Button>}
  </section>;
}

/**
 * A notification row's whole-row target (notice-target.ts), as Mastodon's web app opens a notification: a real link
 * to the conversation (so it opens in a new tab too), or a button for a profile or collection. It covers the row
 * (`after:` inset), under the faces and names, which stay their own buttons. Several people (grouped follows) have no
 * one place to go; their faces are.
 */
function RowTarget({ t, label }: { t: NoticeTarget | null; label: string }) {
  if (!t || t.kind === 'people') return null;
  const cls = 'absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  const name = `${label}. ${noticeActionLabel(t)}`;
  if (t.kind === 'post') return <Link to="/post/$id" params={{ id: t.statusId }} className={cls} aria-label={name} />;
  const go = t.kind === 'profile' ? () => openFediProfile({ actor: t.person.actor, acct: t.person.acct, name: t.person.name }) : () => openCollection(t.link);
  return <button type="button" className={cls} aria-label={name} onClick={go} />;
}
const rowClass = (t: NoticeTarget | null) => `relative -mx-3 flex gap-4 rounded-xl px-3 py-4 ${t && t.kind !== 'people' ? 'transition-colors hover:bg-muted/60' : ''}`;

function GroupRow({ g }: { g: FedizenNoticeGroup }) {
  const k = kinds[g.type] ?? { icon: Bell, color: 'var(--accent)' };
  const s = groupSentence(g);
  const t = noticeTarget(g);
  const first = g.people[0];
  const open = (p: FedizenNoticeGroup['people'][number]) => (p.acct || p.actor ? () => openFediProfile({ actor: p.actor, acct: p.acct, name: p.name }) : undefined);
  return <li className={rowClass(t)}>
    <RowTarget t={t} label={`${s.names} ${s.rest}`} />
    <span className="grid size-10 shrink-0 place-items-center rounded-full text-white" style={{ background: k.color }}><k.icon className="size-5" aria-hidden="true" /></span>
    <div className="pointer-events-none min-w-0 flex-1">
      {g.people.length > 0 && <div className="mb-1.5 flex -space-x-2">{g.people.slice(0, 6).map((p, i) => {
        const face = <span className="block atlas-avatar ring-2 ring-background"><Face avatar={p.avatar} name={p.name} small /></span>;
        const go = open(p);
        return go ? <ProfileHoverCard key={i} target={{ actor: p.actor, acct: p.acct, name: p.name }}><button type="button" className="pointer-events-auto relative" onClick={go} aria-label={`${p.name}. Open their profile`}>{face}</button></ProfileHoverCard> : <span key={i}>{face}</span>;
      })}</div>}
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span>{first && open(first) && g.people.length === 1 ? <button type="button" className="pointer-events-auto relative font-semibold hover:underline" onClick={open(first)}>{s.names}</button> : <span className="font-semibold">{s.names}</span>} <span className="text-muted-foreground">{s.rest}</span></span>
        <span className="shrink-0 text-xs text-muted-foreground">{when(g.date)}</span>
      </p>
      {g.post?.text && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">{g.post.text}</p>}
    </div>
  </li>;
}

/** Single notifications, for a Fedizen that can't group them. */
function SingleActivity({ notices: list, note }: { notices: FedizenNotice[]; note: (c: React.ReactNode) => React.ReactNode }) {
  if (!list.length) return <>{note('No activity yet. Follows, mentions, likes and boosts on Fedizen will show up here.')}</>;
  return <><ul className="divide-y divide-border">{list.map(n => {
    const k = kinds[n.type ?? ''] ?? { icon: Bell, color: 'var(--accent)' };
    const who = n.acct || n.actor ? { actor: n.actor, acct: n.acct, name: n.author } : null;
    const t = singleNoticeTarget(n);
    const face = <span className="relative size-10 shrink-0">
        <Face avatar={n.avatar} name={n.author} />
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full text-white ring-2 ring-background" style={{ background: k.color }}><k.icon className="size-3" aria-hidden="true" /></span>
      </span>;
    return <li key={n.id} className={rowClass(t)}>
      <RowTarget t={t} label={`${n.author} ${n.text}`} />
      {who ? <ProfileHoverCard target={who}><button type="button" className="relative shrink-0 rounded-full" onClick={() => openFediProfile(who)} aria-label={`${n.author}. Open their profile`}>{face}</button></ProfileHoverCard> : face}
      <div className="pointer-events-none min-w-0 flex-1"><p className="flex items-baseline justify-between gap-3 text-sm">{who ? <ProfileHoverCard target={who}><button type="button" className="pointer-events-auto relative font-semibold hover:underline" onClick={() => openFediProfile(who)}>{n.author}</button></ProfileHoverCard> : <span className="font-semibold">{n.author}</span>}<span className="shrink-0 text-xs text-muted-foreground">{when(n.date)}</span></p>
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
function Face({ avatar, name, small }: { avatar?: string; name: string; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const size = small ? 'size-8' : 'size-10';
  return avatar && !broken
    ? <img src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${size} atlas-avatar object-cover`} />
    : <span className={`social-avatar ${size} font-serif ${small ? 'text-sm' : 'text-lg'}`} aria-hidden="true">{name.charAt(0)}</span>;
}
