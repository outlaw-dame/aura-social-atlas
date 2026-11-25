/**
 * Each person's current assistant conversation (server only; table atlas_assistant_chats,
 * supabase/migrations/20261126000000_assistant_chats.sql).
 *
 * One row per Atlas user: the chat's id, its messages once an answer is complete, the stream an answer is being written
 * to (active_stream) and the last one written (last_stream: a reader may still be catching up on it after it ends).
 * A row last changed more than KEEP_MS ago is treated as gone and deleted. Server-only table; never sent whole to a
 * browser — routes pass on only this person's own chat.
 */

export const KEEP_MS = 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export type StoredChat = { chatId: string; messages: unknown[]; activeStream: string | null; lastStream: string | null; updatedAt: number };

type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const chatStoreDeps = {
  db: async (): Promise<Db> => (await import('@/integrations/supabase/client.server')).supabaseAdmin as unknown as Db,
  now: () => Date.now(),
};
const TABLE = 'atlas_assistant_chats';

/** This person's chat, or null when there's none or it's over a day old (then it's deleted). */
export async function readChat(userId: string): Promise<StoredChat | null> {
  const db = await chatStoreDeps.db();
  const { data, error } = await db.from(TABLE).select('chat_id, messages, active_stream, last_stream, updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`assistant chat read failed (${error.code ?? 'unknown'})`);
  if (!data) return null;
  const updatedAt = Date.parse(data.updated_at);
  if (!(chatStoreDeps.now() - updatedAt < KEEP_MS)) {
    await db.from(TABLE).delete().eq('user_id', userId).eq('updated_at', data.updated_at);
    return null;
  }
  return { chatId: data.chat_id, messages: Array.isArray(data.messages) ? data.messages : [], activeStream: data.active_stream, lastStream: data.last_stream, updatedAt };
}

/** An answer starts: keep the conversation so far and which stream the answer goes to. */
export async function startAnswer(userId: string, chatId: string, messages: unknown[], streamId: string) {
  const db = await chatStoreDeps.db();
  const { error } = await db.from(TABLE).upsert({
    user_id: userId, chat_id: chatId, messages, active_stream: streamId, last_stream: streamId,
    updated_at: new Date(chatStoreDeps.now()).toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error(`assistant chat write failed (${error.code ?? 'unknown'})`);
}

/**
 * The answer on `streamId` ended: keep the finished messages and say nothing is running. Only if that stream is still
 * this chat's latest — a newer question, or "New chat", wins.
 */
export async function finishAnswer(userId: string, chatId: string, streamId: string, messages: unknown[] | null) {
  const db = await chatStoreDeps.db();
  const patch: Record<string, unknown> = { active_stream: null, updated_at: new Date(chatStoreDeps.now()).toISOString() };
  if (messages) patch.messages = messages;
  const { error } = await db.from(TABLE).update(patch).eq('user_id', userId).eq('chat_id', chatId).eq('active_stream', streamId);
  if (error) console.warn('Assistant chat not saved', { code: error.code });
}

/** "New chat": forget this person's conversation. */
export async function clearChat(userId: string) {
  const db = await chatStoreDeps.db();
  const { error } = await db.from(TABLE).delete().eq('user_id', userId);
  if (error) throw new Error(`assistant chat delete failed (${error.code ?? 'unknown'})`);
}

/** Whether this person may read `streamId`: only their own chat's running or last answer. */
export function mayRead(chat: StoredChat | null, streamId: string): boolean {
  return !!chat && isUuid(streamId) && (chat.activeStream === streamId || chat.lastStream === streamId);
}
