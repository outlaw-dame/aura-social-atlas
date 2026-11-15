import { useState } from 'react';
import { ArrowUpRight, BadgeCheck, Bot, Lock, UserCheck, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { FediProfile, FediProfileTarget } from '@/lib/fedi-profile';
import { useFediFollow, useFediProfile } from './useFediProfile';

/**
 * Desktop: a fediverse account opened inside Atlas from an author tag — read from the account's own server
 * (ActivityPub), with its newest public posts, and Follow through the reader's Fedizen connection.
 */

const n = (v?: number) => (v == null ? null : new Intl.NumberFormat(undefined, { notation: 'compact' }).format(v));
const day = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

function Avatar({ p }: { p: FediProfile }) {
  const [broken, setBroken] = useState(false);
  if (p.avatar && !broken) return <img src={p.avatar} alt="" width={80} height={80} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-20 rounded-2xl object-cover ring-4 ring-background" />;
  return <span aria-hidden="true" className="flex size-20 items-center justify-center rounded-2xl bg-muted font-serif text-3xl ring-4 ring-background">{p.name.charAt(0)}</span>;
}

function Follow({ acct, locked }: { acct: string; locked: boolean }) {
  const f = useFediFollow(acct);
  if (!f.signedIn) return null;
  const on = f.state === 'following', asked = f.state === 'requested';
  return <div className="flex flex-col items-end gap-1">
    {f.canFollow && <Button size="sm" variant={on || asked ? 'outline' : 'default'} className="rounded-full" disabled={f.busy} aria-pressed={on} onClick={f.toggle}>
      {on ? <><UserCheck />Following</> : asked ? 'Requested' : <><UserPlus />{locked ? 'Request to follow' : 'Follow'}</>}
    </Button>}
    {f.error && <p role="alert" className="max-w-56 text-right text-xs text-muted-foreground">{f.error}</p>}
  </div>;
}

export function FediProfileDialog({ target, onClose }: { target: FediProfileTarget | null; onClose: () => void }) {
  const q = useFediProfile(target);
  const p = q.data?.profile;
  return <Dialog open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto rounded-3xl p-0">
      {!p ? <DialogHeader className="p-6">
          <DialogTitle className="font-serif text-2xl font-normal">{target?.name ?? target?.acct ?? 'Profile'}</DialogTitle>
          <DialogDescription>{q.isLoading ? 'Loading their profile from their server…' : 'This profile couldn’t be loaded. Their server may be down or not share it publicly.'}</DialogDescription>
        </DialogHeader>
      : <>
        <div className="h-28 w-full bg-muted bg-cover bg-center" style={p.header ? { backgroundImage: `url("${p.header.replace(/"/g, '%22')}")` } : undefined} aria-hidden="true" />
        <div className="px-6 pb-6">
          <div className="-mt-10 flex items-end justify-between gap-3"><Avatar p={p} /><Follow acct={p.acct} locked={p.locked} /></div>
          <DialogHeader className="mt-3 text-left">
            <DialogTitle className="flex flex-wrap items-center gap-2 font-serif text-3xl font-normal [overflow-wrap:anywhere]">
              {p.name}
              {p.kind === 'bot' && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-sans text-[11px]"><Bot className="size-3" />Automated</span>}
              {p.kind === 'group' && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-sans text-[11px]"><Users className="size-3" />Group</span>}
              {p.locked && <Lock className="size-4 text-muted-foreground" aria-label="Approves followers" />}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-1 [overflow-wrap:anywhere]">
              {p.acct}{p.acctVerified && <BadgeCheck className="size-3.5 text-accent" aria-label="Handle confirmed by their server" />}
              {p.joined && <span>· Joined {day(p.joined)}</span>}
            </DialogDescription>
          </DialogHeader>
          {p.bio.length > 0 && <div className="mt-3 space-y-2 text-sm leading-relaxed">{p.bio.map((t, i) => <p key={i}>{t}</p>)}</div>}
          {p.fields.length > 0 && <dl className="mt-4 divide-y divide-border rounded-2xl border border-border text-sm">
            {p.fields.map(f => <div key={f.name} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2"><dt className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.name}</dt><dd className="[overflow-wrap:anywhere]">{f.value}</dd></div>)}
          </dl>}
          <p className="mt-4 flex flex-wrap gap-4 text-sm">
            {n(p.postCount) && <span><b>{n(p.postCount)}</b> <span className="text-muted-foreground">posts</span></span>}
            {n(p.following) && <span><b>{n(p.following)}</b> <span className="text-muted-foreground">following</span></span>}
            {n(p.followers) && <span><b>{n(p.followers)}</b> <span className="text-muted-foreground">followers</span></span>}
          </p>
          <section className="mt-6 space-y-5" aria-label={`Recent posts by ${p.name}`}>
            {p.posts.map(post => <article key={post.id} className="border-t border-border pt-4">
              {post.title && <h3 className="font-serif text-xl">{post.title}</h3>}
              {post.cw ? <details className="mt-1 text-sm"><summary className="cursor-pointer text-muted-foreground">Content warning: {post.cw}</summary><div className="mt-2 space-y-2 leading-relaxed">{post.paragraphs.map((t, i) => <p key={i}>{t}</p>)}</div></details>
                : <div className="mt-1 space-y-2 text-sm leading-relaxed">{post.paragraphs.map((t, i) => <p key={i}>{t}</p>)}</div>}
              {post.image && <img src={post.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-3 max-h-72 w-full rounded-2xl object-cover" />}
              <p className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">{day(post.date)}<a href={post.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">Original<ArrowUpRight className="size-3" /></a></p>
            </article>)}
            {!p.posts.length && <p className="border-t border-border pt-4 text-sm text-muted-foreground">{p.postsHidden ? `${p.host} doesn’t share this account’s posts publicly.` : 'No public posts yet.'}</p>}
          </section>
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">View on {p.host}<ArrowUpRight className="size-3" /></a>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
