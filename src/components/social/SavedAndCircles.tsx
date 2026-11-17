import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bookmark, CircleDashed, Heart, Minus, Pin, PinOff, Plus, UsersRound } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { BoostedBy, canOpen, openAuthor } from './PostPeople';
import { ProfileHoverCard } from './ProfileHoverCard';
import { pinCircle, unpinCircle, usePinnedCircles } from '@/lib/feed-types';
import { useAtlasAuth } from './AuthState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { PostArticleCard } from './ArticleAuthors';
import { VideoPlayer } from './VideoPlayer';
import { FilterGate } from './FilterGate';
import { SensitiveMedia } from './SensitiveMedia';
import { AuthorWarning } from './ContentWarning';
import { useLikedPosts } from './useOwnPosts';
import { LIBRARY_PROBLEM, useCircleActions, useCircleMembers, useFedizenCircles, useFedizenSaved, useSaveToggle } from './useFedizenLibrary';
import { PostBody } from './PostBody';

/**
 * Desktop Saved and Circles on the profile, backed by Fedizen (Bonfire): Saved is your bookmarks, and each saved
 * post keeps the audience its author gave it; Circles are your Bonfire circles and the people in them.
 */

const when = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

/** Bookmark a Fedizen post (Bonfire bookmarks). */
export function SaveButton({ post, save }: { post: Pick<FedizenPost, 'statusId' | 'bookmarked'>; save: ReturnType<typeof useSaveToggle> }) {
  if (!post.statusId || !save.canSave) return null;
  const on = save.isSaved(post);
  return <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" aria-pressed={on} disabled={save.isPending(post)} onClick={() => void save.toggle(post)}>
    <Bookmark className={on ? 'fill-accent text-accent' : ''} />{on ? 'Saved' : 'Save'}
  </Button>;
}

function PostRow({ p, save }: { p: FedizenPost; save: ReturnType<typeof useSaveToggle> }) {
  const navigate = useNavigate();
  const who = <>{p.avatar && <img src={p.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-8 atlas-avatar object-cover" />}<span className="atlas-author-name font-semibold">{p.author}</span></>;
  // Keyword filters, content warnings and sensitive media apply here as in the feeds.
  return <FilterGate post={p}><article className="border-b border-border pb-5">
    <BoostedBy post={p} className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground" />
    <p className="flex items-center gap-2 text-xs">{canOpen(p)
      ? <ProfileHoverCard target={{ actor: p.actor, acct: p.acct, name: p.author }}><button type="button" className="atlas-author-button gap-2" onClick={() => openAuthor(p)} aria-label={`${p.author} ${p.handle}. Open their profile`}>{who}</button></ProfileHoverCard>
      : who}<span className="text-muted-foreground">{p.handle} · {when(p.date)}</span></p>
    <AuthorWarning cw={p.cw}><div className="mt-3 space-y-2 text-sm leading-relaxed"><PostBody post={p} onTag={tag => void navigate({ to: '/tags/$tag', params: { tag } })} /></div>
    <SensitiveMedia sensitive={p.sensitive}>{p.video ? <VideoPlayer video={p.video} /> : p.image && <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-3 max-h-80 w-full rounded-2xl object-cover" />}</SensitiveMedia>
    <PostArticleCard article={p.article} /></AuthorWarning>
    <div className="mt-2 flex items-center gap-2">
      <SaveButton post={p} save={save} />
      <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Open on Fedizen<ArrowUpRight className="size-3" /></a>
    </div>
  </article></FilterGate>;
}

/** Profile → Saved: your Fedizen bookmarks. `stories` are discovery stories saved this session, shown after. */
export function DesktopSaved({ stories }: { stories?: React.ReactNode }) {
  const q = useFedizenSaved();
  const save = useSaveToggle();
  const posts = q.data?.posts ?? [];
  return <div className="space-y-6">
    <p className="text-xs text-muted-foreground">Posts you save on Fedizen. Each keeps the audience its author chose.</p>
    {q.isLoading && <p className="text-sm text-muted-foreground">Loading your saved posts…</p>}
    {q.data?.error && <p role="alert" className="text-sm text-muted-foreground">{LIBRARY_PROBLEM[q.data.error]}</p>}
    {q.isError && <p role="alert" className="text-sm text-muted-foreground">{LIBRARY_PROBLEM.unavailable} <Button variant="link" size="sm" className="px-1" onClick={() => void q.refetch()}>Try again</Button></p>}
    {save.error && <p role="alert" className="text-sm text-destructive">{save.error}</p>}
    {posts.map(p => <PostRow key={p.id} p={p} save={save} />)}
    {!q.isLoading && !q.data?.error && !posts.length && !stories && <div className="py-12 text-center">
      <Bookmark className="mx-auto mb-4 size-8 text-muted-foreground" strokeWidth={1.5} />
      <h3 className="font-serif text-2xl">Nothing saved yet</h3>
      <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">Save posts from your Fedizen feed, and they’ll be here.</p>
    </div>}
    {stories}
  </div>;
}

/** Profile → Liked: posts you liked on Fedizen, newest like first. Only you see this tab. */
export function DesktopLiked() {
  const q = useLikedPosts();
  const save = useSaveToggle();
  return <div className="space-y-6">
    <p className="text-xs text-muted-foreground">Only you can see what you’ve liked.</p>
    {q.loading && <p className="text-sm text-muted-foreground">Loading posts you liked…</p>}
    {q.error && <p role="alert" className="text-sm text-muted-foreground">{q.error}</p>}
    {q.posts.map(p => <PostRow key={p.id} p={p} save={save} />)}
    {!q.loading && !q.error && !q.posts.length && <div className="py-12 text-center">
      <Heart className="mx-auto mb-4 size-8 text-muted-foreground" strokeWidth={1.5} />
      <h3 className="font-serif text-2xl">No likes yet</h3>
      <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">Posts you like will be here.</p>
    </div>}
  </div>;
}

/** Pin this circle to the Feeds page (posts from the people in it), or unpin it. */
function PinToFeeds({ circle }: { circle: { id: string; title: string } }) {
  const { user } = useAtlasAuth();
  const pinned = usePinnedCircles(user?.id).some(c => c.id === circle.id);
  if (!user) return null;
  return <Button variant={pinned ? 'secondary' : 'outline'} size="sm" className="rounded-full" aria-pressed={pinned} onClick={() => (pinned ? unpinCircle(user.id, circle.id) : pinCircle(user.id, circle))}>
    {pinned ? <><PinOff />Pinned to Feeds</> : <><Pin />Pin to Feeds</>}
  </Button>;
}

/** Profile → Circles: your Bonfire circles, and the people in each. */
export function DesktopCircles() {
  const q = useFedizenCircles();
  const act = useCircleActions();
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const [title, setTitle] = useState(''), [note, setNote] = useState<string | null>(null);
  const circles = q.data?.circles ?? [];
  const canWrite = !!q.data?.canWrite;
  if (open) return <CircleView circle={open} canWrite={canWrite} onBack={() => setOpen(null)} />;
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Circles group the people you know, so you choose who sees and replies to each post. They’re your circles on Fedizen.</p>
    {q.isLoading && <p className="text-sm text-muted-foreground">Loading your circles…</p>}
    {q.data?.error && <p role="alert" className="text-sm text-muted-foreground">{LIBRARY_PROBLEM[q.data.error]}</p>}
    {circles.map(c => <button key={c.id} type="button" onClick={() => setOpen(c)} className="flex w-full items-center gap-3 rounded-2xl border border-border p-4 text-left transition-colors hover:bg-secondary/60">
      <CircleDashed className="size-5 shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate font-semibold">{c.title}</span>
    </button>)}
    {!q.isLoading && !q.data?.error && !circles.length && <p className="py-6 text-center text-sm text-muted-foreground">No circles yet.</p>}
    {!q.data?.error && !q.isLoading && (canWrite
      ? <form className="flex gap-2 pt-2" onSubmit={async e => { e.preventDefault(); const t = title.trim(); if (!t) return; setNote(await act.create(t)); setTitle(''); }}>
          <Input value={title} maxLength={100} onChange={e => setTitle(e.target.value)} placeholder="New circle, like Close friends" aria-label="New circle name" />
          <Button type="submit" disabled={!title.trim() || act.busy}><Plus />Create</Button>
        </form>
      : <p className="text-xs text-muted-foreground">{LIBRARY_PROBLEM['needs-permission']}</p>)}
    {note && <p role="alert" className="text-sm text-destructive">{note}</p>}
  </div>;
}

function CircleView({ circle, canWrite, onBack }: { circle: { id: string; title: string }; canWrite: boolean; onBack: () => void }) {
  const { user } = useAtlasAuth();
  const q = useCircleMembers(circle.id);
  const act = useCircleActions();
  const [handle, setHandle] = useState(''), [note, setNote] = useState<string | null>(null), [confirming, setConfirming] = useState(false);
  const people = q.data?.people ?? [];
  return <div className="space-y-4">
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All circles</button>
    <div className="flex flex-wrap items-center gap-3"><CircleDashed className="size-6 text-accent" /><h3 className="flex-1 font-serif text-3xl">{circle.title}</h3><PinToFeeds circle={circle} /></div>
    {q.isLoading && <p className="text-sm text-muted-foreground">Loading who’s in it…</p>}
    {q.data?.error && <p role="alert" className="text-sm text-muted-foreground">{LIBRARY_PROBLEM[q.data.error]}</p>}
    <ul className="divide-y divide-border">
      {people.map(p => <li key={p.id} className="flex items-center gap-3 py-3">
        {p.avatar ? <img src={p.avatar} alt="" referrerPolicy="no-referrer" className="size-10 atlas-avatar object-cover" /> : <span className="social-avatar size-10 font-serif" aria-hidden="true">{p.name.charAt(0)}</span>}
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.handle}</span></span>
        {canWrite && <Button size="icon" variant="ghost" aria-label={`Remove ${p.name} from ${circle.title}`} onClick={async () => setNote(await act.removeMember(circle.id, p.id))}><Minus /></Button>}
      </li>)}
      {!q.isLoading && !people.length && !q.data?.error && <li className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><UsersRound className="size-4" />No one in this circle yet.</li>}
    </ul>
    {canWrite && <form className="flex gap-2" onSubmit={async e => { e.preventDefault(); const h = handle.trim(); if (!h) return; const err = await act.addMember(circle.id, h); setNote(err); if (!err) setHandle(''); }}>
      <Input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@name@server.social" aria-label={`Add someone to ${circle.title}`} />
      <Button type="submit" disabled={!handle.trim() || act.busy}><Plus />Add</Button>
    </form>}
    {note && <p role="alert" className="text-sm text-destructive">{note}</p>}
    {canWrite && (confirming
      ? <div className="flex gap-2"><Button variant="destructive" size="sm" className="rounded-full" onClick={async () => { const err = await act.remove(circle.id); if (err) setNote(err); else { if (user) unpinCircle(user.id, circle.id); onBack(); } }}>Delete circle</Button><Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep it</Button></div>
      : <Button variant="ghost" size="sm" className="rounded-full text-destructive" onClick={() => setConfirming(true)}>Delete circle</Button>)}
  </div>;
}
