-- The assistant's current conversation, one per Atlas user, so an answer survives a refresh, a dropped connection or a
-- switch to another device (src/lib/assistant/*). The answer itself is written to a Durable Stream on Atlas's private
-- stream server while it's generated; this row says which stream is running (active_stream) and which ran last
-- (last_stream), and keeps the messages once an answer is complete.
-- Kept for a day: a row last changed more than 24 h ago is treated as gone and deleted when next read, and the streams
-- expire on the stream server after 24 h without reads or writes. "New chat" deletes the row at once.
-- Server-only: row level security on, no policies, no anon/authenticated grants.

create table if not exists public.atlas_assistant_chats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_id uuid not null,
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array' and pg_column_size(messages) <= 1048576),
  active_stream uuid,
  last_stream uuid,
  updated_at timestamptz not null default now()
);

create index if not exists atlas_assistant_chats_updated_at on public.atlas_assistant_chats (updated_at);

alter table public.atlas_assistant_chats enable row level security;
revoke all on public.atlas_assistant_chats from anon, authenticated;

comment on table public.atlas_assistant_chats is 'Server-only: each person''s current assistant conversation, kept 24 h (see src/lib/assistant/chat-store.server.ts).';
