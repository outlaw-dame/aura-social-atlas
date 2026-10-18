import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import {
  Sheet, Popup, Page, Navbar, NavRight, Link, Block, List, ListInput, Button, Messages, Message, Messagebar, Icon, f7,
} from 'framework7-react';

/** Draft-only composer: nothing is published until a social account is connected. */
export function ComposeSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  return (
    <Sheet opened={opened} onSheetClosed={onClose} swipeToClose backdrop style={{ height: 'auto' }}>
      <Block>
        <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 4 }}>New post</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>Drafts stay on this device. Publishing arrives when you connect Bluesky or Mastodon.</div>
      </Block>
      <List strong inset>
        <ListInput type="textarea" placeholder="What's worth sharing?" value={text} maxlength={500}
          onInput={(e: any) => setText(e.target.value)} resizable />
      </List>
      <Block style={{ display: 'flex', gap: 8 }}>
        <Button tonal style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
        <Button fill style={{ flex: 1 }} disabled={!text.trim()}
          onClick={() => { f7.toast.show({ text: 'Draft saved', closeTimeout: 1600 }); setText(''); onClose(); }}>Save draft</Button>
      </Block>
    </Sheet>
  );
}

const PROMPTS = ['What is the open social web?', 'How do Mastodon and Bluesky differ?', 'Explain RSS feeds'];

/** Assistant chat in a native-style popup; same /api/chat transport as the website. */
export function AssistantPopup({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);
  const { messages, sendMessage, status } = useChat({ transport });
  const [input, setInput] = useState('');
  const handled = useRef(new Set<string>());
  useEffect(() => {
    for (const m of messages) for (const p of m.parts as any[]) {
      if (p.type === 'tool-navigate_to' && p.toolCallId && p.input?.url && !handled.current.has(p.toolCallId)) {
        handled.current.add(p.toolCallId);
        window.open(p.input.url, '_blank', 'noopener');
      }
    }
  }, [messages]);
  const send = (t: string) => { if (!t.trim()) return; sendMessage({ text: t }); setInput(''); };
  const busy = status === 'submitted' || status === 'streaming';
  const textOf = (m: any) => m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');

  return (
    <Popup opened={opened} onPopupClosed={onClose} swipeToClose>
      <Page>
        <Navbar title="Assistant">
          <NavRight><Link popupClose iconIos="f7:xmark" iconMd="material:close" aria-label="Close assistant" /></NavRight>
        </Navbar>
        <Messagebar placeholder="Ask anything" value={input} onInput={(e: any) => setInput(e.target.value)}>
          <Link slot="inner-end" aria-label="Send" onClick={() => send(input)} iconIos="f7:arrow_up_circle_fill" iconMd="material:send" />
        </Messagebar>
        <Messages>
          {messages.length === 0 && (
            <Block>
              <p style={{ opacity: 0.6 }}>Ask about creators, networks, or the open web.</p>
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
