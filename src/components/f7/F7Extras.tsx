import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import {
  Sheet, Popup, Page, Navbar, NavLeft, NavRight, Link, Block, List, ListInput, Button, Messages, Message, Messagebar, Icon, f7,
} from 'framework7-react';
import { durableChatTransport } from '@/lib/assistant/durable-transport';
import { assistantAuthHeaders, stopKeptAnswer, useAssistantSession, type AssistantSession } from '@/lib/assistant/useAssistantSession';

export { ComposeSheet } from './ComposeSheet';

const PROMPTS = ['What is the open social web?', 'How do Mastodon and Bluesky differ?', 'Explain RSS feeds'];

/** Assistant chat in a native-style popup; same /api/chat transport and kept conversation as the website. */
export function AssistantPopup({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { session, newChat } = useAssistantSession(opened);
  return <AssistantPopupChat key={session.key} opened={opened} onClose={onClose} session={session} onNewChat={newChat} />;
}

function AssistantPopupChat({ opened, onClose, session, onNewChat }: { opened: boolean; onClose: () => void; session: AssistantSession; onNewChat: () => void }) {
  const transport = useMemo(
    () => (session.durable ? durableChatTransport(assistantAuthHeaders) : new DefaultChatTransport({ api: '/api/chat', headers: assistantAuthHeaders })),
    [session.durable],
  );
  const { messages, sendMessage, status, stop } = useChat({ id: session.id, messages: session.messages, resume: session.durable && session.answering, transport });
  const [input, setInput] = useState('');
  const handled = useRef(new Set<string>());
  // Open links only from answers to questions asked here and now (see the desktop Assistant).
  const actFrom = useRef<number | null>(null);
  useEffect(() => {
    if (actFrom.current === null) return;
    for (const m of messages.slice(actFrom.current)) for (const p of m.parts as any[]) {
      if (p.type === 'tool-navigate_to' && p.toolCallId && p.input?.url && !handled.current.has(p.toolCallId)) {
        handled.current.add(p.toolCallId);
        window.open(p.input.url, '_blank', 'noopener');
      }
    }
  }, [messages]);
  const send = (t: string) => { if (!t.trim() || !session.ready) return; actFrom.current = messages.length; sendMessage({ text: t }); setInput(''); };
  const busy = status === 'submitted' || status === 'streaming';
  const textOf = (m: any) => m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');

  return (
    <Popup opened={opened} onPopupClosed={onClose} swipeToClose>
      <Page>
        <Navbar title="Assistant">
          {messages.length > 0 && <NavLeft><Link onClick={onNewChat}>New Chat</Link></NavLeft>}
          <NavRight><Link popupClose iconIos="f7:xmark" iconMd="material:close" aria-label="Close assistant" /></NavRight>
        </Navbar>
        <Messagebar placeholder="Ask anything" value={input} onInput={(e: any) => setInput(e.target.value)}>
          {busy
            ? <Link slot="inner-end" aria-label="Stop answering" onClick={() => { void stop(); if (session.durable) void stopKeptAnswer(); }} iconIos="f7:stop_circle_fill" iconMd="material:stop_circle" />
            : <Link slot="inner-end" aria-label="Send" onClick={() => send(input)} iconIos="f7:arrow_up_circle_fill" iconMd="material:send" />}
        </Messagebar>
        <Messages>
          {messages.length === 0 && (
            <Block>
              <p style={{ opacity: 0.6 }}>Ask about creators, networks, or the open web.</p>
              {session.durable && <p style={{ opacity: 0.6, fontSize: 13 }}>This chat is kept for a day, so an answer carries on after a refresh or on your other devices.</p>}
              {PROMPTS.map(p => <Button key={p} tonal small style={{ marginBottom: 8 }} onClick={() => send(p)}>{p}</Button>)}
            </Block>
          )}
          {messages.map(m => {
            const t = textOf(m);
            if (!t) return null;
            return (
              <Message key={m.id} type={m.role === 'user' ? 'sent' : 'received'} first last tail>
                <div slot="text">{m.role === 'user' ? t : <ReactMarkdown>{t}</ReactMarkdown>}</div>
              </Message>
            );
          })}
          {busy && <Message type="received" typing first last tail />}
        </Messages>
      </Page>
    </Popup>
  );
}

export { Icon };
