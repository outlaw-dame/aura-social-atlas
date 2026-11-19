import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { openFediProfile } from '@/lib/fedi-profile';
import { ProfileHoverCard } from './ProfileHoverCard';
import { ArrowUp, ArrowUpRight, AtSign, Bell, BarChart3, ChevronDown, ChevronUp, Heart, Layers3, Link2, PenLine, Quote, RefreshCw, Reply, UserCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFedizen } from './useFedizen';
import { useActivityReadState, useHiddenByFilter, useNewActivityPill, useNotificationGroups } from './useNotificationGroups';
import { useFollowBack } from './useFollowBack';
import { useFollowRequests, useWhoReacted } from './useOwnPosts';
import { FilterPlaceProvider } from './useIntelligence';
import { FeedPostCard, useFeedPostActions, type FeedActions } from './FeedPostCard';
import { groupSentence, noticeLabel, type FediPerson, type FedizenPost, type FedizenNotice, type FedizenNoticeGroup, type NoticeFilter, type NoticePost } from '@/lib/fedizen-feed';
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

const TABS: { id: NoticeFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'replies', label: 'Replies' }, { id: 'follows', label: 'Follows' }, { id: 'following', label: 'People you follow' },
];
const EMPTY: Record<NoticeFilter, string> = {
  all: 'No activity yet. Replies, mentions, follows, likes and boosts on Fedizen will show up here.',
  replies: 'No replies, mentions or quotes yet.',
  follows: 'No new followers yet.',
  following: 'Nothing yet from people you follow.',
};

/**
 * Activity in Bluesky's shape, over Mastodon 4.3's grouped notifications: tabs (All, Replies, Follows, People you
 * follow); replies, mentions and quotes as the whole post with its actions; likes and boosts on one post in one row
 * with your post's picture, expanding to everyone who did it; one person's likes on several posts as one row; Follow
 * back on new followers; unread rows tinted until the next visit, and a "New activity" pill when more arrive. Falls
 * back to single notifications when Fedizen can't group.
 */
function GroupedActivity({ fallback }: { fallback: React.ReactNode }) {
  const [filter, setFilter] = useState<NoticeFilter>('all');
  const g = useNotificationGroups(filter);
  const read = useActivityReadState(g.groups, { visible: true, filter });
  const pill = useNewActivityPill(g.refresh, read.restart);
  const actions = useFeedPostActions();
  if (g.unsupported && filter === 'all') return <>{fallback}</>;
  return <section>
    <div role="tablist" aria-label="Show" className="mb-4 inline-flex max-w-full overflow-x-auto rounded-full bg-muted p-1 text-sm">
      {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={filter === t.id}
        className={`shrink-0 rounded-full px-4 py-1.5 ${filter === t.id ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground'}`} onClick={() => setFilter(t.id)}>{t.label}</button>)}
    </div>
    {pill.fresh && <div className="sticky top-20 z-10 mb-3 flex justify-center"><Button size="sm" className="rounded-full shadow-md" onClick={() => { void pill.show(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><ArrowUp />New activity</Button></div>}
    {actions.error && <p role="alert" className="mb-3 text-sm text-destructive">{actions.error}</p>}
    {g.loading ? <p className="text-sm text-muted-foreground">Loading your activity…</p>
      : g.error ? <p role="alert" className="text-sm text-muted-foreground">{g.error} <Button variant="link" size="sm" className="px-1" onClick={() => void g.refresh()}>Try again</Button></p>
      : !g.groups.length ? <p className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">{EMPTY[filter]}</p>
      : <FilterPlaceProvider place="home"><ul className="divide-y divide-border">{g.groups.map(x => <GroupRow key={x.key} g={x} unread={read.isUnread(x)} actions={actions} />)}</ul></FilterPlaceProvider>}
    {g.more && <Button variant="outline" className="mt-4 w-full rounded-full" disabled={g.loadingMore} onClick={g.more}>{g.loadingMore ? 'Loading…' : 'Show older'}</Button>}
    {actions.dialog}
  </section>;
}

/**
 * A notification row's whole-row target (notice-target.ts), as Mastodon's web app opens a notification: a real link
 * to the conversation (so it opens in a new tab too), or a button for a profile, a collection, or the list a group
 * opens in place. It covers the row (`absolute inset-0`), under the faces, names and buttons, which stay their own.
 */
function RowTarget({ t, label, expanded, onToggle }: { t: NoticeTarget | null; label: string; expanded: boolean; onToggle?: () => void }) {
  if (!t) return null;
  const cls = 'absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
  const name = `${label}. ${expanded ? 'Hide' : noticeActionLabel(t)}`;
  if (onToggle) return <button type="button" className={cls} aria-label={name} aria-expanded={expanded} onClick={onToggle} />;
  if (t.kind === 'post') return <Link to="/post/$id" params={{ id: t.statusId }} className={cls} aria-label={name} />;
  const go = t.kind === 'profile' ? () => openFediProfile({ actor: t.person.actor, acct: t.person.acct, name: t.person.name }) : t.kind === 'collection' ? () => openCollection(t.link) : undefined;
  return go ? <button type="button" className={cls} aria-label={name} onClick={go} /> : null;
}
const rowClass = (unread: boolean) => `relative -mx-3 flex gap-4 rounded-xl px-3 py-4 transition-colors hover:bg-muted/60 ${unread ? 'bg-accent/[0.07]' : ''}`;

function GroupRow({ g, unread, actions }: { g: FedizenNoticeGroup; unread: boolean; actions: FeedActions }) {
  const [open, setOpen] = useState(false);
  const k = kinds[g.type] ?? { icon: Bell, color: 'var(--accent)' };
  const s = groupSentence(g);
  const t = noticeTarget(g);
  const label = `${s.names} ${s.rest}${unread ? ', unread' : ''}`;
  if (g.status) return <NoticePost g={g} post={g.status} unread={unread} actions={actions} />;
  const toggles = t?.kind === 'people' || t?.kind === 'posts';
  const expands = toggles || (g.people.length > 1 && (g.type === 'favourite' || g.type === 'reblog'));
  const single = g.people.length === 1 && (g.type === 'follow' || g.type === 'follow_request') ? g.people[0] : null;
  const open1 = (p: FedizenNoticeGroup['people'][number]) => (p.acct || p.actor ? () => openFediProfile({ actor: p.actor, acct: p.acct, name: p.name }) : undefined);
  return <li className={rowClass(unread)}>
    <RowTarget t={t} label={label} expanded={open} onToggle={toggles ? () => setOpen(o => !o) : undefined} />
    <span className="grid size-10 shrink-0 place-items-center rounded-full text-white" style={{ background: k.color }}><k.icon className="size-5" aria-hidden="true" /></span>
    <div className="pointer-events-none min-w-0 flex-1">
      {g.people.length > 0 && <div className="mb-1.5 flex items-center -space-x-2">{g.people.slice(0, 6).map((p, i) => {
        const face = <span className="block atlas-avatar ring-2 ring-background"><Face avatar={p.avatar} name={p.name} small /></span>;
        const go = open1(p);
        return go ? <ProfileHoverCard key={i} target={{ actor: p.actor, acct: p.acct, name: p.name }}><button type="button" className="pointer-events-auto relative" onClick={go} aria-label={`${p.name}. Open their profile`}>{face}</button></ProfileHoverCard> : <span key={i}>{face}</span>;
      })}
      {toggles && <span aria-hidden="true" className="!ml-2 grid size-8 place-items-center rounded-full text-muted-foreground">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>}
      {expands && !toggles && <button type="button" className="pointer-events-auto relative !ml-2 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-expanded={open} onClick={() => setOpen(o => !o)} aria-label={open ? 'Hide who' : `See everyone who ${g.verb.replace(/ your post$/, ' it')}`}>{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>}</div>}
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span>{first(g) && open1(first(g)!) && g.people.length === 1 ? <button type="button" className="pointer-events-auto relative font-semibold hover:underline" onClick={open1(first(g)!)}>{s.names}</button> : <span className="font-semibold">{s.names}</span>} <span className="text-muted-foreground">{s.rest}</span></span>
        <span className="shrink-0 text-xs text-muted-foreground">{when(g.date)}</span>
      </p>
      {g.post?.text && !g.posts && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">{g.post.text}</p>}
      {g.gone && <p className="mt-1 text-sm italic text-muted-foreground">This post was deleted, or you can no longer see it.</p>}
      {single && <div className="pointer-events-auto relative mt-2"><FollowBack p={single} back={g.type === 'follow'} /></div>}
      {open && <div className="pointer-events-auto relative mt-3">{t?.kind === 'posts' ? <PostList posts={t.posts} /> : <PeopleList g={g} />}</div>}
    </div>
    {g.post?.image && !g.posts && <img src={g.post.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-14 shrink-0 rounded-lg object-cover" />}
  </li>;
}
const first = (g: FedizenNoticeGroup) => g.people[0];

/**
 * A reply, mention, quote or new post: the post itself, to answer, like or boost in place. Filters for Home apply;
 * what one catches is left out, with no notice (Settings → Keyword filters counts it).
 */
function NoticePost({ g, post, unread, actions }: { g: FedizenNoticeGroup; post: FedizenPost; unread: boolean; actions: FeedActions }) {
  const k = kinds[g.type] ?? { icon: Bell, color: 'var(--accent)' };
  if (useHiddenByFilter(post)) return null;
  return <li className={`py-3 ${unread ? '-mx-3 rounded-xl bg-accent/[0.07] px-3' : ''}`}>
    <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="grid size-5 place-items-center rounded-full text-white" style={{ background: k.color }}><k.icon className="size-3" aria-hidden="true" /></span>{noticeLabel(g)}{unread && <span className="sr-only">, unread</span>}</p>
    <FeedPostCard post={post} actions={actions} />
  </li>;
}

function FollowBack({ p, back }: { p: FedizenNoticeGroup['people'][number]; back: boolean }) {
  const f = useFollowBack(p);
  if (!f.can) return null;
  const on = f.state === 'following', asked = f.state === 'requested';
  return <span className="inline-flex items-center gap-2">
    <Button size="sm" variant={on || asked ? 'outline' : 'default'} className="rounded-full" disabled={f.busy} aria-pressed={on} onClick={f.toggle}>{on ? <><UserCheck />Following</> : asked ? 'Requested' : <><UserPlus />{back ? 'Follow back' : 'Follow'}</>}</Button>
    {f.error && <span role="alert" className="text-xs text-muted-foreground">{f.error}</span>}
  </span>;
}

/**
 * Everyone in a group, each with their profile and Follow (back). For likes and boosts the post's own list is read
 * (Mastodon favourited_by / reblogged_by), so it's everyone, not just the few Fedizen's group names.
 */
function PeopleList({ g }: { g: FedizenNoticeGroup }) {
  const kind = g.type === 'favourite' ? 'like' : g.type === 'reblog' ? 'boost' : null;
  const w = useWhoReacted(kind && g.post && g.count > g.people.length ? g.post.id : null, kind ?? 'like');
  const people: (FediPerson & { id?: string })[] = kind && w.people.length ? w.people : g.people;
  return <ul className="space-y-2">
    {people.map((p, i) => <li key={p.acct ?? p.actor ?? i} className="flex items-center gap-3">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={!p.acct && !p.actor} onClick={() => openFediProfile({ actor: p.actor, acct: p.acct, name: p.name })}>
        <Face avatar={p.avatar} name={p.name} small /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.name}</span>{p.acct && <span className="block truncate text-xs text-muted-foreground">@{p.acct}</span>}</span>
      </button>
      {'id' in p && <FollowBack p={p} back={g.type === 'follow'} />}
    </li>)}
    {w.loading && <li className="text-xs text-muted-foreground">Loading everyone…</li>}
    {w.error && <li role="alert" className="text-xs text-muted-foreground">{w.error}</li>}
  </ul>;
}

/** One person's likes or boosts on several of your posts: each post, to open. */
function PostList({ posts }: { posts: NoticePost[] }) {
  return <ul className="space-y-2">{posts.map(p => <li key={p.id}>
    <Link to="/post/$id" params={{ id: p.id }} className="flex items-center gap-3 rounded-lg p-2 text-sm hover:bg-muted">
      <span className="line-clamp-2 min-w-0 flex-1 text-muted-foreground [overflow-wrap:anywhere]">{p.text || 'A post with no text'}</span>
      {p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-md object-cover" />}
    </Link>
  </li>)}</ul>;
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
    return <li key={n.id} className={rowClass(false)}>
      <RowTarget t={t} label={`${n.author} ${n.text}`} expanded={false} />
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
