import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, Copy, Hash, Lock, Megaphone, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGroup, useGroupMembership, useGroups } from './useGroups';
import { groupAccessLabel, groupHandle, membershipLabel, type Group, type GroupPost } from '@/lib/groups';

const when = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const members = (n?: number) => (n == null ? null : `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`);

/** Groups are rounded squares, people are circles. */
function GroupAvatar({ g, className = 'size-12' }: { g: Group; className?: string }) {
  return g.avatar
    ? <img src={g.avatar} alt="" referrerPolicy="no-referrer" className={`${className} shrink-0 rounded-[26%] bg-secondary object-cover`} />
    : <span aria-hidden="true" className={`${className} social-avatar shrink-0 !rounded-[26%] font-serif text-xl`}>{g.name.charAt(0)}</span>;
}

function Access({ g }: { g: Group }) {
  const Icon = g.announcements ? Megaphone : g.membersOnlyContent ? Lock : Users;
  return <span className="inline-flex items-center gap-1"><Icon className="size-3" aria-hidden="true" />{groupAccessLabel(g)}</span>;
}

function Post({ p, showGroup }: { p: GroupPost; showGroup?: boolean }) {
  return <article className="border-b border-border py-5">
    <p className="flex items-center gap-2 text-xs">
      {p.avatar ? <img src={p.avatar} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full object-cover" /> : <span aria-hidden="true" className="social-avatar size-8 font-serif">{p.author.charAt(0)}</span>}
      <span className="min-w-0"><span className="font-semibold">{p.author}</span>{showGroup && p.group && <span className="text-muted-foreground"> in {p.group}</span>}
        <span className="block truncate text-muted-foreground">{p.handle}{p.date ? ` · ${when(p.date)}` : ''}</span></span>
    </p>
    <div className="mt-3 space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]">{p.paragraphs.slice(0, 6).map((t, i) => <p key={i}>{t}</p>)}</div>
    {p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-3 max-h-80 w-full rounded-2xl object-cover" />}
    <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Open on Fedizen<ArrowUpRight className="size-3" /></a>
  </article>;
}

/** Join / leave (follow, for an announcement channel) as you, on Fedizen. Leaving asks first. */
function MembershipButton({ g }: { g: Group }) {
  const m = useGroupMembership(g);
  const [confirming, setConfirming] = useState(false);
  const label = membershipLabel(g, m.state);
  const inGroup = m.state === 'member' || m.state === 'requested';
  const onClick = () => {
    if (m.state === 'signed-out') { window.location.assign('/auth'); return; }
    if (m.state === 'not-connected' || m.state === 'needs-permission' || m.state === 'expired') { void m.connect(); return; }
    if (inGroup) setConfirming(true); else m.join();
  };
  const disabled = m.busy || m.state === 'loading' || (m.state === 'none' && g.joinMode === 'invite' && !g.announcements);
  return <div className="mb-1 flex flex-col items-end gap-1">
    <div className="flex items-center gap-2">
      {confirming ? <>
        <span className="text-xs text-muted-foreground">{m.state === 'requested' ? 'Cancel your request?' : g.announcements ? 'Unfollow?' : 'Leave this group?'}</span>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => setConfirming(false)}>Keep</Button>
        <Button variant="destructive" size="sm" className="rounded-full" onClick={() => { setConfirming(false); m.leave(); }}>{m.state === 'requested' ? 'Cancel request' : g.announcements ? 'Unfollow' : 'Leave'}</Button>
      </> : <>
        <Button variant={inGroup ? 'outline' : 'default'} className="rounded-full" disabled={disabled} onClick={onClick}>{inGroup && <Check />}{m.busy ? '…' : label}</Button>
        <Button asChild variant="ghost" size="icon" className="rounded-full" title="Open on Fedizen"><a href={g.url} target="_blank" rel="noopener noreferrer" aria-label="Open on Fedizen"><ArrowUpRight /></a></Button>
      </>}
    </div>
    {m.error && <p role="alert" className="text-xs text-destructive">{m.error}</p>}
    {m.state === 'needs-permission' && !m.error && <p className="text-xs text-muted-foreground">Atlas needs your OK to join groups for you.</p>}
  </div>;
}

const note = (children: React.ReactNode) => <div className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">{children}</div>;

function Directory() {
  const q = useGroups();
  if (q.isLoading) return note('Loading groups from Fedizen…');
  if (q.isError || q.data?.error) return note(<>Fedizen couldn’t be reached right now. <Button variant="link" size="sm" className="px-1" onClick={() => q.refetch()}>Try again</Button></>);
  const groups = (q.data?.groups ?? []).filter(g => g.type === 'group');
  if (!groups.length) return <div className="py-16 text-center"><Users className="mx-auto mb-4 size-8 text-muted-foreground" strokeWidth={1.5} /><h2 className="font-serif text-2xl">No groups yet.</h2><p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground">Groups on Fedizen, and those it follows on Lemmy, Mbin and other servers, will appear here.</p></div>;
  return <>
    <ul className="grid gap-3 sm:grid-cols-2">
      {groups.map(g => <li key={g.id}>
        <Link to="/groups" search={{ group: g.id }} className="flex h-full gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <GroupAvatar g={g} />
          <span className="min-w-0">
            <span className="block font-semibold [overflow-wrap:anywhere]">{g.name}</span>
            <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">{members(g.members) && <span>{members(g.members)}</span>}<Access g={g} />{g.host !== 'fedizen.net' && <span>{g.host}</span>}</span>
            {g.summary[0] && <span className="mt-2 line-clamp-2 block text-sm text-muted-foreground">{g.summary[0]}</span>}
          </span>
        </Link>
      </li>)}
    </ul>
    <p className="mt-3 text-xs text-muted-foreground">Groups federate across the fediverse, so communities from Lemmy, Mbin and Mobilizon that Fedizen follows show up here too.</p>
    {q.data?.latestError && <section className="mt-12"><h2 className="mb-2 font-serif text-2xl italic">Latest in groups</h2><p className="text-sm text-muted-foreground">Recent posts couldn’t be loaded. <Button variant="link" size="sm" className="px-1" onClick={() => q.refetch()}>Try again</Button></p></section>}
    {!!q.data?.latest.length && <section className="mt-12"><h2 className="mb-2 font-serif text-2xl italic">Latest in groups</h2>{q.data.latest.slice(0, 15).map(p => <Post key={p.id} p={p} showGroup />)}</section>}
  </>;
}

function Detail({ id }: { id: string }) {
  const q = useGroup(id);
  const back = <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground"><Link to="/groups"><ArrowLeft />All groups</Link></Button>;
  if (q.isLoading) return <>{back}{note('Loading group…')}</>;
  if (!q.data || !q.data.group) return <>{back}{note(q.data?.error === 'not-found' ? 'This group can’t be opened. It may be private or archived.' : 'Fedizen couldn’t be reached right now.')}</>;
  const { group: g, topics, posts } = q.data;
  const handle = groupHandle(g);
  return <div className="animate-float-up">
    {back}
    <div className="h-36 rounded-3xl bg-cover bg-center sm:h-44" aria-hidden="true"
      style={g.banner ? { backgroundImage: `url("${encodeURI(g.banner)}")` } : { background: 'linear-gradient(135deg, color-mix(in oklab, var(--accent) 26%, var(--card)), color-mix(in oklab, var(--accent) 6%, var(--card)))' }} />
    <header className="px-2 sm:px-6">
      <div className="-mt-10 flex items-end justify-between gap-4">
        <GroupAvatar g={g} className="size-20 border-4 border-background" />
        <MembershipButton g={g} />
      </div>
      <h1 className="mt-3 font-serif text-4xl leading-tight [overflow-wrap:anywhere]">{g.name}</h1>
      {handle && <button type="button" title="Copy the address" onClick={() => { void navigator.clipboard?.writeText(handle).catch(() => undefined); }} className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground [overflow-wrap:anywhere] hover:text-foreground">{handle}<Copy className="size-3" aria-hidden="true" /></button>}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">{members(g.members) && <span>{members(g.members)}</span>}<Access g={g} />{g.host !== 'fedizen.net' && <span>Hosted on {g.host}</span>}</p>
      {g.summary.length > 0 && <div className="mt-4 max-w-2xl space-y-2 text-sm leading-relaxed">{g.summary.map((t, i) => <p key={i}>{t}</p>)}</div>}
      {!!topics.length && <div className="mt-5 flex flex-wrap gap-2" aria-label="Topics">{topics.map(t => <Button key={t.id} asChild variant="outline" size="sm" className="rounded-full"><Link to="/groups" search={{ group: t.id }}><Hash className="size-3" />{t.name}</Link></Button>)}</div>}
    </header>
    <section className="mt-10"><h2 className="mb-2 font-serif text-2xl italic">Latest posts</h2>
      {g.membersOnlyContent && <p className="mb-4 text-sm text-muted-foreground">Posts here are for members. Join to read them.</p>}
      {q.data.postsError ? <p className="text-sm text-muted-foreground">Posts couldn’t be loaded. <Button variant="link" size="sm" className="px-1" onClick={() => q.refetch()}>Try again</Button></p>
        : posts.length ? posts.map(p => <Post key={p.id} p={p} />) : <p className="text-sm text-muted-foreground">No public posts here yet.</p>}
    </section>
  </div>;
}

/** Desktop Groups: Fedizen's group directory (Bonfire v1.1.0-rc.1), or one group when `groupId` is set. */
export function GroupsPage({ groupId }: { groupId?: string }) {
  return groupId ? <Detail id={groupId} /> : <Directory />;
}
