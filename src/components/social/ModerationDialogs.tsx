import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { openFediProfile } from '@/lib/fedi-profile';
import { REPORT_CATEGORIES, useMutes, useReport, useWhoReacted, type ReportCategory } from './useOwnPosts';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowUpRight, CircleDashed, Ellipsis, Flag, Globe2, VolumeX } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { blockServerText, serverOf, useServerBlock } from './useServerBlock';
import { useProfileCircles } from './useFedizenLibrary';
import { ProfileHoverCard } from './ProfileHoverCard';

export type ReportTarget = { name: string; acct?: string; accountId?: string; statusId?: string };

/**
 * Desktop: report an account (and the post it came from) to Fedizen's moderators, in Mastodon's steps: why, a note,
 * and whether to send a copy to their own server's moderators when they're elsewhere.
 */
export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const r = useReport();
  const [category, setCategory] = useState<ReportCategory>('spam');
  const [comment, setComment] = useState('');
  const [forward, setForward] = useState(false);
  const [sent, setSent] = useState(false);
  const remote = !!target?.acct && !/@fedizen\.net$/i.test(target.acct);
  const send = async () => {
    if (!target) return;
    if (await r.report({ accountId: target.accountId, acct: target.acct, statusIds: target.statusId ? [target.statusId] : [], comment, category, forward: remote && forward })) setSent(true);
  };
  return <Dialog open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      {sent ? <>
        <DialogHeader><DialogTitle>Thanks, it’s reported</DialogTitle><DialogDescription>Fedizen’s moderators will review it. You can also mute or block {target?.name} so you don’t see them meanwhile.</DialogDescription></DialogHeader>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </> : <>
        <DialogHeader>
          <DialogTitle>Report {target?.name}</DialogTitle>
          <DialogDescription>{target?.statusId ? 'This post and its author go to Fedizen’s moderators.' : 'This account goes to Fedizen’s moderators.'} They won’t see who reported it.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">What’s wrong?</legend>
          {REPORT_CATEGORIES.map(c => <label key={c.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-[:checked]:border-accent">
            <input type="radio" name="report-category" className="mt-1 accent-[var(--accent)]" checked={category === c.id} onChange={() => setCategory(c.id)} />
            <span><span className="block text-sm font-medium">{c.label}</span><span className="block text-xs text-muted-foreground">{c.note}</span></span>
          </label>)}
        </fieldset>
        <Textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={3} placeholder={category === 'other' ? 'What’s wrong?' : 'Anything the moderators should know (optional)'} aria-label="Note for the moderators" />
        {remote && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={forward} onChange={e => setForward(e.target.checked)} />
          <span>Also send a copy to the moderators of {target!.acct!.split('@')[1]}<span className="block text-xs text-muted-foreground">Without saying who reported it</span></span></label>}
        {r.error && <p role="alert" className="text-sm text-destructive">{r.error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void send()} disabled={r.busy || (category === 'other' && !comment.trim())}>{r.busy ? 'Sending…' : 'Send report'}</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}

/** Desktop: who liked or boosted a post, each opening their profile in Atlas. */
export function ReactorsDialog({ statusId, kind, onClose }: { statusId: string | null; kind: 'like' | 'boost'; onClose: () => void }) {
  const w = useWhoReacted(statusId, kind);
  return <Dialog open={!!statusId} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>{kind === 'like' ? 'Liked by' : 'Boosted by'}</DialogTitle><DialogDescription className="sr-only">{kind === 'like' ? 'People who liked this post' : 'People who boosted this post'}</DialogDescription></DialogHeader>
      {w.loading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : w.error ? <p role="alert" className="text-sm text-muted-foreground">{w.error}</p>
        : !w.people.length ? <p className="text-sm text-muted-foreground">{kind === 'like' ? 'No likes Fedizen knows of yet.' : 'No boosts Fedizen knows of yet.'}</p>
        : <ul className="max-h-[60vh] space-y-1 overflow-y-auto">{w.people.map(p => {
            const target = { actor: p.actor, acct: p.acct, name: p.name };
            return <li key={p.id}><ProfileHoverCard target={target}><button type="button" className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-muted" onClick={() => { onClose(); openFediProfile(target); }}>
              {p.avatar ? <img src={p.avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" className="size-9 atlas-avatar object-cover" /> : <span aria-hidden="true" className="atlas-avatar flex size-9 items-center justify-center bg-muted font-serif">{p.name.charAt(0)}</span>}
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.handle}</span></span>
            </button></ProfileHoverCard></li>;
          })}</ul>}
    </DialogContent>
  </Dialog>;
}

/** Desktop: More (…) beside Follow on a profile: Mute / Unmute and Report, for a confirmed handle that isn't yours. */
export function ProfileMoreMenu({ name, acct, actor, enabled }: { name: string; acct: string; actor: string; enabled: boolean }) {
  const mutes = useMutes(enabled);
  const circles = useProfileCircles(enabled ? { acct, actor } : null);
  const [reporting, setReporting] = useState(false);
  const servers = useServerBlock();
  const host = serverOf(acct);
  const [confirmHost, setConfirmHost] = useState(false), [serverNote, setServerNote] = useState<string | null>(null);
  if (!enabled) return null;
  const muted = mutes.isMuted({ acct });
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="outline" className="size-9 rounded-full" aria-label="More"><Ellipsis /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {circles.canWrite && circles.ready && circles.circles.length > 0 && <DropdownMenuSub>
          <DropdownMenuSubTrigger><CircleDashed />Circles</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {circles.circles.map(c => <DropdownMenuCheckboxItem key={c.id} checked={circles.isIn(c.id)} disabled={circles.busy} onSelect={e => { e.preventDefault(); void circles.toggle(c.id); }}>{c.title}</DropdownMenuCheckboxItem>)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>}
        <DropdownMenuItem disabled={mutes.busy} onSelect={() => void mutes.mute({ acct, on: !muted })}><VolumeX />{muted ? `Unmute ${name}` : `Mute ${name}`}</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setReporting(true)}><Flag />Report…</DropdownMenuItem>
        {/* Mastodon's "Block domain": the whole server, for you. Unblocking happens on Fedizen's Blocked page: Bonfire's
            API can block a server but not unblock one (useServerBlock). */}
        {host && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={servers.busy} onSelect={() => setConfirmHost(true)}><Globe2 />Block {host}…</DropdownMenuItem>
          <DropdownMenuItem asChild><a href={servers.blockedPage} target="_blank" rel="noopener noreferrer"><ArrowUpRight />Unblock on Fedizen…</a></DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
    {(mutes.error || circles.error || serverNote) && <p role="status" className="max-w-56 text-right text-xs text-muted-foreground">{serverNote ?? mutes.error ?? circles.error}</p>}
    {host && <AlertDialog open={confirmHost} onOpenChange={setConfirmHost}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Block {host}?</AlertDialogTitle><AlertDialogDescription>{blockServerText(host)}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => setServerNote(await servers.block(acct))}>Block {host}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
    {reporting && <ReportDialog target={{ name, acct }} onClose={() => setReporting(false)} />}
  </>;
}
