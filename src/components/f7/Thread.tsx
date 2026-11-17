import type { ReactNode } from 'react';
import { Block, Link, Navbar, Page } from 'framework7-react';
import type { FedizenPost } from '@/lib/fedizen-feed';
import { openPost } from '@/lib/open-post';
import { useThread } from '@/components/social/useThread';
import { FEED_PROBLEM } from '@/components/social/useFeeds';
import { FilterPlaceProvider } from '@/components/social/useIntelligence';
import { MobilePostContent, useMobilePostActions } from './MobilePostCard';
import { MobileFilterGate } from './FilterGate';
import { ChatConversation, ProtoSwitch, useConversationVisit, useProtoStyle, useReplyMode } from '@/components/social/ConversationProto';
import { ThreadA } from '@/components/social/ThreadA';
import { CONVERSATIONS_URL, pushPage } from './navigation';

/**
 * Phone: a post's conversation, pushed onto the stack when a post is tapped (back chevron, swipe back; pull down to
 * refresh), in either prototype — A, Bonfire + Phanpy (ThreadA.tsx), or B,
 * + Wavelength (ConversationProto.tsx). thread.ts arranges it.
 */
export function ThreadPage({ f7route, seed }: { f7route?: { params: { id?: string } }; seed?: FedizenPost }) {
  const id = f7route?.params.id ?? null;
  const t = useThread(id, seed);
  const actions = useMobilePostActions();
  const [style, setStyle] = useProtoStyle();
  const [replyMode, setReplyMode] = useReplyMode();
  const lastVisit = useConversationVisit(t.thread, !t.loading);
  return <Page className="atlas-thread-page" ptr onPtrRefresh={(done: () => void) => { t.refetch(); setTimeout(done, 600); }}>
    <Navbar title="Conversation" backLink backLinkShowText={false} />
    {actions.error && <Block strong inset><p role="alert" style={{ margin: 0 }}>{actions.error}</p></Block>}
    {!t.signedIn ? <Block strong inset>Sign in to Atlas and connect Fedizen to open conversations.</Block>
      : !t.thread && t.loading ? <Block strong inset><span aria-live="polite">Loading the conversation…</span></Block>
      : !t.thread ? <Block strong inset>{t.error === 'not-found'
          ? 'This post isn’t available. It may have been deleted, or you may not be able to see it.'
          : <>{t.error && t.error in FEED_PROBLEM ? FEED_PROBLEM[t.error as keyof typeof FEED_PROBLEM] : FEED_PROBLEM.unavailable} <Link onClick={t.refetch}>Try again</Link></>}</Block>
      : <FilterPlaceProvider place="public">
        <div className="atlas-proto-wrap"><ProtoSwitch style={style} setStyle={setStyle} /></div>
        {style === 'b'
          ? <ChatConversation thread={t.thread} actions={actions} lastVisit={lastVisit} Gate={MessageGate} Content={MobilePostContent} onOpenInbox={() => pushPage(CONVERSATIONS_URL)} onOpenPost={p => openPost(p)} />
          : <div className="atlas-proto-wrap"><ThreadA thread={t.thread} actions={actions} loading={t.loading} partial={!!t.error && !t.loading} retry={t.refetch} sort={t.sort} setSort={t.setSort}
              replyMode={replyMode} setReplyMode={setReplyMode} lastVisit={lastVisit} Gate={MessageGate} Content={MobilePostContent} onOpenPost={p => openPost(p)} /></div>}
      </FilterPlaceProvider>}
    {actions.sheet}
  </Page>;
}

/** Posts in either prototype behind the reader's filters, as a card's would be (no card frame). */
function MessageGate({ post, children }: { post: FedizenPost; children: ReactNode }) {
  return <MobileFilterGate post={post} card={false}>{children}</MobileFilterGate>;
}
