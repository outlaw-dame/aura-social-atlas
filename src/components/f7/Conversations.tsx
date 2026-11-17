import { Navbar, Page } from 'framework7-react';
import { ConversationsList } from '@/components/social/ConversationProto';
import { openPost } from '@/lib/open-post';

/** Phone: prototype B's conversations (Bonfire + Phanpy + Wavelength), pushed from a conversation's "All conversations". */
export function ConversationsPage() {
  return <Page className="atlas-thread-page">
    <Navbar title="Conversations" backLink backLinkShowText={false} />
    <p className="atlas-proto-note atlas-proto-wrap">Prototype B. Conversations you’ve opened and ones you were mentioned in. What’s new and what’s muted is kept on this device.</p>
    <div className="atlas-proto-wrap"><ConversationsList onOpen={statusId => openPost({ statusId })} /></div>
  </Page>;
}
