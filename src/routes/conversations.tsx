import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StandaloneDesktopHosts } from '@/components/social/DesktopHosts';
import { ConversationsList } from '@/components/social/ConversationProto';

/** Prototype B (Bonfire + Phanpy + Wavelength): the conversations you're in, as Wavelength listed a group's threads.
 *  Private to the reader's Fedizen connection, so it isn't indexed. */
export const Route = createFileRoute('/conversations')({
  head: () => ({ meta: [{ title: 'Conversations — Atlas' }, { name: 'robots', content: 'noindex' }] }),
  component: ConversationsPage,
});

function ConversationsPage() {
  const navigate = useNavigate();
  const back = () => { if (window.history.length > 1) window.history.back(); else void navigate({ to: '/' }); };
  return <>
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
      <div className="mb-2 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={back} aria-label="Back"><ArrowLeft /></Button>
        <h1 className="flex-1 text-lg font-semibold">Conversations</h1>
      </div>
      <p className="atlas-proto-note mb-4">Prototype B. Conversations you’ve opened and ones you were mentioned in. What’s new and what’s muted is kept on this device.</p>
      <ConversationsList onOpen={id => void navigate({ to: '/post/$id', params: { id } })} />
    </main>
    <StandaloneDesktopHosts />
  </>;
}
