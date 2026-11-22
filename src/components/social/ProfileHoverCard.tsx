import { useState, type ReactElement } from 'react';
import { BadgeCheck, Lock } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Button } from '@/components/ui/button';
import { openFediProfile, type FediProfileTarget } from '@/lib/fedi-profile';
import { useFediProfile } from './useFediProfile';
import { Follow } from './FediProfileDialog';

const n = (v?: number) => (v == null ? null : new Intl.NumberFormat(undefined, { notation: 'compact' }).format(v));

/**
 * Desktop: a profile card on hover over a name or avatar, as Mastodon's web app and Ivory show one: banner, avatar,
 * name, handle, a few lines of bio, counts and Follow, with the full profile a click away. The profile is read only
 * once the card opens (the same query and cache as the profile dialog). Touch screens don't hover; there, tapping
 * opens the profile itself.
 */
export function ProfileHoverCard({ target, children }: { target: FediProfileTarget; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  if (!target.actor && !target.acct) return children;
  return <HoverCard openDelay={450} closeDelay={150} open={open} onOpenChange={setOpen}>
    <HoverCardTrigger asChild>{children}</HoverCardTrigger>
    <HoverCardContent side="bottom" align="start" collisionPadding={16} className="w-80 overflow-hidden rounded-2xl p-0">
      {open && <Card target={target} />}
    </HoverCardContent>
  </HoverCard>;
}

function Card({ target }: { target: FediProfileTarget }) {
  const q = useFediProfile(target);
  const p = q.data?.profile;
  const [broken, setBroken] = useState(false);
  if (!p) return <div className="p-4 text-sm">
    <p className="font-semibold">{target.name ?? target.acct}</p>
    <p className="mt-1 text-xs text-muted-foreground">{q.isLoading ? 'Loading their profile…' : 'This profile couldn’t be loaded.'}</p>
  </div>;
  return <div>
    <div className="h-20 w-full bg-muted bg-cover bg-center" style={p.header ? { backgroundImage: `url("${p.header.replace(/"/g, '%22')}")` } : undefined} aria-hidden="true" />
    <div className="px-4 pb-4">
      <div className="-mt-7 flex items-end justify-between gap-2">
        {p.avatar && !broken
          ? <img src={p.avatar} alt="" width={56} height={56} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-14 atlas-avatar object-cover ring-4 ring-popover" />
          : <span aria-hidden="true" className="atlas-avatar flex size-14 items-center justify-center bg-muted font-serif text-xl ring-4 ring-popover">{p.name.charAt(0)}</span>}
        <Follow p={p} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 font-semibold [overflow-wrap:anywhere]">{p.name}{p.locked && <Lock className="size-3.5 text-muted-foreground" aria-label="Approves followers" />}</p>
      <p className="flex items-center gap-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.acct}{p.acctVerified && <BadgeCheck className="size-3.5 text-accent" aria-label="Handle confirmed by their server" />}</p>
      {p.bio.length > 0 && <p className="mt-2 line-clamp-3 text-sm leading-snug">{p.bio.join(' ')}</p>}
      <p className="mt-2 flex flex-wrap gap-3 text-xs">
        {n(p.following) && <span><b>{n(p.following)}</b> <span className="text-muted-foreground">following</span></span>}
        {n(p.followers) && <span><b>{n(p.followers)}</b> <span className="text-muted-foreground">followers</span></span>}
      </p>
      <Button variant="outline" size="sm" className="mt-3 w-full rounded-full" onClick={() => openFediProfile({ actor: p.actor, acct: p.acct, name: p.name })}>View profile</Button>
    </div>
  </div>;
}
