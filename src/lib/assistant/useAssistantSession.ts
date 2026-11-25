/**
 * Which conversation the assistant shows (desktop AssistantOverlay and phone AssistantPopup).
 *
 * On first opening, asks /api/assistant/chat whether answers are kept (Durable Streams on staging) and, if so, the
 * person's current chat: its id, finished messages and whether an answer is still being written — the chat then
 * reconnects to it. Without a stream server, or signed out, the assistant works as before (answers streamed on the
 * request, forgotten on refresh). `key` changes whenever the conversation does, so the chat view is rebuilt for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { supabase } from '@/integrations/supabase/client';
import type { AuthHeaders } from './durable-transport';

export type AssistantSession = {
  key: string;
  ready: boolean;
  durable: boolean;
  id?: string;
  messages: UIMessage[];
  answering: boolean;
};

export const assistantAuthHeaders: AuthHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  return headers;
};

const PLAIN: AssistantSession = { key: 'plain', ready: true, durable: false, messages: [], answering: false };
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));

/** What /api/assistant/chat said, checked before it's trusted. */
export function sessionFrom(body: unknown): AssistantSession {
  const b = body as { durable?: unknown; id?: unknown; messages?: unknown; answering?: unknown } | null;
  if (!b || b.durable !== true || typeof b.id !== 'string' || !Array.isArray(b.messages)) return { ...PLAIN, key: newKey() };
  return { key: `${b.id}:${newKey()}`, ready: true, durable: true, id: b.id, messages: b.messages as UIMessage[], answering: b.answering === true };
}

/**
 * Still not kept: the chat on screen stays as it is (its messages, an answer in progress), rather than being rebuilt
 * empty on every opening.
 */
export function keepOrReplace(current: AssistantSession, next: AssistantSession): AssistantSession {
  return current.ready && !current.durable && !next.durable ? current : next;
}

/** Stops the answer being written for this person's chat (on the server: the model stops, what it wrote is kept). */
export async function stopKeptAnswer() {
  await fetch('/api/assistant/stop', { method: 'POST', headers: await assistantAuthHeaders() }).catch(() => undefined);
}

export function useAssistantSession(open: boolean) {
  const [session, setSession] = useState<AssistantSession>({ ...PLAIN, key: 'loading', ready: false });
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const res = await fetch('/api/assistant/chat', { headers: await assistantAuthHeaders() });
      const next = res.ok ? sessionFrom(await res.json()) : { ...PLAIN, key: newKey() };
      setSession(current => keepOrReplace(current, next));
    } catch {
      setSession(current => keepOrReplace(current, { ...PLAIN, key: newKey() }));
    } finally {
      loading.current = false;
    }
  }, []);

  // Asked on opening; again on a later opening while answers aren't kept (say, the person has signed in since).
  useEffect(() => {
    if (open && (!session.ready || !session.durable)) void load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "New chat": stops a running answer and forgets the conversation (on the server too when it keeps them). */
  const newChat = useCallback(async () => {
    if (session.durable) {
      await fetch('/api/assistant/chat', { method: 'DELETE', headers: await assistantAuthHeaders() }).catch(() => undefined);
      setSession({ key: newKey(), ready: true, durable: true, id: newKey(), messages: [], answering: false });
    } else {
      setSession({ ...PLAIN, key: newKey() });
    }
  }, [session.durable]);

  return { session, newChat };
}
