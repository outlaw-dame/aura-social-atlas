import { useState } from 'react';
import { Block, Button, Link, Navbar, Page } from 'framework7-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { FOLD_ABOVE, MAX_DEPTH, PAGE, REPLY_SORTS, facesIn, type Thread, type ThreadNode } from '@/lib/thread';
import { openPost } from '@/lib/open-post';
import { useThread } from '@/components/social/useThread';
import { FEED_PROBLEM } from '@/components/social/useFeeds';
import { FilterPlaceProvider } from '@/components/social/useIntelligence';
import { MobilePostCard, useMobilePostActions, type MobileActions } from './MobilePostCard';

/**
 * Phone: a post's conversation, pushed onto the stack when a post is tapped (back chevron, swipe back). The posts it
 * answers above, the post itself with its date and counts, the author's follow-ups, then the replies — nested three
 * levels as Bonfire nests them, deeper ones opening as their own conversation; folded when there are many. Pull down to
 * refresh. thread.ts has the rules and where each comes from.
 */
export function ThreadPage({ f7route, seed }: { f7route?: { params: { id?: string } }; seed?: FedizenPost }) {
  const id = f7route?.params.id ?? null;
  const t = useThread(id, seed);
  const actions = useMobilePostActions();
  return <Page className="atlas-thread-page" ptr onPtrRefresh={(done: () => void) => { t.refetch(); setTimeout(done, 600); }}>
    <Navbar title="Conversation" backLink backLinkShowText={false} />
    {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
    {!t.signedIn ? <Block strong inset>Sign in to Atlas and connect Fedizen to open conversations.</Block>
      : !t.thread && t.loading ? <Block strong inset><span aria-live="polite">Loading the conversation…</span></Block>
      : !t.thread ? <Block strong inset>{t.error === 'not-found'
          ? 'This post isn’t available. It may have been deleted, or you may not be able to see it.'
          : <>{t.error && t.error in FEED_PROBLEM ? FEED_PROBLEM[t.error as keyof typeof FEED_PROBLEM] : FEED_PROBLEM.unavailable} <Link onClick={t.refetch}>Try again</Link></>}</Block>
      : <FilterPlaceProvider place="public"><Conversation thread={t.thread} actions={actions} loading={t.loading} partial={!!t.error && !t.loading} sort={t.sort} setSort={t.setSort} retry={t.refetch} /></FilterPlaceProvider>}
    {actions.sheet}
  </Page>;
}

function Conversation({ thread: t, actions, loading, partial, sort, setSort, retry }: { thread: Thread; actions: MobileActions; loading: boolean; partial: boolean; sort: string; setSort: (s: 'oldest' | 'newest' | 'top') => void; retry: () => void }) {
  const [shown, setShown] = useState(PAGE);
  const fold = t.total > FOLD_ABOVE;
  const host = hostOf(t.focus.url);
  return <>
    {(t.ancestors.length > 0 || t.missingParent) && <ol className="atlas-thread-up" aria-label={t.selfThread ? 'Earlier in this thread' : 'Replying to'}>
      {t.missingParent && <li className="atlas-thread-gap">{t.ancestors.length ? 'Earlier posts in this conversation aren’t available.' : 'The post this replies to isn’t available.'}</li>}
      {t.ancestors.map(p => <li key={p.statusId ?? p.id}><MobilePostCard post={p} actions={actions} mode="thread" /></li>)}
    </ol>}
    <MobilePostCard post={t.focus} actions={actions} mode="focus" />
    {t.continuation.length > 0 && <ol className="atlas-thread-continue" aria-label={`${t.focus.author} continues`}>
      {t.continuation.map(p => <li key={p.statusId ?? p.id}><MobilePostCard post={p} actions={actions} mode="thread" /></li>)}
    </ol>}
    <div className="atlas-thread-head">
      <h2>{loading ? 'Replies' : t.replies.length ? 'Replies' : 'No replies yet'}</h2>
      {/* Framework7's segmented control, as markup, so it can be a labelled radio group. */}
      {t.replies.length > 1 && <div className="segmented segmented-strong segmented-round" role="radiogroup" aria-label="Sort replies">
        {REPLY_SORTS.map(s => <button key={s.id} type="button" role="radio" aria-checked={sort === s.id} onClick={() => setSort(s.id)}
          className={`button button-small button-round${sort === s.id ? ' button-active' : ''}`}>{s.label}</button>)}
      </div>}
    </div>
    {loading && <Block><span aria-live="polite">Loading replies…</span></Block>}
    {partial && <Block strong inset>Couldn’t load the rest of this conversation. <Link onClick={retry}>Try again</Link></Block>}
    <ol className="atlas-thread-replies">
      {t.replies.slice(0, shown).map(n => <Reply key={n.post.statusId ?? n.post.id} node={n} actions={actions} fold={fold} author={t.focus.author} />)}
    </ol>
    {t.replies.length > shown && <Block><Button tonal round onClick={() => setShown(s => s + PAGE)}>Show more replies ({t.replies.length - shown})</Button></Block>}
    {!loading && host && host !== 'fedizen.net' && <Block className="atlas-thread-note">
      Replies come from Fedizen, which may not have every reply from other servers yet. <Link external target="_blank" href={t.focus.url}>See it on {host}</Link>
    </Block>}
  </>;
}

function Reply({ node: n, actions, fold, author }: { node: ThreadNode; actions: MobileActions; fold: boolean; author: string }) {
  const deeper = n.depth >= MAX_DEPTH.phone && n.replies.length > 0;
  const kids = !deeper && n.replies.length > 0 && <ol className="atlas-thread-replies atlas-thread-nested">
    {n.replies.map(r => <Reply key={r.post.statusId ?? r.post.id} node={r} actions={actions} fold={fold} author={author} />)}
  </ol>;
  return <li>
    {n.part && <p className="atlas-thread-part">On {author}’s post {n.part}</p>}
    <MobilePostCard post={n.post} actions={actions} mode="thread" />
    {deeper && <button type="button" className="atlas-thread-more" onClick={() => openPost(n.post)}>Continue this thread ({n.size})</button>}
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
