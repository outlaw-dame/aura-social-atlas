import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { FOLD_ABOVE, MAX_DEPTH, PAGE, REPLY_SORTS, facesIn, type Thread, type ThreadNode } from '@/lib/thread';
import { rememberSeed } from '@/lib/open-post';
import { Button } from '@/components/ui/button';
import { FeedPostCard, useFeedPostActions, type FeedActions } from './FeedPostCard';
import { FEED_PROBLEM } from './useFeeds';
import { useThread } from './useThread';
import { FilterPlaceProvider } from './useIntelligence';

/**
 * Desktop: a post's conversation (/post/$id). The posts it answers above, joined by a line; the post itself, larger,
 * with its date and counts; the author's own follow-ups; then the replies, nested, sortable, folded when there are
 * many (thread.ts has the rules and where each comes from). Any post here opens as its own conversation.
 */
export function ThreadView({ statusId, seed }: { statusId: string; seed?: FedizenPost }) {
  const t = useThread(statusId, seed);
  const actions = useFeedPostActions();
  const navigate = useNavigate();
  const back = () => { if (window.history.length > 1) window.history.back(); else void navigate({ to: '/' }); };
  return <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
    <div className="mb-4 flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={back} aria-label="Back"><ArrowLeft /></Button>
      <h1 className="flex-1 text-lg font-semibold">Conversation</h1>
      {t.thread && <Button variant="ghost" size="icon" onClick={t.refetch} disabled={t.refreshing} aria-label={t.refreshing ? 'Refreshing' : 'Refresh'}><RefreshCw className={t.refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} /></Button>}
    </div>
    {actions.error && <p role="alert" className="mb-3 text-sm text-destructive">{actions.error}</p>}
    {!t.signedIn ? <p className="text-sm text-muted-foreground">Sign in to Atlas and connect Fedizen to open conversations.</p>
      : !t.thread && t.loading ? <p className="text-sm text-muted-foreground" aria-live="polite">Loading the conversation…</p>
      : !t.thread ? <Problem error={t.error} retry={t.refetch} />
      : <FilterPlaceProvider place="public"><Conversation thread={t.thread} actions={actions} loading={t.loading} partial={!!t.error && !t.loading} sort={t.sort} setSort={t.setSort} retry={t.refetch} /></FilterPlaceProvider>}
    {actions.dialog}
  </main>;
}

function Problem({ error, retry }: { error?: string; retry: () => void }) {
  if (error === 'not-found') return <p className="text-sm text-muted-foreground">This post isn’t available. It may have been deleted, or you may not be able to see it.</p>;
  const known = error && error in FEED_PROBLEM ? FEED_PROBLEM[error as keyof typeof FEED_PROBLEM] : FEED_PROBLEM.unavailable;
  return <p className="text-sm text-muted-foreground">{known} <button type="button" className="underline" onClick={retry}>Try again</button></p>;
}

function Conversation({ thread: t, actions, loading, partial, sort, setSort, retry }: { thread: Thread; actions: FeedActions; loading: boolean; partial: boolean; sort: string; setSort: (s: 'oldest' | 'newest' | 'top') => void; retry: () => void }) {
  const [shown, setShown] = useState(PAGE);
  const fold = t.total > FOLD_ABOVE;
  const host = hostOf(t.focus.url);
  return <>
    {t.ancestors.length > 0 && <ol className="atlas-thread-up" aria-label={t.selfThread ? 'Earlier in this thread' : 'Replying to'}>
      {t.missingParent && <li className="atlas-thread-gap">Earlier posts in this conversation aren’t available.</li>}
      {t.ancestors.map(p => <li key={p.statusId ?? p.id}><FeedPostCard post={p} actions={actions} mode="thread" /></li>)}
    </ol>}
    {!t.ancestors.length && t.missingParent && <p className="atlas-thread-gap">The post this replies to isn’t available.</p>}
    <FeedPostCard post={t.focus} actions={actions} mode="focus" />
    {t.continuation.length > 0 && <ol className="atlas-thread-continue" aria-label={`${t.focus.author} continues`}>
      {t.continuation.map(p => <li key={p.statusId ?? p.id}><FeedPostCard post={p} actions={actions} mode="thread" /></li>)}
    </ol>}
    <section aria-labelledby="atlas-replies-h" className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id="atlas-replies-h" className="flex-1 text-sm font-semibold">{loading ? 'Replies' : t.replies.length ? `Replies` : 'No replies yet'}</h2>
        {t.replies.length > 1 && <div role="radiogroup" aria-label="Sort replies" className="inline-flex rounded-full bg-muted p-0.5 text-xs">
          {REPLY_SORTS.map(s => <button key={s.id} type="button" role="radio" aria-checked={sort === s.id} onClick={() => setSort(s.id)}
            className={sort === s.id ? 'rounded-full bg-background px-3 py-1 font-medium shadow-sm' : 'rounded-full px-3 py-1 text-muted-foreground hover:text-foreground'}>{s.label}</button>)}
        </div>}
      </div>
      {loading && <p className="text-sm text-muted-foreground" aria-live="polite">Loading replies…</p>}
      {partial && <p className="mb-3 text-sm text-muted-foreground">Couldn’t load the rest of this conversation. <button type="button" className="underline" onClick={retry}>Try again</button></p>}
      <ol className="atlas-thread-replies">
        {t.replies.slice(0, shown).map(n => <Reply key={n.post.statusId ?? n.post.id} node={n} actions={actions} fold={fold} author={t.focus.author} />)}
      </ol>
      {t.replies.length > shown && <Button variant="outline" className="mt-3 w-full" onClick={() => setShown(s => s + PAGE)}>Show more replies ({t.replies.length - shown})</Button>}
      {/* Fedizen shows the replies it has; one from a server it hasn't heard from yet appears once it has. */}
      {!loading && host && host !== 'fedizen.net' && <p className="mt-4 text-xs text-muted-foreground">
        Replies come from Fedizen, which may not have every reply from other servers yet. <a href={t.focus.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">See it on {host}<ArrowUpRight className="size-3" aria-hidden="true" /></a>
      </p>}
    </section>
  </>;
}

function Reply({ node: n, actions, fold, author }: { node: ThreadNode; actions: FeedActions; fold: boolean; author: string }) {
  const deeper = n.depth >= MAX_DEPTH.desktop && n.replies.length > 0;
  const kids = !deeper && n.replies.length > 0 && <ol className="atlas-thread-replies atlas-thread-nested">
    {n.replies.map(r => <Reply key={r.post.statusId ?? r.post.id} node={r} actions={actions} fold={fold} author={author} />)}
  </ol>;
  return <li>
    {n.part && <p className="mb-1 text-[11px] text-muted-foreground">On {author}’s post {n.part}</p>}
    <FeedPostCard post={n.post} actions={actions} mode="thread" />
    {deeper && <Link to="/post/$id" params={{ id: n.post.statusId! }} onClick={() => rememberSeed(n.post)} className="atlas-thread-more">
      Continue this thread ({n.size}) <ChevronRight className="size-4" aria-hidden="true" /></Link>}
    {kids && (fold ? <details className="atlas-thread-fold">
      <summary><Faces posts={facesIn(n)} />{n.size === 1 ? '1 reply' : `${n.size} replies`}</summary>
      {kids}
    </details> : kids)}
  </li>;
}

function Faces({ posts }: { posts: FedizenPost[] }) {
  return <span className="atlas-thread-faces" aria-hidden="true">{posts.map(p => p.avatar
    ? <img key={p.handle} src={p.avatar} alt="" width={20} height={20} referrerPolicy="no-referrer" loading="lazy" />
    : <span key={p.handle}>{p.author.charAt(0)}</span>)}</span>;
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}
