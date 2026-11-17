import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { rememberSeed } from '@/lib/open-post';
import { Button } from '@/components/ui/button';
import { PostContent, useFeedPostActions } from './FeedPostCard';
import { FilterGate } from './FilterGate';
import { FEED_PROBLEM } from './useFeeds';
import { useThread } from './useThread';
import { FilterPlaceProvider } from './useIntelligence';
import { ChatConversation, ProtoSwitch, useConversationVisit, useProtoStyle, useReplyMode } from './ConversationProto';
import { ThreadA } from './ThreadA';

/**
 * Desktop: a post's conversation (/post/$id), in either prototype — A, Bonfire + Phanpy (ThreadA.tsx), or B,
 * + Wavelength (ConversationProto.tsx) — arranged by thread.ts. Any post here opens as its own conversation.
 */
export function ThreadView({ statusId, seed }: { statusId: string; seed?: FedizenPost }) {
  const t = useThread(statusId, seed);
  const actions = useFeedPostActions();
  const navigate = useNavigate();
  const [style, setStyle] = useProtoStyle();
  const [replyMode, setReplyMode] = useReplyMode();
  const lastVisit = useConversationVisit(t.thread, !t.loading);
  const open = (p: FedizenPost) => { rememberSeed(p); void navigate({ to: '/post/$id', params: { id: p.statusId! } }); };
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
      : <FilterPlaceProvider place="public">
        <ProtoSwitch style={style} setStyle={setStyle} />
        {style === 'b'
          ? <ChatConversation thread={t.thread} actions={actions} lastVisit={lastVisit} pending={t.pending.length} onShowPending={t.showPending} arrived={t.arrived} Gate={FilterGate} Content={PostContent} onOpenInbox={() => void navigate({ to: '/conversations' })}
              onOpenPost={open} />
          : <ThreadA thread={t.thread} actions={actions} loading={t.loading} partial={!!t.error && !t.loading} retry={t.refetch} sort={t.sort} setSort={t.setSort}
              replyMode={replyMode} setReplyMode={setReplyMode} lastVisit={lastVisit} pending={t.pending.length} onShowPending={t.showPending} arrived={t.arrived} Gate={FilterGate} Content={PostContent} onOpenPost={open} />}
      </FilterPlaceProvider>}
    {actions.dialog}
  </main>;
}

function Problem({ error, retry }: { error?: string; retry: () => void }) {
  if (error === 'not-found') return <p className="text-sm text-muted-foreground">This post isn’t available. It may have been deleted, or you may not be able to see it.</p>;
  const known = error && error in FEED_PROBLEM ? FEED_PROBLEM[error as keyof typeof FEED_PROBLEM] : FEED_PROBLEM.unavailable;
  return <p className="text-sm text-muted-foreground">{known} <button type="button" className="underline" onClick={retry}>Try again</button></p>;
}
